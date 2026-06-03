use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{mpsc, Mutex};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct ProcessOutputPayload {
    pub agent_id: String,
    pub stream_type: String, // "stdout" or "stderr"
    pub content: String,
}

pub struct ActiveAgent {
    pub stdin_tx: mpsc::UnboundedSender<String>,
    pub kill_tx: tokio::sync::oneshot::Sender<()>,
}

pub struct SubAgentSupervisor {
    // Active processes indexed by agent_id
    pub active_processes: Arc<Mutex<HashMap<String, ActiveAgent>>>,
    // Active terminal processes' kill channels
    pub active_terminals: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>>,
    // Broadcast channel to stream process output & exit events to Web clients over WebSockets
    pub broadcast_tx: tokio::sync::broadcast::Sender<String>,
}

impl SubAgentSupervisor {
    pub fn new() -> Self {
        let (broadcast_tx, _) = tokio::sync::broadcast::channel(1000);
        Self {
            active_processes: Arc::new(Mutex::new(HashMap::new())),
            active_terminals: Arc::new(Mutex::new(HashMap::new())),
            broadcast_tx,
        }
    }

    pub async fn kill_terminal(&self, terminal_id: &str) {
        let mut terminals = self.active_terminals.lock().await;
        if let Some(kill_tx) = terminals.remove(terminal_id) {
            let _ = kill_tx.send(());
        }
    }

    pub async fn kill_all_terminals(&self) {
        let mut terminals = self.active_terminals.lock().await;
        for (_, kill_tx) in terminals.drain() {
            let _ = kill_tx.send(());
        }
    }

    // Spawn a new sub-agent process
    pub async fn spawn_agent(
        &self,
        app_handle: AppHandle,
        agent_id: &str,
        exec_path: &str,
        args: Vec<String>,
        env_vars: HashMap<String, String>,
        cwd: Option<String>,
    ) -> Result<(), String> {
        let mut processes = self.active_processes.lock().await;

        // Kill existing if already running
        if processes.contains_key(agent_id) {
            if let Some(agent) = processes.remove(agent_id) {
                let _ = agent.kill_tx.send(());
            }
        }

        // Configure cmd
        let mut cmd = crate::build_agent_command(exec_path);

        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Set working directory if provided
        if let Some(dir) = cwd {
            if !dir.is_empty() {
                cmd.current_dir(dir);
            }
        }

        // Add custom environment variables
        for (k, v) in env_vars {
            if !v.is_empty() {
                cmd.env(k, v);
            }
        }

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn sub-agent: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
        let (kill_tx, mut kill_rx) = tokio::sync::oneshot::channel::<()>();

        processes.insert(agent_id.to_string(), ActiveAgent { stdin_tx, kill_tx });

        // Task 1: Stdin Writer Loop
        tokio::spawn(async move {
            let mut stdin_writer = stdin;
            while let Some(msg) = stdin_rx.recv().await {
                if msg.is_empty() {
                    break;
                }
                let payload = format!("{}\n", msg);
                if stdin_writer.write_all(payload.as_bytes()).await.is_err() {
                    break;
                }
                let _ = stdin_writer.flush().await;
            }
        });

        let agent_id_stdout = agent_id.to_string();
        let app_stdout = app_handle.clone();
        let b_tx_stdout = self.broadcast_tx.clone();
        // Task 2: Stdout Reader Loop (byte buffer non-blocking)
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut reader = stdout;
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf).await {
                if n == 0 {
                    break; // EOF
                }
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                let payload = ProcessOutputPayload {
                    agent_id: agent_id_stdout.clone(),
                    stream_type: "stdout".to_string(),
                    content: text,
                };
                let _ = app_stdout.emit("subagent-output", payload.clone());
                
                if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
                    "event": "subagent-output",
                    "payload": payload
                })) {
                    let _ = b_tx_stdout.send(json_str);
                }
            }
        });

        let agent_id_stderr = agent_id.to_string();
        let app_stderr = app_handle.clone();
        let b_tx_stderr = self.broadcast_tx.clone();
        // Task 3: Stderr Reader Loop (byte buffer non-blocking)
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let mut reader = stderr;
            let mut buf = [0u8; 4096];
            while let Ok(n) = reader.read(&mut buf).await {
                if n == 0 {
                    break; // EOF
                }
                let text = String::from_utf8_lossy(&buf[..n]).to_string();
                let payload = ProcessOutputPayload {
                    agent_id: agent_id_stderr.clone(),
                    stream_type: "stderr".to_string(),
                    content: text,
                };
                let _ = app_stderr.emit("subagent-output", payload.clone());
                
                if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
                    "event": "subagent-output",
                    "payload": payload
                })) {
                    let _ = b_tx_stderr.send(json_str);
                }
            }
        });

        // Task 4: Child Wait / Clean exit monitor
        let active_proc = self.active_processes.clone();
        let agent_id_str = agent_id.to_string();
        let app_exit = app_handle.clone();
        let b_tx_exit = self.broadcast_tx.clone();
        tokio::spawn(async move {
            tokio::select! {
                status = child.wait() => {
                    let mut proc_map = active_proc.lock().await;
                    if proc_map.contains_key(&agent_id_str) {
                        proc_map.remove(&agent_id_str);
                    }
                    println!("Sub-agent {} exited with status {:?}", agent_id_str, status);
                    let exit_code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
                    let payload = serde_json::json!({
                        "agent_id": agent_id_str,
                        "exit_code": exit_code
                    });
                    let _ = app_exit.emit("subagent-exit", payload.clone());
                    
                    if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
                        "event": "subagent-exit",
                        "payload": payload
                    })) {
                        let _ = b_tx_exit.send(json_str);
                    }
                }
                _ = &mut kill_rx => {
                    let _ = child.kill().await;
                    let mut proc_map = active_proc.lock().await;
                    if proc_map.contains_key(&agent_id_str) {
                        proc_map.remove(&agent_id_str);
                    }
                    println!("Sub-agent {} was killed by supervisor request", agent_id_str);
                    let payload = serde_json::json!({
                        "agent_id": agent_id_str,
                        "exit_code": -1
                    });
                    let _ = app_exit.emit("subagent-exit", payload.clone());
                    
                    if let Ok(json_str) = serde_json::to_string(&serde_json::json!({
                        "event": "subagent-exit",
                        "payload": payload
                    })) {
                        let _ = b_tx_exit.send(json_str);
                    }
                }
            }
        });

        Ok(())
    }

    // Write message into sub-agent stdin
    pub async fn write_stdin(&self, agent_id: &str, message: &str) -> Result<(), String> {
        let processes = self.active_processes.lock().await;
        if let Some(agent) = processes.get(agent_id) {
            agent.stdin_tx.send(message.to_string())
                .map_err(|e| format!("Failed to send to stdin channel: {}", e))?;
            Ok(())
        } else {
            Err(format!("No active process found for agent: {}", agent_id))
        }
    }

    // Terminate the running sub-agent
    pub async fn kill_agent(&self, agent_id: &str) -> Result<(), String> {
        let mut processes = self.active_processes.lock().await;
        if let Some(agent) = processes.remove(agent_id) {
            let _ = agent.kill_tx.send(());
            Ok(())
        } else {
            Err(format!("No active process found for agent: {}", agent_id))
        }
    }
}
