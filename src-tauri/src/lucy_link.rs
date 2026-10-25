use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use serde::{Deserialize, Serialize};

pub const LUCY_LINK_PORT: u16 = 52442;

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PairingData {
    pub ip: String,
    pub port: u16,
    pub secret: String,
    pub name: String,
    pub qr_uri: String,
}

#[derive(Clone, Debug)]
pub enum WsOutMsg {
    Text(String),
    Pong(Vec<u8>),
}

pub struct LucyLinkState {
    pub pairing_secret: String,
    pub local_ip: String,
    pub device_name: String,
    pub connected_device: Option<String>,
    pub client_tx: Option<mpsc::Sender<WsOutMsg>>,
    pub pending_tasks: HashMap<String, oneshot::Sender<String>>,
    pub connection_generation: u64,
    pub listener_started: bool,
}

pub fn detect_best_local_ip() -> String {
    // 1. Try listing interfaces and pick the best private IPv4 (e.g. 192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        // Priority 1: 192.168.x.x (typical Wi-Fi or LAN home network)
        for (_, ip) in &interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 192 && octets[1] == 168 {
                    return ipv4.to_string();
                }
            }
        }
        // Priority 2: 10.x.x.x
        for (_, ip) in &interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 10 {
                    return ipv4.to_string();
                }
            }
        }
        // Priority 3: 172.16-31.x.x
        for (_, ip) in &interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                let octets = ipv4.octets();
                if octets[0] == 172 && (16..=31).contains(&octets[1]) {
                    return ipv4.to_string();
                }
            }
        }
        // Priority 4: Any non-loopback, non-link-local IPv4
        for (_, ip) in &interfaces {
            if let std::net::IpAddr::V4(ipv4) = ip {
                if !ipv4.is_loopback() && !ipv4.is_link_local() {
                    return ipv4.to_string();
                }
            }
        }
    }

    if let Ok(ip) = local_ip_address::local_ip() {
        if !ip.is_loopback() {
            return ip.to_string();
        }
    }

    "127.0.0.1".to_string()
}

impl LucyLinkState {
    pub fn new() -> Self {
        let device_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Lucy-PC".to_string());

        Self {
            // Defer random key generation until the user explicitly starts pairing.
            pairing_secret: String::new(),
            // Network-interface discovery is deferred until the user opens Phone Link.
            local_ip: "127.0.0.1".to_string(),
            device_name,
            connected_device: None,
            client_tx: None,
            pending_tasks: HashMap::new(),
            connection_generation: 0,
            listener_started: false,
        }
    }
}

pub type SharedLucyLinkState = Arc<Mutex<LucyLinkState>>;

fn load_or_create_pairing_secret(app: &AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| format!("Cannot locate Lucy's app data folder: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Cannot prepare Lucy's app data folder: {e}"))?;
    let key_path = data_dir.join("lucy-link.key");
    if let Ok(saved) = std::fs::read_to_string(&key_path) {
        let saved = saved.trim().to_ascii_lowercase();
        if saved.len() == 32 && saved.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Ok(saved);
        }
        std::fs::remove_file(&key_path).map_err(|e| format!("Cannot replace the invalid Lucy Link pairing key: {e}"))?;
    }

    let secret: String = (0..16).map(|_| format!("{:02x}", rand::random::<u8>())).collect();
    let temporary_path = data_dir.join("lucy-link.key.tmp");
    std::fs::write(&temporary_path, &secret).map_err(|e| format!("Cannot save Lucy Link pairing key: {e}"))?;
    std::fs::rename(&temporary_path, &key_path).map_err(|e| format!("Cannot finalize Lucy Link pairing key: {e}"))?;
    Ok(secret)
}

/// Bind only on explicit pairing. A bind failure is returned to the settings page
/// and never escapes into Tauri setup, which keeps normal app launch independent.
async fn ensure_lucy_link_server(app_handle: AppHandle, state: SharedLucyLinkState) -> Result<(), String> {
    let mut s = state.lock().await;
    if s.listener_started {
        return Ok(());
    }

    let listener = TcpListener::bind(("0.0.0.0", LUCY_LINK_PORT)).await
        .map_err(|e| format!("Could not start Phone Link on port {LUCY_LINK_PORT}: {e}"))?;
    if s.pairing_secret.is_empty() {
        s.pairing_secret = load_or_create_pairing_secret(&app_handle)?;
    }
    s.local_ip = detect_best_local_ip();
    s.listener_started = true;
    drop(s);

    tauri::async_runtime::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _peer_addr)) => {
                    let app = app_handle.clone();
                    let shared = state.clone();
                    tokio::spawn(async move { handle_client_connection(stream, app, shared).await; });
                }
                Err(error) => {
                    eprintln!("[LucyLink] Listener stopped after an accept error: {error}");
                    state.lock().await.listener_started = false;
                    break;
                }
            }
        }
    });
    Ok(())
}

async fn handle_client_connection(
    stream: TcpStream,
    app_handle: AppHandle,
    state: SharedLucyLinkState,
) {
    let ws_stream = match tokio_tungstenite::accept_async_with_config(
        stream,
        Some(tokio_tungstenite::tungstenite::protocol::WebSocketConfig {
            max_message_size: Some(16 * 1024),
            max_frame_size: Some(16 * 1024),
            ..Default::default()
        }),
    ).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[LucyLink] WebSocket handshake failed: {}", e);
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = mpsc::channel::<WsOutMsg>(64);

    // Outgoing message forwarder
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let res = match msg {
                WsOutMsg::Text(t) => write.send(Message::Text(t)).await,
                WsOutMsg::Pong(p) => write.send(Message::Pong(p)).await,
            };
            if let Err(e) = res {
                eprintln!("[LucyLink] Error sending WS message: {}", e);
                break;
            }
        }
    });

    let mut authenticated = false;
    let mut my_conn_gen: u64 = 0;

    let authentication_timeout = tokio::time::sleep(std::time::Duration::from_secs(10));
    tokio::pin!(authentication_timeout);
    loop {
        let next_message = tokio::select! {
            _ = &mut authentication_timeout, if !authenticated => break,
            message = read.next() => message,
        };
        let Some(msg_result) = next_message else { break; };
        match msg_result {
            Ok(Message::Text(text)) => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    if !authenticated {
                        if msg_type == "AUTH" {
                            let received_secret = json.get("secret").and_then(|v| v.as_str()).unwrap_or("");
                            let device = json.get("deviceName").and_then(|v| v.as_str()).unwrap_or("Android Phone");
                            let device = if device.trim().is_empty() { "Android Phone" } else { device.trim() };
                            let device: String = device.chars().filter(|c| !c.is_control()).take(64).collect();

                            let expected_secret = {
                                let s = state.lock().await;
                                s.pairing_secret.clone()
                            };

                            let same_secret = received_secret.len() == expected_secret.len()
                                && received_secret.as_bytes().iter().zip(expected_secret.as_bytes())
                                    .fold(0u8, |diff, (a, b)| diff | (a ^ b)) == 0;
                            if same_secret {
                                authenticated = true;

                                my_conn_gen = {
                                    let mut s = state.lock().await;
                                    s.connection_generation += 1;
                                    s.connected_device = Some(device.clone());
                                    s.client_tx = Some(tx.clone());
                                    s.connection_generation
                                };

                                println!("[LucyLink] Authenticated with mobile device: {}", device);

                                // Reply AUTH_OK with real PC device name
                                let pc_name = {
                                    let s = state.lock().await;
                                    s.device_name.clone()
                                };
                                let auth_ok = serde_json::json!({
                                    "type": "AUTH_OK",
                                    "name": pc_name
                                });
                                let _ = tx.try_send(WsOutMsg::Text(auth_ok.to_string()));

                                // Notify Tauri frontend
                                let _ = app_handle.emit("lucy_link_status", serde_json::json!({
                                    "connected": true,
                                    "deviceName": device
                                }));
                            } else {
                                eprintln!("[LucyLink] Authentication failed: secret mismatch");
                                let auth_fail = serde_json::json!({
                                    "type": "AUTH_FAIL",
                                    "reason": "Invalid secret"
                                });
                                let _ = tx.try_send(WsOutMsg::Text(auth_fail.to_string()));
                                break;
                            }
                        }
                        continue;
                    }

                    // Authenticated messages:
                    match msg_type {
                        "PROMPT_DELEGATION" => {
                            let task_id = json.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
                            let prompt = json.get("prompt").and_then(|v| v.as_str()).unwrap_or("");

                            if task_id.is_empty() || task_id.len() > 64 || prompt.trim().is_empty() || prompt.len() > 4000 {
                                continue;
                            }

                            // Forward to Tauri frontend to execute with PC agent / tools
                            let _ = app_handle.emit("lucy_mobile_prompt", serde_json::json!({
                                "taskId": task_id,
                                "prompt": prompt
                            }));
                        }

                        "PROMPT_RESULT" => {
                            let task_id = json.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
                            let summary = json.get("summary").and_then(|v| v.as_str()).unwrap_or("");

                            if task_id.is_empty() || task_id.len() > 64 || summary.len() > 4000 {
                                continue;
                            }

                            // Resolve pending Rust command if any
                            let sender = {
                                let mut s = state.lock().await;
                                s.pending_tasks.remove(task_id)
                            };
                            if let Some(s) = sender {
                                let _ = s.send(summary.to_string());
                            }

                            // Also emit to Tauri frontend
                            let _ = app_handle.emit("lucy_mobile_result", json);
                        }

                        "PING" => {
                            let pong = serde_json::json!({ "type": "PONG" });
                            let _ = tx.try_send(WsOutMsg::Text(pong.to_string()));
                        }

                        _ => {}
                    }
                }
            }
            Ok(Message::Ping(payload)) => {
                let _ = tx.try_send(WsOutMsg::Pong(payload));
            }
            Ok(Message::Pong(_)) => {}
            Ok(Message::Close(_)) => {
                println!("[LucyLink] Mobile client disconnected");
                break;
            }
            Err(e) => {
                eprintln!("[LucyLink] WebSocket read error: {}", e);
                break;
            }
            _ => {}
        }
    }

    write_task.abort();

    // Clean up state ONLY if this connection is still the active one
    let should_notify = {
        let mut s = state.lock().await;
        if authenticated && s.connection_generation == my_conn_gen {
            s.connected_device = None;
            s.client_tx = None;
            true
        } else {
            false
        }
    };

    if should_notify {
        let _ = app_handle.emit("lucy_link_status", serde_json::json!({
            "connected": false,
            "deviceName": null
        }));
    }
}

// ── Tauri Commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn get_lucy_link_pairing_data(app: AppHandle, state: tauri::State<'_, SharedLucyLinkState>) -> Result<PairingData, String> {
    ensure_lucy_link_server(app, state.inner().clone()).await?;
    let mut s = state.lock().await;
    if s.local_ip == "127.0.0.1" || s.local_ip.is_empty() || s.local_ip.starts_with("169.254.") {
        s.local_ip = detect_best_local_ip();
    }
    if s.local_ip == "127.0.0.1" || s.local_ip.starts_with("169.254.") {
        return Err("No reachable local network address was found. Connect this PC and phone to the same Wi-Fi network.".to_string());
    }
    let safe_name: String = s.device_name.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
    let qr_uri = format!(
        "lucy://pair?ip={}&port={}&secret={}&name={}",
        s.local_ip,
        LUCY_LINK_PORT,
        s.pairing_secret,
        safe_name
    );

    Ok(PairingData {
        ip: s.local_ip.clone(),
        port: LUCY_LINK_PORT,
        secret: s.pairing_secret.clone(),
        name: s.device_name.clone(),
        qr_uri,
    })
}

#[tauri::command]
pub async fn send_prompt_to_phone(
    prompt: String,
    state: tauri::State<'_, SharedLucyLinkState>,
) -> Result<String, String> {
    if prompt.trim().is_empty() || prompt.len() > 4000 {
        return Err("Phone task must contain 1 to 4000 bytes".to_string());
    }
    let (tx, task_id, rx) = {
        let mut s = state.lock().await;
        let tx = s.client_tx.clone().ok_or("No mobile device connected via LucyLink")?;
        if s.pending_tasks.len() >= 16 {
            return Err("Too many phone tasks are already pending".to_string());
        }
        let task_id: String = (0..16).map(|_| format!("{:02x}", rand::random::<u8>())).collect();
        let (resp_tx, resp_rx) = oneshot::channel();
        s.pending_tasks.insert(task_id.clone(), resp_tx);
        (tx, task_id, resp_rx)
    };

    let envelope = serde_json::json!({
        "type": "PROMPT_DELEGATION",
        "taskId": task_id,
        "prompt": prompt,
        "origin": "PC",
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    });

    if tx.try_send(WsOutMsg::Text(envelope.to_string())).is_err() {
        state.lock().await.pending_tasks.remove(&task_id);
        return Err("Failed to send task to phone".to_string());
    }

    // Wait up to 45 seconds for mobile agent result
    match tokio::time::timeout(std::time::Duration::from_secs(45), rx).await {
        Ok(Ok(summary)) => Ok(summary),
        Ok(Err(_)) => Err("Response channel closed prematurely by mobile".to_string()),
        Err(_) => {
            // Remove pending task on timeout
            let mut s = state.lock().await;
            s.pending_tasks.remove(&task_id);
            Err("Timeout waiting for phone to complete task".to_string())
        }
    }
}

#[tauri::command]
pub async fn resolve_mobile_prompt(
    task_id: String,
    success: bool,
    summary: String,
    state: tauri::State<'_, SharedLucyLinkState>,
) -> Result<(), String> {
    if task_id.is_empty() || task_id.len() > 64 || summary.len() > 4000 {
        return Err("Invalid phone task response".to_string());
    }
    let tx = {
        let s = state.lock().await;
        s.client_tx.clone()
    };

    if let Some(tx) = tx {
        let envelope = serde_json::json!({
            "type": "PROMPT_RESULT",
            "taskId": task_id,
            "status": if success { "SUCCESS" } else { "FAILED" },
            "summary": summary
        });

        if tx.try_send(WsOutMsg::Text(envelope.to_string())).is_err() {
            eprintln!("[LucyLink] Failed to send prompt result to mobile");
        } else {
            println!("[LucyLink] Successfully sent prompt result to mobile for task [{}]", task_id);
        }
    } else {
        eprintln!("[LucyLink] Mobile client not connected, skipping prompt result for task [{}]", task_id);
    }

    Ok(())
}

#[tauri::command]
pub async fn get_lucy_link_status(state: tauri::State<'_, SharedLucyLinkState>) -> Result<serde_json::Value, String> {
    let mut s = state.lock().await;
    if s.listener_started && (s.local_ip == "127.0.0.1" || s.local_ip.is_empty() || s.local_ip.starts_with("169.254.")) {
        s.local_ip = detect_best_local_ip();
    }
    Ok(serde_json::json!({
        "connected": s.connected_device.is_some(),
        "connectedDevice": s.connected_device,
        "localIp": s.local_ip,
        "port": LUCY_LINK_PORT,
        "deviceName": s.device_name
    }))
}
