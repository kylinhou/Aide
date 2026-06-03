use axum::{
    extract::{State, WebSocketUpgrade},
    extract::ws::{Message, WebSocket},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use sqlx::SqlitePool;
use std::sync::Arc;
use std::collections::HashMap;
use std::net::SocketAddr;
use tokio::sync::Mutex;
use serde::{Serialize, Deserialize};
use tauri::AppHandle;
use tower_http::cors::{CorsLayer, Any};
use tower_http::services::ServeDir;

use crate::config::{self, SubAgent};
use crate::memory::MemoryManager;
use crate::supervisor::SubAgentSupervisor;

// Shared Axum State
pub struct AppState {
    pub pool: SqlitePool,
    pub supervisor: Arc<SubAgentSupervisor>,
    pub app_handle: AppHandle,
}

#[derive(Deserialize)]
pub struct ConfigGetRequest {
    pub key: String,
}

#[derive(Serialize)]
pub struct ConfigGetResponse {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Deserialize)]
pub struct ConfigSetRequest {
    pub key: String,
    pub value: String,
}

#[derive(Deserialize)]
pub struct SessionLoadRequest {
    pub id: String,
}

#[derive(Serialize)]
pub struct SessionLoadResponse {
    pub id: String,
    pub title: String,
    pub snapshot: Vec<u8>,
}

#[derive(Deserialize)]
pub struct SessionSaveRequest {
    pub id: String,
    pub title: String,
    pub snapshot: Vec<u8>,
}

#[derive(Deserialize)]
pub struct AgentRunRequest {
    pub agent_id: String,
    pub exec_path: String,
    pub args: Vec<String>,
    pub env_vars: HashMap<String, String>,
    pub cwd: Option<String>,
}

#[derive(Deserialize)]
pub struct AgentWriteRequest {
    pub agent_id: String,
    pub message: String,
}

#[derive(Deserialize)]
pub struct AgentKillRequest {
    pub agent_id: String,
}

// Router and initialization
pub async fn start_daemon(
    pool: SqlitePool,
    supervisor: Arc<SubAgentSupervisor>,
    app_handle: AppHandle,
) {
    let state = Arc::new(AppState {
        pool,
        supervisor,
        app_handle,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/config/get", post(handle_config_get))
        .route("/api/config/set", post(handle_config_set))
        .route("/api/session/load", post(handle_session_load))
        .route("/api/session/save", post(handle_session_save))
        .route("/api/agent/run", post(handle_agent_run))
        .route("/api/agent/write", post(handle_agent_write))
        .route("/api/agent/kill", post(handle_agent_kill))
        .route("/api/invoke", post(handle_invoke))
        .route("/ws", axum::routing::get(handle_websocket))
        .fallback_service(tower_http::services::ServeDir::new({
            if std::path::Path::new("dist").exists() {
                "dist".to_string()
            } else if std::path::Path::new("../dist").exists() {
                "../dist".to_string()
            } else {
                "dist".to_string()
            }
        }))
        .layer(cors)
        .layer(axum::middleware::from_fn_with_state(state.clone(), auth_middleware))
        .with_state(state.clone());

    let allow_external = config::get_config(&state.pool, "allow_external").await;
    let allow_external = allow_external.map(|v| v == "true").unwrap_or(false);

    let ip = if allow_external { [0, 0, 0, 0] } else { [127, 0, 0, 1] };
    let addr = SocketAddr::from((ip, 17790));
    println!("Axum Daemon listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
}

// Authentication middleware to check password for remote/external requests
async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let path = req.uri().path();
    
    // Only check password for API endpoints and WebSocket connection
    if path.starts_with("/api/") || path == "/ws" {
        let password_opt = config::get_config(&state.pool, "access_password").await;
        if let Some(password) = password_opt {
            if !password.is_empty() {
                let headers = req.headers();
                let auth_header = headers.get(axum::http::header::AUTHORIZATION)
                    .and_then(|h| h.to_str().ok());
                let custom_header = headers.get("x-aide-password")
                    .and_then(|h| h.to_str().ok());
                
                let mut provided_password = None;

                if let Some(auth) = auth_header {
                    if auth.starts_with("Bearer ") {
                        provided_password = Some(auth["Bearer ".len()..].to_string());
                    } else {
                        provided_password = Some(auth.to_string());
                    }
                } else if let Some(custom) = custom_header {
                    provided_password = Some(custom.to_string());
                } else if let Some(query) = req.uri().query() {
                    for pair in query.split('&') {
                        let mut parts = pair.splitn(2, '=');
                        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                            if k == "password" || k == "token" {
                                provided_password = Some(v.to_string());
                                break;
                            }
                        }
                    }
                }

                match provided_password {
                    Some(p) if p == password => {}
                    _ => {
                        return (
                            axum::http::StatusCode::UNAUTHORIZED,
                            axum::Json(serde_json::json!({
                                "code": 401,
                                "msg": "Unauthorized: Invalid access password"
                            }))
                        ).into_response();
                    }
                }
            }
        }
    }

    next.run(req).await
}

#[derive(serde::Deserialize)]
pub struct InvokeRequest {
    pub cmd: String,
    pub args: serde_json::Value,
}

#[derive(serde::Serialize)]
struct AcpTerminalResult {
    stdout: String,
    stderr: String,
    exit_code: Option<i32>,
    signal: Option<String>,
}

// Unified programmatic RPC bridge to dispatch and reuse all Tauri commands via HTTP
pub async fn handle_invoke(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<InvokeRequest>,
) -> impl IntoResponse {
    let cmd = payload.cmd.as_str();
    let args = payload.args;

    let res: Result<serde_json::Value, String> = match cmd {
        "get_config_val" => {
            let key: String = serde_json::from_value(args["key"].clone()).unwrap_or_default();
            let val = config::get_config(&state.pool, &key).await;
            Ok(serde_json::to_value(val).unwrap())
        }
        "set_config_val" => {
            let key: String = serde_json::from_value(args["key"].clone()).unwrap_or_default();
            let value: String = serde_json::from_value(args["value"].clone()).unwrap_or_default();
            config::set_config(&state.pool, &key, &value).await
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "load_session_data" => {
            let session_id: String = serde_json::from_value(args["sessionId"].clone())
                .or_else(|_| serde_json::from_value(args["session_id"].clone()))
                .unwrap_or_default();
            MemoryManager::load_session(&state.pool, &session_id).await
                .map(|doc| serde_json::to_value(doc.export_snapshot()).unwrap())
                .map_err(|e| e.to_string())
        }
        "save_session_data" => {
            let session_id: String = serde_json::from_value(args["sessionId"].clone())
                .or_else(|_| serde_json::from_value(args["session_id"].clone()))
                .unwrap_or_default();
            let title: String = serde_json::from_value(args["title"].clone()).unwrap_or_default();
            let snapshot: Vec<u8> = serde_json::from_value(args["snapshot"].clone()).unwrap_or_default();
            
            let doc = loro::LoroDoc::new();
            let mut import_ok = true;
            let mut import_err = String::new();
            if !snapshot.is_empty() {
                if let Err(e) = doc.import(&snapshot) {
                    import_ok = false;
                    import_err = e.to_string();
                }
            }
            if !import_ok {
                Err(import_err)
            } else {
                MemoryManager::save_session(&state.pool, &session_id, &title, &doc).await
                    .map(|_| serde_json::Value::Null)
                    .map_err(|e| e.to_string())
            }
        }
        "run_subagent" => {
            let agent_id: String = serde_json::from_value(args["agentId"].clone())
                .or_else(|_| serde_json::from_value(args["agent_id"].clone()))
                .unwrap_or_default();
            let exec_path: String = serde_json::from_value(args["execPath"].clone())
                .or_else(|_| serde_json::from_value(args["exec_path"].clone()))
                .unwrap_or_default();
            let sub_args: Vec<String> = serde_json::from_value(args["args"].clone()).unwrap_or_default();
            let env_vars: HashMap<String, String> = serde_json::from_value(args["envVars"].clone())
                .or_else(|_| serde_json::from_value(args["env_vars"].clone()))
                .unwrap_or_default();
            let cwd: Option<String> = serde_json::from_value(args["cwd"].clone())
                .or_else(|_| serde_json::from_value(args["workspacePath"].clone()))
                .or_else(|_| serde_json::from_value(args["workspace_path"].clone()))
                .ok();

            state.supervisor.spawn_agent(
                state.app_handle.clone(),
                &agent_id,
                &exec_path,
                sub_args,
                env_vars,
                cwd,
            ).await
            .map(|_| serde_json::Value::Null)
            .map_err(|e| e.to_string())
        }
        "write_subagent_stdin" => {
            let agent_id: String = serde_json::from_value(args["agentId"].clone())
                .or_else(|_| serde_json::from_value(args["agent_id"].clone()))
                .unwrap_or_default();
            let message: String = serde_json::from_value(args["message"].clone()).unwrap_or_default();
            state.supervisor.write_stdin(&agent_id, &message).await
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "kill_subagent" => {
            let agent_id: String = serde_json::from_value(args["agentId"].clone())
                .or_else(|_| serde_json::from_value(args["agent_id"].clone()))
                .unwrap_or_default();
            state.supervisor.kill_agent(&agent_id).await
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "get_registered_agents" => {
            config::list_registered_agents(&state.pool).await
                .map(|agents| serde_json::to_value(agents).unwrap())
                .map_err(|e| e.to_string())
        }
        "save_agent_to_registry" => {
            let agent: config::SubAgent = serde_json::from_value(args["agent"].clone()).unwrap_or_else(|_| {
                let agent_id: String = serde_json::from_value(args["agent"]["agent_id"].clone()).unwrap_or_default();
                let name: String = serde_json::from_value(args["agent"]["name"].clone()).unwrap_or_default();
                let path: String = serde_json::from_value(args["agent"]["path"].clone()).unwrap_or_default();
                let version: String = serde_json::from_value(args["agent"]["version"].clone()).unwrap_or_default();
                let env_vars: Option<String> = serde_json::from_value(args["agent"]["env_vars"].clone()).unwrap_or_default();
                config::SubAgent { agent_id, name, path, version, env_vars }
            });
            config::save_registered_agent(&state.pool, &agent).await
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "delete_agent_from_registry" => {
            let agent_id: String = serde_json::from_value(args["agentId"].clone())
                .or_else(|_| serde_json::from_value(args["agent_id"].clone()))
                .unwrap_or_default();
            config::delete_registered_agent(&state.pool, &agent_id).await
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "get_chat_sessions" => {
            config::list_chat_sessions(&state.pool).await
                .map(|sessions| serde_json::to_value(sessions).unwrap())
                .map_err(|e| e.to_string())
        }
        "save_chat_session" => {
            let session: config::ChatSession = serde_json::from_value(args["session"].clone()).unwrap_or_else(|_| {
                let id: String = serde_json::from_value(args["session"]["id"].clone()).unwrap_or_default();
                let title: String = serde_json::from_value(args["session"]["title"].clone()).unwrap_or_default();
                let workspace_path: String = serde_json::from_value(args["session"]["workspace_path"].clone()).unwrap_or_default();
                let agent_id: String = serde_json::from_value(args["session"]["agent_id"].clone()).unwrap_or_default();
                let messages: String = serde_json::from_value(args["session"]["messages"].clone()).unwrap_or_default();
                let updated_at: Option<String> = serde_json::from_value(args["session"]["updated_at"].clone()).unwrap_or_default();
                config::ChatSession { id, title, workspace_path, agent_id, messages, updated_at }
            });
            config::save_chat_session(&state.pool, &session).await
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "delete_chat_session" => {
            let id: String = serde_json::from_value(args["id"].clone()).unwrap_or_default();
            config::delete_chat_session(&state.pool, &id).await
                .map(|_| serde_json::Value::Null)
                .map_err(|e| e.to_string())
        }
        "list_workspace_files" => {
            let workspace_path: String = serde_json::from_value(args["workspacePath"].clone())
                .or_else(|_| serde_json::from_value(args["workspace_path"].clone()))
                .unwrap_or_default();
            
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
                Err("工作区路径不存在或不是一个目录".to_string())
            } else {
                let mut files = Vec::new();
                match scan_dir_recursive(base_path, base_path, &mut files) {
                    Ok(_) => Ok(serde_json::to_value(files).unwrap()),
                    Err(e) => Err(format!("扫描目录出错: {}", e)),
                }
            }
        }
        "read_acp_file" => {
            let workspace_path: String = serde_json::from_value(args["workspacePath"].clone())
                .or_else(|_| serde_json::from_value(args["workspace_path"].clone()))
                .unwrap_or_default();
            let file_path: String = serde_json::from_value(args["filePath"].clone())
                .or_else(|_| serde_json::from_value(args["file_path"].clone()))
                .unwrap_or_default();
            
            let base = std::path::Path::new(&workspace_path);
            let mut resolved = std::path::Path::new(&file_path).to_path_buf();
            
            if resolved.is_relative() {
                resolved = base.join(resolved);
            }

            std::fs::read_to_string(&resolved)
                .map(|content| serde_json::to_value(content).unwrap())
                .map_err(|e| format!("Failed to read file {:?}: {}", resolved, e))
        }
        "write_acp_file" => {
            let workspace_path: String = serde_json::from_value(args["workspacePath"].clone())
                .or_else(|_| serde_json::from_value(args["workspace_path"].clone()))
                .unwrap_or_default();
            let file_path: String = serde_json::from_value(args["filePath"].clone())
                .or_else(|_| serde_json::from_value(args["file_path"].clone()))
                .unwrap_or_default();
            let content: String = serde_json::from_value(args["content"].clone()).unwrap_or_default();
            
            let base = std::path::Path::new(&workspace_path);
            let mut resolved = std::path::Path::new(&file_path).to_path_buf();
            
            if resolved.is_relative() {
                resolved = base.join(resolved);
            }

            let mut write_ok = true;
            let mut write_err = String::new();
            if let Some(parent) = resolved.parent() {
                if let Err(e) = std::fs::create_dir_all(parent) {
                    write_ok = false;
                    write_err = format!("Failed to create directories {:?}: {}", parent, e);
                }
            }

            if !write_ok {
                Err(write_err)
            } else {
                std::fs::write(&resolved, content)
                    .map(|_| serde_json::Value::Null)
                    .map_err(|e| format!("Failed to write file {:?}: {}", resolved, e))
            }
        }
        "run_acp_terminal" => {
            let terminal_id: String = serde_json::from_value(args["terminalId"].clone())
                .or_else(|_| serde_json::from_value(args["terminal_id"].clone()))
                .unwrap_or_default();
            let command: String = serde_json::from_value(args["command"].clone()).unwrap_or_default();
            let sub_args: Vec<String> = serde_json::from_value(args["args"].clone()).unwrap_or_default();
            let cwd: Option<String> = serde_json::from_value(args["cwd"].clone()).unwrap_or_default();
            let env_vars: Option<HashMap<String, String>> = serde_json::from_value(args["envVars"].clone())
                .or_else(|_| serde_json::from_value(args["env_vars"].clone()))
                .unwrap_or_default();

            use std::process::Stdio;
            use tokio::io::AsyncReadExt;
            use tokio::time::timeout;
            use std::time::Duration;

            let mut cmd_proc = if cfg!(target_os = "windows") {
                let mut c = tokio::process::Command::new("cmd");
                c.args(&["/c", &command]);
                c
            } else {
                tokio::process::Command::new(&command)
            };

            cmd_proc.args(&sub_args)
               .stdin(Stdio::null())
               .stdout(Stdio::piped())
               .stderr(Stdio::piped());

            if let Some(dir) = &cwd {
                cmd_proc.current_dir(dir);
            }

            if let Some(envs) = &env_vars {
                for (k, v) in envs {
                    if !v.is_empty() {
                        cmd_proc.env(k, v);
                    }
                }
            }

            let spawn_res = cmd_proc.spawn().map_err(|e| format!("Failed to spawn terminal command: {}", e));
            match spawn_res {
                Err(e) => Err(e),
                Ok(mut child) => {
                    let mut stdout = child.stdout.take().unwrap();
                    let mut stderr = child.stderr.take().unwrap();

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

                    match run_res {
                        Ok(term_res) => Ok(serde_json::to_value(term_res).unwrap()),
                        Err(e) => Err(e),
                    }
                }
            }
        }
        "kill_acp_terminal" => {
            let terminal_id: String = serde_json::from_value(args["terminalId"].clone())
                .or_else(|_| serde_json::from_value(args["terminal_id"].clone()))
                .unwrap_or_default();
            state.supervisor.kill_terminal(&terminal_id).await;
            Ok(serde_json::Value::Null)
        }
        "kill_all_acp_terminals" => {
            state.supervisor.kill_all_terminals().await;
            Ok(serde_json::Value::Null)
        }
        "test_agent_availability" => {
            let exec_path: String = serde_json::from_value(args["execPath"].clone())
                .or_else(|_| serde_json::from_value(args["exec_path"].clone()))
                .unwrap_or_default();
            let sub_args: Vec<String> = serde_json::from_value(args["args"].clone()).unwrap_or_default();
            let env_vars: HashMap<String, String> = serde_json::from_value(args["envVars"].clone())
                .or_else(|_| serde_json::from_value(args["env_vars"].clone()))
                .unwrap_or_default();
            
            use std::process::Stdio;
            use tokio::io::AsyncReadExt;
            use tokio::time::timeout;
            use std::time::Duration;

            let mut cmd_proc = if cfg!(target_os = "windows") {
                let mut c = tokio::process::Command::new("cmd");
                c.args(&["/c", &exec_path]);
                c
            } else {
                tokio::process::Command::new(&exec_path)
            };

            cmd_proc.args(sub_args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            for (k, v) in env_vars {
                if !v.is_empty() {
                    cmd_proc.env(k, v);
                }
            }

            let spawn_res = cmd_proc.spawn().map_err(|e| format!("无法启动可执行文件: {}", e));
            match spawn_res {
                Err(e) => Ok(serde_json::to_value(e).unwrap()),
                Ok(mut child) => {
                    let mut stdout = child.stdout.take().unwrap();
                    let mut stderr = child.stderr.take().unwrap();

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

                    let res_str = match timeout(Duration::from_secs(3), test_run).await {
                        Ok(Ok((status, out_buf, err_buf))) => {
                            if status.success() {
                                let stdout_str = String::from_utf8_lossy(&out_buf).trim().to_string();
                                if stdout_str.is_empty() {
                                    let stderr_str = String::from_utf8_lossy(&err_buf).trim().to_string();
                                    if stderr_str.is_empty() {
                                        "已就绪 (无版本号输出)".to_string()
                                    } else {
                                        format!("已就绪 (stderr 输出: {})", stderr_str)
                                    }
                                } else {
                                    stdout_str
                                }
                            } else {
                                let stderr_str = String::from_utf8_lossy(&err_buf).trim().to_string();
                                format!("执行失败 (Exit code: {:?}): {}", status.code(), stderr_str)
                            }
                        }
                        Ok(Err(e)) => e,
                        Err(_) => {
                            let _ = child.kill().await;
                            "检测超时 (3秒内未响应)".to_string()
                        }
                    };
                    Ok(serde_json::to_value(res_str).unwrap())
                }
            }
        }
        "browse_filesystem" => {
            let path: Option<String> = serde_json::from_value(args["path"].clone()).unwrap_or(None);
            
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

            let abs_path = fs::canonicalize(&start_path)
                .or_else(|_| {
                    if start_path.exists() {
                        Ok(start_path.clone())
                    } else {
                        Err(format!("Path does not exist: {:?}", start_path))
                    }
                })
                .map_err(|e| e.to_string());

            match abs_path {
                Err(e) => Err(e),
                Ok(abs) => {
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
            }
        }
        _ => Err(format!("Unknown RPC command: {}", cmd)),
    };

    match res {
        Ok(v) => Json(serde_json::json!({ "result": v })),
        Err(e) => Json(serde_json::json!({ "error": e })),
    }
}

// Handlers implementation

async fn handle_config_get(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ConfigGetRequest>,
) -> impl IntoResponse {
    let value = config::get_config(&state.pool, &payload.key).await;
    Json(ConfigGetResponse {
        key: payload.key,
        value,
    })
}

async fn handle_config_set(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ConfigSetRequest>,
) -> impl IntoResponse {
    let res = config::set_config(&state.pool, &payload.key, &payload.value).await;
    match res {
        Ok(_) => Json(serde_json::json!({ "code": 0, "msg": "Success" })),
        Err(e) => Json(serde_json::json!({ "code": 1, "msg": e.to_string() })),
    }
}

async fn handle_session_load(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SessionLoadRequest>,
) -> impl IntoResponse {
    let res = MemoryManager::load_session(&state.pool, &payload.id).await;
    match res {
        Ok(doc) => {
            let snapshot = doc.export_snapshot();
            let title: String = sqlx::query_as("SELECT title FROM session_store WHERE id = ?")
                .bind(&payload.id)
                .fetch_optional(&state.pool)
                .await
                .unwrap_or(None)
                .map(|r: (String,)| r.0)
                .unwrap_or_else(|| "New Session".to_string());

            Json(serde_json::json!({
                "code": 0,
                "msg": "Success",
                "data": SessionLoadResponse {
                    id: payload.id,
                    title,
                    snapshot,
                }
            }))
        }
        Err(e) => Json(serde_json::json!({ "code": 1, "msg": e })),
    }
}

async fn handle_session_save(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<SessionSaveRequest>,
) -> impl IntoResponse {
    let doc = loro::LoroDoc::new();
    if !payload.snapshot.is_empty() {
        if let Err(e) = doc.import(&payload.snapshot) {
            return Json(serde_json::json!({ "code": 1, "msg": format!("Failed to parse CRDT snapshot: {}", e) }));
        }
    }

    let res = MemoryManager::save_session(&state.pool, &payload.id, &payload.title, &doc).await;
    match res {
        Ok(_) => Json(serde_json::json!({ "code": 0, "msg": "Success" })),
        Err(e) => Json(serde_json::json!({ "code": 1, "msg": e })),
    }
}

async fn handle_agent_run(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AgentRunRequest>,
) -> impl IntoResponse {
    let res = state.supervisor.spawn_agent(
        state.app_handle.clone(),
        &payload.agent_id,
        &payload.exec_path,
        payload.args,
        payload.env_vars,
        payload.cwd,
    ).await;

    match res {
        Ok(_) => Json(serde_json::json!({ "code": 0, "msg": "Success" })),
        Err(e) => Json(serde_json::json!({ "code": 1, "msg": e })),
    }
}

async fn handle_agent_write(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AgentWriteRequest>,
) -> impl IntoResponse {
    let res = state.supervisor.write_stdin(&payload.agent_id, &payload.message).await;
    match res {
        Ok(_) => Json(serde_json::json!({ "code": 0, "msg": "Success" })),
        Err(e) => Json(serde_json::json!({ "code": 1, "msg": e })),
    }
}

async fn handle_agent_kill(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<AgentKillRequest>,
) -> impl IntoResponse {
    let res = state.supervisor.kill_agent(&payload.agent_id).await;
    match res {
        Ok(_) => Json(serde_json::json!({ "code": 0, "msg": "Success" })),
        Err(e) => Json(serde_json::json!({ "code": 1, "msg": e })),
    }
}

// WebSocket connection for real-time mobile sync
async fn handle_websocket(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| websocket_session(socket, state))
}

async fn websocket_session(socket: WebSocket, state: Arc<AppState>) {
    println!("WebSocket connection established!");
    
    use futures_util::{sink::SinkExt, stream::StreamExt};
    let (mut ws_tx, mut ws_rx) = socket.split();
    
    // Subscribe to supervisor output events and stream to WebSocket in real-time
    let mut rx = state.supervisor.broadcast_tx.subscribe();
    
    tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if ws_tx.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Read incoming WS messages (handshake/echo delta)
    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Binary(bin) = msg {
            // Echo back for Loro sync bytes
            // Note: Since we split ws, we can't easily write directly to ws_tx from this thread unless we use a mutex or a channel, but echo back for Loro sync in this simple demo isn't strictly active right now. We can just print it.
            println!("Received binary message from WebSocket: {} bytes", bin.len());
        } else if let Message::Text(text) = msg {
            println!("Received text message from WebSocket: {}", text);
        }
    }
}
