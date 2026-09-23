use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};
use tauri::{AppHandle, Emitter};
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use mdns_sd::{ServiceDaemon, ServiceInfo};
use serde::{Deserialize, Serialize};
use rand::Rng;

pub const LUCY_LINK_PORT: u16 = 52442;
pub const SERVICE_TYPE: &str = "_lucylink._tcp.local.";

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
    pub client_tx: Option<mpsc::UnboundedSender<WsOutMsg>>,
    pub pending_tasks: HashMap<String, oneshot::Sender<String>>,
    pub connection_generation: u64,
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
        let mut rng = rand::thread_rng();
        let secret: String = (0..16)
            .map(|_| format!("{:02x}", rng.gen::<u8>()))
            .collect();

        let local_ip = detect_best_local_ip();

        let device_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "Lucy-PC".to_string());

        Self {
            pairing_secret: secret,
            local_ip,
            device_name,
            connected_device: None,
            client_tx: None,
            pending_tasks: HashMap::new(),
            connection_generation: 0,
        }
    }
}

pub type SharedLucyLinkState = Arc<Mutex<LucyLinkState>>;

/**
 * Starts the LucyLink background services:
 * 1. mDNS advertisement for local ZeroConf discovery.
 * 2. Tokio WebSocket server listening on 0.0.0.0:52442.
 */
pub fn start_lucy_link_server(app_handle: AppHandle, state: SharedLucyLinkState) {
    let app_handle_clone = app_handle.clone();
    let state_clone = state.clone();

    tauri::async_runtime::spawn(async move {
        let (local_ip, device_name, _secret) = {
            let s = state_clone.lock().await;
            (s.local_ip.clone(), s.device_name.clone(), s.pairing_secret.clone())
        };

        // ── 1. Start mDNS Service Advertisement ───────────────────────
        if let Ok(mdns) = ServiceDaemon::new() {
            let host_clean = device_name.replace(" ", "-").to_lowercase();
            let mut properties = HashMap::new();
            properties.insert("name".to_string(), device_name.clone());
            properties.insert("port".to_string(), LUCY_LINK_PORT.to_string());

            let service_info = ServiceInfo::new(
                SERVICE_TYPE,
                &format!("Lucy-{}", host_clean),
                &format!("{}.local.", host_clean),
                &local_ip,
                LUCY_LINK_PORT,
                properties,
            );

            if let Ok(service) = service_info {
                if let Err(e) = mdns.register(service) {
                    eprintln!("[LucyLink] Failed to register mDNS service: {}", e);
                } else {
                    println!("[LucyLink] mDNS broadcast registered: _lucylink._tcp on port {}", LUCY_LINK_PORT);
                }
            }
        }

        // ── 2. Start TCP Listener for WebSockets ──────────────────────
        let bind_addr = format!("0.0.0.0:{}", LUCY_LINK_PORT);
        let listener = match TcpListener::bind(&bind_addr).await {
            Ok(l) => {
                println!("[LucyLink] WebSocket server listening on {}", bind_addr);
                l
            }
            Err(e) => {
                eprintln!("[LucyLink] Failed to bind WebSocket server on {}: {}", bind_addr, e);
                return;
            }
        };

        while let Ok((stream, peer_addr)) = listener.accept().await {
            println!("[LucyLink] New incoming TCP connection from {}", peer_addr);
            let app_h = app_handle_clone.clone();
            let s_ref = state_clone.clone();

            tokio::spawn(async move {
                handle_client_connection(stream, app_h, s_ref).await;
            });
        }
    });
}

async fn handle_client_connection(
    stream: TcpStream,
    app_handle: AppHandle,
    state: SharedLucyLinkState,
) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[LucyLink] WebSocket handshake failed: {}", e);
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<WsOutMsg>();

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

    while let Some(msg_result) = read.next().await {
        match msg_result {
            Ok(Message::Text(text)) => {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    if !authenticated {
                        if msg_type == "AUTH" {
                            let received_secret = json.get("secret").and_then(|v| v.as_str()).unwrap_or("");
                            let device = json.get("deviceName").and_then(|v| v.as_str()).unwrap_or("Android Phone");

                            let expected_secret = {
                                let s = state.lock().await;
                                s.pairing_secret.clone()
                            };

                            if received_secret == expected_secret {
                                authenticated = true;

                                my_conn_gen = {
                                    let mut s = state.lock().await;
                                    s.connection_generation += 1;
                                    s.connected_device = Some(device.to_string());
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
                                let _ = tx.send(WsOutMsg::Text(auth_ok.to_string()));

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
                                let _ = tx.send(WsOutMsg::Text(auth_fail.to_string()));
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

                            println!("[LucyLink] Received prompt from mobile [{}]: {}", task_id, prompt);

                            // Forward to Tauri frontend to execute with PC agent / tools
                            let _ = app_handle.emit("lucy_mobile_prompt", serde_json::json!({
                                "taskId": task_id,
                                "prompt": prompt
                            }));
                        }

                        "PROMPT_RESULT" => {
                            let task_id = json.get("taskId").and_then(|v| v.as_str()).unwrap_or("");
                            let summary = json.get("summary").and_then(|v| v.as_str()).unwrap_or("");

                            println!("[LucyLink] Received result from mobile for task [{}]: {}", task_id, summary);

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
                            let _ = tx.send(WsOutMsg::Text(pong.to_string()));
                        }

                        _ => {}
                    }
                }
            }
            Ok(Message::Ping(payload)) => {
                let _ = tx.send(WsOutMsg::Pong(payload));
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
pub async fn get_lucy_link_pairing_data(state: tauri::State<'_, SharedLucyLinkState>) -> Result<PairingData, String> {
    let mut s = state.lock().await;
    if s.local_ip == "127.0.0.1" || s.local_ip.is_empty() || s.local_ip.starts_with("169.254.") {
        s.local_ip = detect_best_local_ip();
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
    let (tx, task_id, rx) = {
        let mut s = state.lock().await;
        let tx = s.client_tx.clone().ok_or("No mobile device connected via LucyLink")?;
        let mut rng = rand::thread_rng();
        let task_id: String = (0..8).map(|_| format!("{:02x}", rng.gen::<u8>())).collect();
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

    tx.send(WsOutMsg::Text(envelope.to_string()))
        .map_err(|e| format!("Failed to send task to phone: {}", e))?;

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

        if let Err(e) = tx.send(WsOutMsg::Text(envelope.to_string())) {
            eprintln!("[LucyLink] Failed to send prompt result to mobile: {}", e);
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
    if s.local_ip == "127.0.0.1" || s.local_ip.is_empty() || s.local_ip.starts_with("169.254.") {
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
