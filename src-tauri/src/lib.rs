#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

mod config;
mod memory;
mod supervisor;
mod daemon;

use std::sync::Arc;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use daemon::AppState;
use supervisor::SubAgentSupervisor;
use memory::MemoryManager;

// ==========================================
// Shared cross-platform command builder
// ==========================================

use tokio::process::Command;

/// Build a tokio::process::Command for launching an agent executable.
/// On Windows: wraps in cmd /c with proper arg handling for paths with spaces.
/// On other platforms:直接执行 exec_path。
pub fn build_agent_command(exec_path: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        // Use args() so tokio handles quoting for paths with spaces automatically.
        // Resulting command line: cmd /c "C:\Path With Spaces\gemini.cmd"
        let mut cmd = Command::new("cmd");
        cmd.args(&["/c", exec_path]);
        cmd
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(exec_path)
    }
}

// ==========================================
// Tauri IPC Commands
// ==========================================

#[tauri::command]
async fn get_config_val(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<Option<String>, String> {
    let val = config::get_config(&state.pool, &key).await;
    Ok(val)
}

#[tauri::command]
async fn set_config_val(
    state: State<'_, Arc<AppState>>,
    key: String,
    value: String,
) -> Result<(), String> {
    config::set_config(&state.pool, &key, &value)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_session_data(
    state: State<'_, Arc<AppState>>,
    session_id: String,
) -> Result<Vec<u8>, String> {
    let doc = MemoryManager::load_session(&state.pool, &session_id).await?;
    Ok(doc.export_snapshot())
}

#[tauri::command]
async fn save_session_data(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    title: String,
    snapshot: Vec<u8>,
) -> Result<(), String> {
    let doc = loro::LoroDoc::new();
    if !snapshot.is_empty() {
        doc.import(&snapshot).map_err(|e| e.to_string())?;
    }
    MemoryManager::save_session(&state.pool, &session_id, &title, &doc).await?;
    Ok(())
}

#[tauri::command]
async fn run_subagent(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
    exec_path: String,
    args: Vec<String>,
    env_vars: HashMap<String, String>,
    cwd: Option<String>,
) -> Result<(), String> {
    state.supervisor.spawn_agent(
        state.app_handle.clone(),
        &agent_id,
        &exec_path,
        args,
        env_vars,
        cwd,
    ).await?;
    Ok(())
}

#[tauri::command]
async fn write_subagent_stdin(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
    message: String,
) -> Result<(), String> {
    state.supervisor.write_stdin(&agent_id, &message).await?;
    Ok(())
}

#[tauri::command]
async fn kill_subagent(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
) -> Result<(), String> {
    state.supervisor.kill_agent(&agent_id).await?;
    Ok(())
}

#[tauri::command]
async fn get_registered_agents(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<config::SubAgent>, String> {
    let agents = config::list_registered_agents(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(agents)
}

#[tauri::command]
async fn save_agent_to_registry(
    state: State<'_, Arc<AppState>>,
    agent: config::SubAgent,
) -> Result<(), String> {
    config::save_registered_agent(&state.pool, &agent)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_agent_from_registry(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
) -> Result<(), String> {
    config::delete_registered_agent(&state.pool, &agent_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn test_agent_availability(
    exec_path: String,
    args: Vec<String>,
    env_vars: HashMap<String, String>,
) -> Result<String, String> {
    use tokio::time::timeout;
    use std::time::Duration;
    use std::process::Stdio;
    use tokio::io::AsyncReadExt;

    let mut cmd = crate::build_agent_command(&exec_path);

    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Inject custom environment variables
    for (k, v) in env_vars {
        if !v.is_empty() {
            cmd.env(k, v);
        }
    }

    // Spawn and wait with 3-second timeout
    let mut child = cmd.spawn().map_err(|e| format!("无法启动可执行文件: {}", e))?;

    let mut stdout = child.stdout.take().ok_or("无法捕获 stdout")?;
    let mut stderr = child.stderr.take().ok_or("无法捕获 stderr")?;

    let test_run = async {
        let mut out_buf = Vec::new();
        let mut err_buf = Vec::new();

        let read_stdout = stdout.read_to_end(&mut out_buf);
        let read_stderr = stderr.read_to_end(&mut err_buf);
        let wait_child = child.wait();

        let (status, _, _) = tokio::try_join!(
            async { wait_child.await.map_err(|e| format!("运行出错: {}", e)) },
            async { read_stdout.await.map_err(|e| format!("读取 stdout 出错: {}", e)) },
            async { read_stderr.await.map_err(|e| format!("读取 stderr 出错: {}", e)) }
        )?;
        
        Ok::<_, String>((status, out_buf, err_buf))
    };

    match timeout(Duration::from_secs(10), test_run).await {
        Ok(Ok((status, out_buf, err_buf))) => {
            if status.success() {
                let stdout_str = String::from_utf8_lossy(&out_buf).trim().to_string();
                if stdout_str.is_empty() {
                    let stderr_str = String::from_utf8_lossy(&err_buf).trim().to_string();
                    if stderr_str.is_empty() {
                        Ok("已就绪 (无版本号输出)".to_string())
                    } else {
                        Ok(format!("已就绪 (stderr 输出: {})", stderr_str))
                    }
                } else {
                    Ok(stdout_str)
                }
            } else {
                let stderr_str = String::from_utf8_lossy(&err_buf).trim().to_string();
                Err(format!("执行失败 (Exit code: {:?}): {}", status.code(), stderr_str))
            }
        }
        Ok(Err(e)) => Err(e),
        Err(_) => {
            // Kill child on timeout
            let _ = child.kill().await;
            Err("检测超时 (10秒内未响应)".to_string())
        }
    }
}

#[tauri::command]
async fn get_chat_sessions(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<config::ChatSession>, String> {
    config::list_chat_sessions(&state.pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_chat_session(
    state: State<'_, Arc<AppState>>,
    session: config::ChatSession,
) -> Result<(), String> {
    config::save_chat_session(&state.pool, &session)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_chat_session(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    config::delete_chat_session(&state.pool, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn list_workspace_files(workspace_path: String) -> Result<Vec<String>, String> {
    use std::fs;
    use std::path::Path;

    fn scan_dir_recursive(dir: &Path, base: &Path, files: &mut Vec<String>) -> std::io::Result<()> {
        if files.len() >= 300 {
            return Ok(());
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.starts_with('.')
                        || name == "node_modules"
                        || name == "target"
                        || name == "dist"
                        || name == "build"
                        || name == "out"
                        || name == "package-lock.json"
                        || name == "yarn.lock"
                        || name == "pnpm-lock.yaml"
                    {
                        continue;
                    }
                    if path.is_dir() {
                        let _ = scan_dir_recursive(&path, base, files);
                    } else if path.is_file() {
                        if let Ok(rel) = path.strip_prefix(base) {
                            files.push(rel.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
        Ok(())
    }

    let base_path = Path::new(&workspace_path);
    if !base_path.exists() || !base_path.is_dir() {
        return Err("工作区路径不存在或不是一个目录".to_string());
    }

    let mut files = Vec::new();
    scan_dir_recursive(base_path, base_path, &mut files)
        .map_err(|e| format!("扫描目录出错: {}", e))?;

    Ok(files)
}

#[tauri::command]
async fn read_acp_file(
    workspace_path: String,
    file_path: String,
) -> Result<String, String> {
    use std::fs;

    let base = std::path::Path::new(&workspace_path);
    let mut resolved = std::path::Path::new(&file_path).to_path_buf();
    
    if resolved.is_relative() {
        resolved = base.join(resolved);
    }

    fs::read_to_string(&resolved)
        .map_err(|e| format!("Failed to read file {:?}: {}", resolved, e))
}

#[tauri::command]
async fn write_acp_file(
    workspace_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    use std::fs;

    let base = std::path::Path::new(&workspace_path);
    let mut resolved = std::path::Path::new(&file_path).to_path_buf();
    
    if resolved.is_relative() {
        resolved = base.join(resolved);
    }

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories {:?}: {}", parent, e))?;
    }

    fs::write(&resolved, content)
        .map_err(|e| format!("Failed to write file {:?}: {}", resolved, e))
}

#[derive(serde::Serialize)]
struct AcpTerminalResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    signal: Option<String>,
}

#[tauri::command]
async fn run_acp_terminal(
    state: State<'_, Arc<AppState>>,
    terminal_id: String,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env_vars: Option<HashMap<String, String>>,
) -> Result<AcpTerminalResult, String> {
    use std::process::Stdio;
    use tokio::io::AsyncReadExt;
    use tokio::time::timeout;
    use std::time::Duration;

    let mut cmd = crate::build_agent_command(&command);

    cmd.args(&args)
       .stdin(Stdio::null())
       .stdout(Stdio::piped())
       .stderr(Stdio::piped());

    if let Some(dir) = &cwd {
        cmd.current_dir(dir);
    }

    if let Some(envs) = &env_vars {
        for (k, v) in envs {
            if !v.is_empty() {
                cmd.env(k, v);
            }
        }
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn terminal command: {}", e))?;
    let mut stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let (kill_tx, mut kill_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut terminals = state.supervisor.active_terminals.lock().await;
        terminals.insert(terminal_id.clone(), kill_tx);
    }

    let run = async {
        let mut out_buf = Vec::new();
        let mut err_buf = Vec::new();
        let (_, _, status) = tokio::join!(
            async { stdout.read_to_end(&mut out_buf).await },
            async { stderr.read_to_end(&mut err_buf).await },
            child.wait()
        );
        let st = status.map_err(|e| format!("Wait failed: {}", e))?;
        Ok::<_, String>((out_buf, err_buf, st))
    };

    // 5 minute timeout for long-running commands, select with kill signal
    let run_res = tokio::select! {
        res = timeout(Duration::from_secs(300), run) => {
            match res {
                Ok(Ok((out_buf, err_buf, status))) => {
                    Ok(AcpTerminalResult {
                        stdout: String::from_utf8_lossy(&out_buf).to_string(),
                        stderr: String::from_utf8_lossy(&err_buf).to_string(),
                        exit_code: status.code(),
                        signal: None,
                    })
                }
                Ok(Err(e)) => Err(e),
                Err(_) => {
                    let _ = child.kill().await;
                    Ok(AcpTerminalResult {
                        stdout: String::new(),
                        stderr: "Command timed out after 300 seconds".to_string(),
                        exit_code: None,
                        signal: Some("SIGTERM".to_string()),
                    })
                }
            }
        }
        _ = &mut kill_rx => {
            let _ = child.kill().await;
            Ok(AcpTerminalResult {
                stdout: String::new(),
                stderr: "Command terminated by user request".to_string(),
                exit_code: None,
                signal: Some("SIGKILL".to_string()),
            })
        }
    };

    {
        let mut terminals = state.supervisor.active_terminals.lock().await;
        terminals.remove(&terminal_id);
    }

    run_res
}

#[tauri::command]
async fn kill_acp_terminal(
    state: State<'_, Arc<AppState>>,
    terminal_id: String,
) -> Result<(), String> {
    state.supervisor.kill_terminal(&terminal_id).await;
    Ok(())
}

#[tauri::command]
async fn kill_all_acp_terminals(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    state.supervisor.kill_all_terminals().await;
    Ok(())
}

#[tauri::command]
async fn browse_filesystem(path: Option<String>) -> Result<serde_json::Value, String> {
    use std::fs;
    use std::path::PathBuf;

    let start_path = if let Some(ref p) = path {
        if p.is_empty() {
            std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
        } else {
            PathBuf::from(p)
        }
    } else {
        std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
    };

    let abs = fs::canonicalize(&start_path)
        .or_else(|_| {
            if start_path.exists() {
                Ok(start_path.clone())
            } else {
                Err(format!("Path does not exist: {:?}", start_path))
            }
        })
        .map_err(|e| e.to_string())?;

    let parent_path = abs.parent().map(|p| p.to_string_lossy().to_string());
    let mut subdirs = Vec::new();
    if let Ok(entries) = fs::read_dir(&abs) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if !name.starts_with('.') && name != "node_modules" && name != "target" && name != "dist" {
                        subdirs.push(name.to_string());
                    }
                }
            }
        }
    }
    subdirs.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    Ok(serde_json::json!({
        "current_path": abs.to_string_lossy().to_string(),
        "parent_path": parent_path,
        "subdirs": subdirs,
    }))
}

#[tauri::command]
async fn select_workspace_dialog() -> Result<Option<String>, String> {
    use std::process::Command;
    let output = Command::new("zenity")
        .args(&["--file-selection", "--directory", "--title=选择工作区目录"])
        .output();
        
    match output {
        Ok(out) => {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    Ok(Some(path))
                } else {
                    Ok(None)
                }
            } else {
                Ok(None)
            }
        }
        Err(e) => {
            Err(format!("Failed to run zenity dialog: {}", e))
        }
    }
}

// ==========================================
// Application Entry Point
// ==========================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 1. Resolve application data folder path
            let app_dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("./"));
            
            // 2. Initialize Sqlite database and schemas
            let pool = tauri::async_runtime::block_on(config::init_db(&app_dir))
                .expect("Failed to initialize database");
            
            // 3. Initialize active subprocess supervisor
            let supervisor = Arc::new(SubAgentSupervisor::new());
            
            // 4. Start Axum HTTP/WS Daemon server in background thread
            let app_handle = app.handle().clone();
            let pool_clone = pool.clone();
            let supervisor_clone = supervisor.clone();
            tauri::async_runtime::spawn(async move {
                daemon::start_daemon(pool_clone, supervisor_clone, app_handle).await;
            });
            
            // 5. Inject managed shared state
            app.manage(Arc::new(AppState {
                pool,
                supervisor,
                app_handle: app.handle().clone(),
            }));
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config_val,
            set_config_val,
            load_session_data,
            save_session_data,
            run_subagent,
            write_subagent_stdin,
            kill_subagent,
            get_registered_agents,
            save_agent_to_registry,
            delete_agent_from_registry,
            test_agent_availability,
            get_chat_sessions,
            save_chat_session,
            delete_chat_session,
            list_workspace_files,
            read_acp_file,
            write_acp_file,
            run_acp_terminal,
            kill_acp_terminal,
            kill_all_acp_terminals,
            select_workspace_dialog,
            browse_filesystem
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
