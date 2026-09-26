use base64::{engine::general_purpose::STANDARD, Engine as _};
use enigo::{Enigo, Key, KeyboardControllable, MouseButton, MouseControllable};
use screenshots::Screen;
use std::sync::Mutex;
use sysinfo::System;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton as TrayMouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use ed25519_dalek::{VerifyingKey, Signature, Verifier};
use rand::RngCore;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::OnceLock;
use std::time::Duration;

mod lucy_link;

static AUTH_CALLBACK_TOKEN: OnceLock<Mutex<Option<(String, String)>>> = OnceLock::new();

// Ed25519 public key (hex string) compiled from environment
const ED25519_PUBLIC_KEY: &str = match option_env!("VITE_ED25519_PUBLIC_KEY") {
    Some(val) => val,
    None => "0000000000000000000000000000000000000000000000000000000000000000",
};

fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("Hex string length must be even".to_string());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

struct AppState {
    sys: Mutex<System>,
    authorized: Mutex<bool>,
    pro_authorized: Mutex<bool>,
    authorization_expires_at: Mutex<u64>,
    is_sleeping: Mutex<bool>,
}

fn require_authorized(state: &tauri::State<AppState>) -> Result<(), String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    if *state.authorization_expires_at.lock().map_err(|_| "Authorization state unavailable")? <= now {
        *state.authorized.lock().map_err(|_| "Authorization state unavailable")? = false;
        *state.pro_authorized.lock().map_err(|_| "Entitlement state unavailable")? = false;
        return Err("License token has expired".to_string());
    }
    if !*state.authorized.lock().map_err(|_| "Authorization state unavailable")? {
        return Err("Unauthorized".to_string());
    }
    Ok(())
}

fn require_pro(state: &tauri::State<AppState>) -> Result<(), String> {
    require_authorized(state)?;
    if !*state.pro_authorized.lock().map_err(|_| "Entitlement state unavailable")? {
        return Err("Pro entitlement required".to_string());
    }
    Ok(())
}

fn token_tier_is_pro(token_payload: &str) -> bool {
    let Some(payload) = token_payload.split('.').nth(1) else { return false };
    let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload) else { return false };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return false };
    let tier = value.get("tier").or_else(|| value.get("actual_tier"))
        .or_else(|| value.get("user").and_then(|u| u.get("tier")))
        .and_then(|v| v.as_str()).unwrap_or("").to_ascii_lowercase();
    matches!(tier.as_str(), "pc_pro" | "bundle_pro" | "pro")
}

fn verify_token(token_payload: &str, signature: &str) -> Result<serde_json::Value, String> {
    if ED25519_PUBLIC_KEY == "0000000000000000000000000000000000000000000000000000000000000000" {
        return Err("Release public key is not configured".to_string());
    }
    let pub_key_bytes = decode_hex(ED25519_PUBLIC_KEY)?;
    if pub_key_bytes.len() != 32 { return Err("Invalid public key length".to_string()); }
    let mut pub_key_arr = [0u8; 32];
    pub_key_arr.copy_from_slice(&pub_key_bytes);
    let public_key = VerifyingKey::from_bytes(&pub_key_arr).map_err(|e| format!("Invalid public key: {e}"))?;
    let sig_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(signature)
        .or_else(|_| STANDARD.decode(signature)).map_err(|_| "Invalid signature encoding".to_string())?;
    let sig_arr: [u8; 64] = sig_bytes.try_into().map_err(|_| "Invalid signature length".to_string())?;
    public_key.verify(token_payload.as_bytes(), &Signature::from_bytes(&sig_arr))
        .map_err(|_| "Invalid license signature".to_string())?;
    let payload_segment = token_payload.split('.').nth(1).ok_or("Invalid token payload")?;
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload_segment)
        .map_err(|_| "Invalid token payload encoding".to_string())?;
    let claims: serde_json::Value = serde_json::from_slice(&payload_bytes).map_err(|_| "Invalid token claims".to_string())?;
    let exp = claims.get("exp").and_then(|v| v.as_u64()).ok_or("Token is missing a valid expiry")?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    if exp <= now { return Err("License token has expired".to_string()); }
    Ok(claims)
}

#[tauri::command]
fn get_system_stats(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    require_authorized(&state)?;
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes();

    let total_memory = sys.total_memory();

    // Calculate exact RAM and CPU used by this app and its webview child processes
    let current_pid = sysinfo::get_current_pid().unwrap();
    let mut app_memory: u64 = 0;
    let mut app_cpu: f32 = 0.0;
    // We need to collect all descendants to capture the full WebView2 tree (Renderer, GPU, Network, etc.)
    let mut all_descendants = std::collections::HashSet::new();
    all_descendants.insert(current_pid);

    let processes = sys.processes();
    let mut added = true;
    while added {
        added = false;
        for (pid, process) in processes {
            if let Some(parent_pid) = process.parent() {
                if all_descendants.contains(&parent_pid) && !all_descendants.contains(pid) {
                    all_descendants.insert(*pid);
                    added = true;
                }
            }
        }
    }

    for pid in all_descendants {
        if let Some(process) = processes.get(&pid) {
            app_memory += process.memory();
            app_cpu += process.cpu_usage();
        }
    }

    Ok(serde_json::json!({
        "cpu_usage": app_cpu,
        "total_memory": total_memory,
        "used_memory": sys.used_memory(),
        "app_memory": app_memory
    }))
}

#[tauri::command]
fn open_external_url(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err("Only http, https, and mailto URLs can be opened".to_string());
    }
    app_handle
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn move_and_click_mouse(x: i32, y: i32, state: tauri::State<AppState>) -> Result<(), String> {
    require_pro(&state)?;

    #[cfg(target_os = "linux")]
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        let _ = std::process::Command::new("ydotool").args(&["mousemove", "-a", &x.to_string(), &y.to_string()]).output();
        let _ = std::process::Command::new("ydotool").args(&["click", "0xC0"]).output();
        return Ok(());
    }

    let mut enigo = Enigo::new();
    enigo.mouse_move_to(x, y);
    enigo.mouse_click(MouseButton::Left);
    Ok(())
}

#[tauri::command]
fn scroll_mouse(amount: i32, state: tauri::State<AppState>) -> Result<(), String> {
    require_pro(&state)?;

    #[cfg(target_os = "linux")]
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return Ok(()); // basic wayland fallback ignored
    }

    let mut enigo = Enigo::new();
    enigo.mouse_scroll_y(amount);
    Ok(())
}

#[tauri::command]
fn type_string(text: String, state: tauri::State<AppState>) -> Result<(), String> {
    require_pro(&state)?;

    #[cfg(target_os = "linux")]
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        let _ = std::process::Command::new("ydotool").args(&["type", &text]).output();
        return Ok(());
    }

    let mut enigo = Enigo::new();
    enigo.key_sequence(&text);
    Ok(())
}

fn run_command_with_timeout(mut cmd: std::process::Command, timeout_secs: u64) -> Result<std::process::Output, String> {
    let mut child = cmd
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                return child.wait_with_output().map_err(|e| format!("Failed to collect output: {}", e));
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Process execution timed out after {} seconds", timeout_secs));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Error waiting on process: {}", e));
            }
        }
    }
}

fn sanitize_identifier(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Identifier cannot be empty".to_string());
    }
    if !trimmed.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err("Invalid characters in identifier".to_string());
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
fn run_python_script(script: String, state: tauri::State<AppState>) -> Result<String, String> {
    require_pro(&state)?;
    if script.len() > 256 * 1024 { return Err("Script exceeds 256 KiB limit".to_string()); }
    let temp_dir = std::env::temp_dir();
    let unique_id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_path = temp_dir.join(format!("lucy_script_{}_{}.py", unique_id, std::process::id()));
    std::fs::write(&file_path, script).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new("python");
    cmd.arg(&file_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let res = run_command_with_timeout(cmd, 30);
    let _ = std::fs::remove_file(&file_path);

    match res {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            if !output.status.success() {
                Ok(format!("Stdout:\n{}\nStderr:\n{}", stdout, stderr))
            } else {
                Ok(stdout)
            }
        }
        Err(err_msg) => Err(format!("Python execution error: {}", err_msg)),
    }
}

#[tauri::command]
fn run_terminal_command(command: String, state: tauri::State<AppState>) -> Result<String, String> {
    require_pro(&state)?;
    if command.len() > 8 * 1024 { return Err("Command exceeds 8 KiB limit".to_string()); }
    #[cfg(target_os = "windows")]
    let cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("cmd");
        c.args(&["/C", &command]);
        c.creation_flags(0x08000000);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let cmd = {
        let mut c = std::process::Command::new("sh");
        c.args(&["-c", &command]);
        c
    };

    let output = run_command_with_timeout(cmd, 30)?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        Ok(format!("Stdout:\n{}\nStderr:\n{}", stdout, stderr))
    } else {
        Ok(stdout)
    }
}

#[cfg(target_os = "windows")]
fn trim_memory_internal() {
    // NOTE: Previously this used `System::new_all()`, which on every call rebuilt a
    // complete system-wide snapshot — every CPU, disk, network, temperature component,
    // and user — just to enumerate our own child processes. That alone was the largest
    // steady-state CPU cost (especially in sleep mode where this was polled every 5s).
    // We now refresh ONLY the process list, which is all we need to find descendants.
    let mut sys = sysinfo::System::new();
    sys.refresh_processes();

    let current_pid = sysinfo::get_current_pid().unwrap();
    let mut all_descendants = std::collections::HashSet::new();
    all_descendants.insert(current_pid);

    let processes = sys.processes();
    let mut added = true;
    while added {
        added = false;
        for (pid, process) in processes {
            if let Some(parent_pid) = process.parent() {
                if all_descendants.contains(&parent_pid) && !all_descendants.contains(pid) {
                    all_descendants.insert(*pid);
                    added = true;
                }
            }
        }
    }

    for pid in all_descendants {
        unsafe {
            let handle = windows_sys::Win32::System::Threading::OpenProcess(
                windows_sys::Win32::System::Threading::PROCESS_SET_QUOTA | windows_sys::Win32::System::Threading::PROCESS_QUERY_INFORMATION,
                0,
                pid.as_u32(),
            );
            if handle != std::ptr::null_mut() {
                windows_sys::Win32::System::Memory::SetProcessWorkingSetSizeEx(handle, usize::MAX, usize::MAX, 0);
                windows_sys::Win32::Foundation::CloseHandle(handle);
            }
        }
    }
}

#[tauri::command]
fn trim_memory(state: tauri::State<AppState>) -> Result<(), String> {
    require_authorized(&state)?;
    
    #[cfg(target_os = "windows")]
    {
        trim_memory_internal();
    }
    Ok(())
}


#[tauri::command]
fn press_key(key: String, state: tauri::State<AppState>) -> Result<(), String> {
    require_authorized(&state)?;
    if !*state.pro_authorized.lock().map_err(|_| "Entitlement state unavailable")? &&
        !matches!(key.to_ascii_lowercase().as_str(), "up" | "down") {
        return Err("Pro entitlement required".to_string());
    }

    #[cfg(target_os = "linux")]
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        let _ = std::process::Command::new("ydotool").args(&["key", &key]).output();
        return Ok(());
    }

    let mut enigo = Enigo::new();
    let enigo_key = match key.to_lowercase().as_str() {
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "escape" => Key::Escape,
        "meta" | "windows" | "win" | "command" => Key::Meta,
        "shift" => Key::Shift,
        "control" | "ctrl" => Key::Control,
        "alt" => Key::Alt,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        other => {
            if other.chars().count() == 1 {
                Key::Layout(other.chars().next().unwrap())
            } else {
                return Err(format!("Unknown key: {}", other));
            }
        }
    };
    enigo.key_click(enigo_key);
    Ok(())
}

fn key_to_enigo(key: &str) -> Result<Key, String> {
    match key.to_lowercase().as_str() {
        "enter" | "return" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "space" => Ok(Key::Space),
        "backspace" => Ok(Key::Backspace),
        "escape" => Ok(Key::Escape),
        "meta" | "windows" | "win" | "command" => Ok(Key::Meta),
        "shift" => Ok(Key::Shift),
        "control" | "ctrl" => Ok(Key::Control),
        "alt" => Ok(Key::Alt),
        "up" => Ok(Key::UpArrow),
        "down" => Ok(Key::DownArrow),
        "left" => Ok(Key::LeftArrow),
        "right" => Ok(Key::RightArrow),
        "f1" => Ok(Key::F1),
        "f2" => Ok(Key::F2),
        "f3" => Ok(Key::F3),
        "f4" => Ok(Key::F4),
        "f5" => Ok(Key::F5),
        "f6" => Ok(Key::F6),
        "f7" => Ok(Key::F7),
        "f8" => Ok(Key::F8),
        "f9" => Ok(Key::F9),
        "f10" => Ok(Key::F10),
        "f11" => Ok(Key::F11),
        "f12" => Ok(Key::F12),
        "delete" | "del" => Ok(Key::Delete),
        "pageup" | "pgup" => Ok(Key::PageUp),
        "pagedown" | "pgdn" => Ok(Key::PageDown),
        "home" => Ok(Key::Home),
        "end" => Ok(Key::End),
        other => {
            if other.chars().count() == 1 {
                Ok(Key::Layout(other.chars().next().unwrap()))
            } else {
                Err(format!("Unknown key: {}", other))
            }
        }
    }
}

#[tauri::command]
fn press_key_combo(keys: Vec<String>, state: tauri::State<AppState>) -> Result<(), String> {
    require_authorized(&state)?;
    if keys.is_empty() || keys.len() > 4 { return Err("Key combination must contain 1 to 4 keys".to_string()); }
    let normalized: Vec<String> = keys.iter().map(|key| key.to_ascii_lowercase()).collect();
    let free_shortcut = normalized == ["win", "l"] || normalized == ["win", "d"] ||
        normalized == ["alt", "f4"] || normalized == ["alt", "tab"] ||
        normalized == ["ctrl", "w"] || normalized == ["ctrl", "tab"];
    if !*state.pro_authorized.lock().map_err(|_| "Entitlement state unavailable")? && !free_shortcut {
        return Err("Pro entitlement required".to_string());
    }
    let mut enigo = Enigo::new();

    for key in &keys {
        let enigo_key = key_to_enigo(key)?;
        enigo.key_down(enigo_key);
    }

    for key in keys.iter().rev() {
        let enigo_key = key_to_enigo(key)?;
        enigo.key_up(enigo_key);
    }

    Ok(())
}

#[tauri::command]
fn capture_screen(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    require_pro(&state)?;
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;
    let screen = screens.first().ok_or("No screen found")?;

    let img = screen
        .capture()
        .map_err(|e| format!("Capture failed: {}", e))?;

    let orig_width = img.width();
    let orig_height = img.height();
    
    let max_width = 1920.0;
    let scale_factor = if orig_width as f32 > max_width {
        orig_width as f32 / max_width
    } else {
        1.0
    };

    let mut dynamic_img = screenshots::image::DynamicImage::ImageRgba8(img);
    if scale_factor > 1.0 {
        let new_width = (orig_width as f32 / scale_factor).round() as u32;
        let new_height = (orig_height as f32 / scale_factor).round() as u32;
        dynamic_img = dynamic_img.resize_exact(new_width, new_height, screenshots::image::imageops::FilterType::Triangle);
    }
    
    let mut final_img = dynamic_img.to_rgba8();
    let width = final_img.width();
    let height = final_img.height();
    let grid_spacing = 100;

    for x in (0..width).step_by(grid_spacing as usize) {
        for y in 0..height {
            let pixel = final_img.get_pixel_mut(x, y);
            pixel[0] = pixel[0].saturating_add((255_u16.saturating_sub(pixel[0] as u16) / 2) as u8);
            pixel[1] = pixel[1].saturating_sub(40);
            pixel[2] = pixel[2].saturating_sub(40);
        }
    }
    for y in (0..height).step_by(grid_spacing as usize) {
        for x in 0..width {
            let pixel = final_img.get_pixel_mut(x, y);
            pixel[0] = pixel[0].saturating_sub(40);
            pixel[1] = pixel[1].saturating_sub(40);
            pixel[2] = pixel[2].saturating_add((255_u16.saturating_sub(pixel[2] as u16) / 2) as u8);
        }
    }

    let mut bytes = Vec::new();
    let dynamic_final = screenshots::image::DynamicImage::ImageRgba8(final_img);
    dynamic_final
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            screenshots::image::ImageFormat::Jpeg,
        )
        .map_err(|e| format!("JPEG conversion failed: {}", e))?;

    let base64_image = STANDARD.encode(&bytes);

    Ok(serde_json::json!({
        "base64": base64_image,
        "width": width,
        "height": height,
        "scale_factor": scale_factor
    }))
}

#[tauri::command]
fn save_3d_asset(
    app_handle: tauri::AppHandle,
    id: String,
    asset_type: String,
    name: String,
    data_base64: String,
    state: tauri::State<AppState>,
) -> Result<(), String> {
    require_pro(&state)?;
    let safe_id = sanitize_identifier(&id)?;
    let safe_asset_type = sanitize_identifier(&asset_type)?;

    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

    if data_base64.len() > 64 * 1024 * 1024 { return Err("Asset exceeds 48 MiB limit".to_string()); }
    let bytes = STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;
    let file_path = assets_dir.join(format!("{}.{}", safe_id, safe_asset_type));
    std::fs::write(&file_path, bytes).map_err(|e| e.to_string())?;

    let registry_path = assets_dir.join("registry.json");
    let mut registry: serde_json::Value = if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    registry[safe_id.clone()] = serde_json::json!({
        "id": safe_id,
        "type": safe_asset_type,
        "name": name,
        "timestamp": now
    });

    std::fs::write(
        registry_path,
        serde_json::to_string_pretty(&registry).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_3d_asset(app_handle: tauri::AppHandle, id: String, state: tauri::State<AppState>) -> Result<(), String> {
    require_pro(&state)?;
    let safe_id = sanitize_identifier(&id)?;

    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");

    let registry_path = assets_dir.join("registry.json");
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).unwrap_or_else(|_| "{}".to_string());
        if let Ok(mut registry) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(asset) = registry.get(&safe_id) {
                if let Some(asset_type) = asset.get("type").and_then(|v| v.as_str()) {
                    if let Ok(safe_asset_type) = sanitize_identifier(asset_type) {
                        let file_path = assets_dir.join(format!("{}.{}", safe_id, safe_asset_type));
                        let _ = std::fs::remove_file(file_path);
                    }
                }
            }
            if let Some(obj) = registry.as_object_mut() {
                obj.remove(&safe_id);
            }
            let _ = std::fs::write(
                registry_path,
                serde_json::to_string_pretty(&registry).unwrap(),
            );
        }
    }
    Ok(())
}

#[tauri::command]
fn list_3d_assets(app_handle: tauri::AppHandle, state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    require_authorized(&state)?;
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let registry_path = local_data.join("assets").join("registry.json");
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
        let registry: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;

        if let Some(obj) = registry.as_object() {
            let values: Vec<serde_json::Value> = obj.values().cloned().collect();
            return Ok(serde_json::Value::Array(values));
        }
    }
    Ok(serde_json::json!([]))
}

#[tauri::command]
fn read_3d_asset(app_handle: tauri::AppHandle, id: String, state: tauri::State<AppState>) -> Result<String, String> {
    require_authorized(&state)?;
    let safe_id = sanitize_identifier(&id)?;

    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");

    let registry_path = assets_dir.join("registry.json");
    let content = std::fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
    let registry: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(asset) = registry.get(&safe_id) {
        if let Some(asset_type) = asset.get("type").and_then(|v| v.as_str()) {
            let safe_asset_type = sanitize_identifier(asset_type)?;
            let file_path = assets_dir.join(format!("{}.{}", safe_id, safe_asset_type));
            let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
            let b64 = STANDARD.encode(&bytes);
            return Ok(serde_json::json!({
                "data": b64,
                "type": safe_asset_type
            })
            .to_string());
        }
    }
    Err("Asset not found".to_string())
}

#[tauri::command]
fn get_3d_asset_path(app_handle: tauri::AppHandle, id: String, state: tauri::State<AppState>) -> Result<String, String> {
    require_authorized(&state)?;
    let safe_id = sanitize_identifier(&id)?;

    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");

    let registry_path = assets_dir.join("registry.json");
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
        if let Ok(registry) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(asset) = registry.get(&safe_id) {
                if let Some(asset_type) = asset.get("type").and_then(|v| v.as_str()) {
                    let safe_asset_type = sanitize_identifier(asset_type)?;
                    let file_path = assets_dir.join(format!("{}.{}", safe_id, safe_asset_type));
                    return Ok(file_path.to_string_lossy().to_string());
                }
            }
        }
    }
    Err("Asset not found".to_string())
}

#[tauri::command]
fn read_3d_asset_bytes(app_handle: tauri::AppHandle, id: String, state: tauri::State<AppState>) -> Result<Vec<u8>, String> {
    require_authorized(&state)?;
    let safe_id = sanitize_identifier(&id)?;

    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");

    let registry_path = assets_dir.join("registry.json");
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
        if let Ok(registry) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(asset) = registry.get(&safe_id) {
                if let Some(asset_type) = asset.get("type").and_then(|v| v.as_str()) {
                    let safe_asset_type = sanitize_identifier(asset_type)?;
                    let file_path = assets_dir.join(format!("{}.{}", safe_id, safe_asset_type));
                    return std::fs::read(&file_path).map_err(|e| e.to_string());
                }
            }
        }
    }
    Err("Asset not found".to_string())
}

// ─── License / Device Authorization Commands ────────────────────────────────

/// Returns the unique hardware ID for this device (Windows Machine GUID).
/// This is shown to the tester so they can share it with the developer.
#[tauri::command]
fn get_device_hwid() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // Primary: Windows Machine GUID from registry (stable across reboots)
        let output = Command::new("reg")
            .args(&["query", "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"])
            .output()
            .map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if line.contains("MachineGuid") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(guid) = parts.last() {
                    return Ok(guid.to_string());
                }
            }
        }
        // Fallback: BIOS/motherboard UUID
        let output2 = Command::new("wmic")
            .args(&["csproduct", "get", "uuid"])
            .output()
            .map_err(|e| e.to_string())?;
        let text2 = String::from_utf8_lossy(&output2.stdout);
        let uuid = text2.lines().nth(1).unwrap_or("").trim().to_string();
        if !uuid.is_empty() {
            return Ok(uuid);
        }
        Err("Could not retrieve hardware ID".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Hardware ID not supported on this platform".to_string())
    }
}

fn decode_form_value(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => { decoded.push(b' '); index += 1; }
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
                decoded.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            b'%' => return None,
            byte => { decoded.push(byte); index += 1; }
        }
    }
    String::from_utf8(decoded).ok()
}

/// Starts a one-shot loopback callback used to receive the signed login token.
#[tauri::command]
fn start_auth_callback() -> Result<serde_json::Value, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| format!("Could not start local sign-in callback: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| format!("Could not configure local sign-in callback: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let mut state_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut state_bytes);
    let callback_state = state_bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let thread_state = callback_state.clone();
    let token_slot = AUTH_CALLBACK_TOKEN.get_or_init(|| Mutex::new(None));
    *token_slot.lock().map_err(|_| "Sign-in callback unavailable")? = None;

    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(300);
        while std::time::Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, address)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                    let mut request = Vec::with_capacity(2048);
                    let mut chunk = [0u8; 2048];
                    let mut header_end = None;
                    let mut content_length = 0usize;
                    loop {
                        match stream.read(&mut chunk) {
                            Ok(0) => break,
                            Ok(n) => request.extend_from_slice(&chunk[..n]),
                            Err(_) => break,
                        }
                        if request.len() > 32_768 { break; }
                        if header_end.is_none() {
                            header_end = request.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4);
                            if let Some(end) = header_end {
                                let headers = String::from_utf8_lossy(&request[..end]);
                                content_length = headers.lines().find_map(|line| {
                                    let (name, value) = line.split_once(':')?;
                                    name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok()).flatten()
                                }).unwrap_or(0);
                                if !headers.starts_with("POST ") || !headers.contains("/callback/") || !headers.contains("application/x-www-form-urlencoded") {
                                    break;
                                }
                            }
                        }
                        if let Some(end) = header_end {
                            if request.len() >= end + content_length { break; }
                        }
                    }

                    let valid_peer = address.ip().is_loopback();
                    let mut accepted_token = None;
                    if valid_peer && request.len() <= 32_768 {
                        if let Some(end) = header_end {
                            let headers = String::from_utf8_lossy(&request[..end]);
                            if headers.starts_with("POST /callback/")
                                && headers.lines().any(|line| line.to_ascii_lowercase().starts_with("content-type: application/x-www-form-urlencoded"))
                                && request.len() == end + content_length
                            {
                                let path_state = headers.lines().next().and_then(|line| line.split_whitespace().nth(1)).and_then(|path| path.strip_prefix("/callback/"));
                                let body = String::from_utf8_lossy(&request[end..]);
                                let fields = body.split('&').filter_map(|pair| {
                                    let (key, value) = pair.split_once('=')?;
                                    Some((decode_form_value(key)?, decode_form_value(value)?))
                                }).collect::<std::collections::HashMap<_, _>>();
                                let submitted_state = fields.get("state").map(String::as_str).unwrap_or("");
                                let token = fields.get("token").cloned().unwrap_or_default();
                                if path_state == Some(thread_state.as_str())
                                    && submitted_state == thread_state.as_str()
                                    && token.len() <= 16_384
                                    && token.split('.').count() == 3
                                {
                                    accepted_token = Some(token);
                                }
                            }
                        }
                    }

                    let accepted = accepted_token.is_some();
                    let (status, page) = if let Some(token) = accepted_token {
                        if let Some(slot) = AUTH_CALLBACK_TOKEN.get() {
                            if let Ok(mut stored) = slot.lock() { *stored = Some((thread_state.clone(), token)); }
                        }
                        ("200 OK", r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="light dark">
  <title>Sign-in complete · LUCY</title>
  <style>
    :root {
      color-scheme: light dark;
      --page: #fff5f8; --card: #fff; --ink: #1e1926; --muted: #716879;
      --line: rgba(244,63,142,.16); --pink: #f43f8e; --violet: #8b5cf6;
      --soft: #fff0f6; --green: #0c9b6a; --green-soft: #e9fbf3;
      --shadow: 0 30px 100px rgba(74,35,83,.16);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --page: #15121e; --card: #211a2d; --ink: #fbf8ff; --muted: #c6bdcf;
        --line: rgba(244,63,142,.22); --soft: #302238; --green: #53d6a2;
        --green-soft: #18352f; --shadow: 0 30px 100px rgba(0,0,0,.44);
      }
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 30px;
      color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      background: radial-gradient(ellipse at 9% 5%, rgba(244,63,142,.19), transparent 34%),
                  radial-gradient(ellipse at 95% 95%, rgba(139,92,246,.2), transparent 38%), var(--page);
    }
    .shell {
      width: min(100%, 960px); overflow: hidden; border: 1px solid var(--line);
      border-radius: 30px; background: var(--card); box-shadow: var(--shadow);
      animation: arrive .5s cubic-bezier(.2,.8,.2,1) both;
    }
    .topbar {
      min-height: 76px; padding: 0 34px; display: flex; align-items: center;
      justify-content: space-between; border-bottom: 1px solid var(--line);
    }
    .brand { display: flex; align-items: center; gap: 11px; font-size: 14px; font-weight: 850; letter-spacing: .19em; }
    .brand-mark {
      width: 34px; height: 34px; display: grid; place-items: center; border-radius: 11px;
      color: #fff; letter-spacing: 0; background: linear-gradient(135deg,var(--pink),var(--violet));
      box-shadow: 0 6px 18px rgba(185,58,158,.24);
    }
    .secure-label { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .secure-dot { width: 8px; height: 8px; border-radius: 50%; background: #13b981; box-shadow: 0 0 0 4px rgba(19,185,129,.12); }
    .content { display: grid; grid-template-columns: 1.12fr .88fr; }
    .hero { padding: 58px 58px 48px; }
    .eyebrow { margin: 0 0 20px; color: var(--pink); font-size: 10px; font-weight: 850; letter-spacing: .16em; text-transform: uppercase; }
    .success-mark {
      position: relative; width: 78px; height: 78px; display: grid; place-items: center;
      margin: 0 0 28px; border: 1px solid rgba(19,185,129,.22); border-radius: 25px;
      color: var(--green); background: var(--green-soft); font-size: 39px; font-weight: 500;
      box-shadow: 0 12px 34px rgba(19,185,129,.11);
    }
    .success-mark::after { position: absolute; inset: -8px; border: 1px solid rgba(19,185,129,.12); border-radius: 31px; content: ""; }
    h1 { max-width: 510px; margin: 0; font-size: clamp(36px,6vw,56px); line-height: 1.04; letter-spacing: -.055em; }
    h1 span { color: transparent; background: linear-gradient(100deg,var(--pink),var(--violet)); background-clip: text; -webkit-background-clip: text; }
    .description { max-width: 440px; margin: 18px 0 30px; color: var(--muted); font-size: 15px; line-height: 1.8; }
    .close-button {
      width: min(100%, 310px); min-height: 52px; display: inline-flex; align-items: center;
      justify-content: center; gap: 10px; border: 0; border-radius: 15px; color: #fff;
      background: linear-gradient(110deg,var(--pink),var(--violet)); box-shadow: 0 10px 26px rgba(176,61,164,.25);
      font: inherit; font-size: 14px; font-weight: 800; cursor: pointer;
      transition: transform .18s ease, box-shadow .18s ease;
    }
    .close-button:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(176,61,164,.33); }
    .close-button:focus-visible { outline: 3px solid rgba(139,92,246,.5); outline-offset: 3px; }
    .close-button svg { width: 17px; height: 17px; }
    .close-hint { max-width: 330px; min-height: 34px; margin: 12px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
    .details { padding: 42px 38px; border-left: 1px solid var(--line); background: linear-gradient(150deg, color-mix(in srgb,var(--soft) 64%,transparent), transparent 80%); }
    .details-heading { margin: 0 0 8px; font-size: 14px; font-weight: 850; }
    .details-copy { margin: 0 0 26px; color: var(--muted); font-size: 12px; line-height: 1.65; }
    .timeline { display: grid; gap: 0; }
    .timeline-item { position: relative; display: grid; grid-template-columns: 34px 1fr; gap: 13px; min-height: 76px; }
    .timeline-item:not(:last-child)::before { position: absolute; top: 31px; bottom: -1px; left: 16px; width: 1px; background: var(--line); content: ""; }
    .timeline-icon { z-index: 1; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid rgba(19,185,129,.2); border-radius: 11px; color: var(--green); background: var(--green-soft); font-size: 14px; font-weight: 800; }
    .timeline-title { margin: 2px 0 4px; font-size: 12px; font-weight: 800; }
    .timeline-copy { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
    .privacy { display: flex; align-items: flex-start; gap: 10px; margin-top: 13px; padding: 13px; border: 1px solid var(--line); border-radius: 14px; color: var(--muted); background: color-mix(in srgb,var(--card) 72%,transparent); font-size: 10px; line-height: 1.55; }
    .privacy svg { width: 15px; height: 15px; flex: none; color: var(--green); }
    .footer { min-height: 48px; display: flex; align-items: center; justify-content: center; padding: 10px 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; letter-spacing: .025em; }
    @keyframes arrive { from { opacity: 0; transform: translateY(12px) scale(.99); } to { opacity: 1; transform: none; } }
    @media (max-width: 700px) {
      body { padding: 16px; }
      .shell { border-radius: 23px; }
      .topbar { min-height: 64px; padding: 0 21px; }
      .content { grid-template-columns: 1fr; }
      .hero { padding: 38px 25px 25px; }
      .details { padding: 27px 25px 30px; border-top: 1px solid var(--line); border-left: 0; }
      .success-mark { width: 68px; height: 68px; border-radius: 22px; font-size: 34px; }
      .close-button { width: 100%; }
      .secure-label { font-size: 0; gap: 0; }
      .secure-dot { width: 9px; height: 9px; }
    }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
  </style>
</head>
<body>
  <main class="shell" role="status" aria-live="polite">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">L</span><span>LUCY</span></div>
      <div class="secure-label"><span class="secure-dot" aria-hidden="true"></span>Secure sign-in</div>
    </header>
    <div class="content">
      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">Desktop sign-in complete</p>
        <div class="success-mark" aria-hidden="true">✓</div>
        <h1 id="page-title">You’re in.<br><span>Welcome to LUCY.</span></h1>
        <p class="description">Your account has been verified and connected to the LUCY desktop app. You can safely close this browser tab and continue in LUCY.</p>
        <button class="close-button" id="close-tab" type="button">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Close this tab
        </button>
        <p class="close-hint" id="close-hint">If your browser prevents the tab from closing, you can close it manually. Your sign-in is already complete.</p>
      </section>
      <aside class="details" aria-label="Sign-in details">
        <h2 class="details-heading">You’re ready to go</h2>
        <p class="details-copy">The secure handoff is complete. Here’s what just happened:</p>
        <div class="timeline">
          <div class="timeline-item">
            <span class="timeline-icon" aria-hidden="true">✓</span>
            <div><h3 class="timeline-title">Identity verified</h3><p class="timeline-copy">Your sign-in provider confirmed your account.</p></div>
          </div>
          <div class="timeline-item">
            <span class="timeline-icon" aria-hidden="true">✓</span>
            <div><h3 class="timeline-title">LUCY connected</h3><p class="timeline-copy">Your secure session was handed back to the desktop app.</p></div>
          </div>
          <div class="timeline-item">
            <span class="timeline-icon" aria-hidden="true">3</span>
            <div><h3 class="timeline-title">Return to the app</h3><p class="timeline-copy">Switch back to LUCY to finish setting up your companion.</p></div>
          </div>
        </div>
        <div class="privacy">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 10V7a6 6 0 0 1 12 0v3m-13 0h14v11H5V10Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Your session token was sent directly to LUCY over a private local connection. It is not shown on this page.</span>
        </div>
      </aside>
    </div>
    <footer class="footer">LUCY · Your AI companion, ready when you are</footer>
  </main>
  <script>
    document.getElementById('close-tab').addEventListener('click', function () {
      window.close();
      setTimeout(function () {
        document.getElementById('close-hint').textContent = 'Your browser blocked automatic closing. Please close this tab manually; your sign-in is complete.';
        document.getElementById('close-tab').textContent = 'Close this tab manually';
      }, 250);
    });
  </script>
</body>
</html>"#)
                    } else {
                        ("400 Bad Request", r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="light dark">
  <title>Sign-in needs another try · LUCY</title>
  <style>
    :root {
      color-scheme: light dark;
      --page: #fff5f8; --card: #fff; --ink: #1e1926; --muted: #716879;
      --line: rgba(244,63,142,.16); --pink: #f43f8e; --violet: #8b5cf6;
      --soft: #fff0f6; --warn: #b66b09; --warn-soft: #fff4df;
      --shadow: 0 30px 100px rgba(74,35,83,.16);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --page: #15121e; --card: #211a2d; --ink: #fbf8ff; --muted: #c6bdcf;
        --line: rgba(244,63,142,.22); --soft: #302238; --warn: #ffd27a;
        --warn-soft: #3a2d1b; --shadow: 0 30px 100px rgba(0,0,0,.44);
      }
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 30px;
      color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      background: radial-gradient(ellipse at 9% 5%, rgba(244,63,142,.19), transparent 34%),
                  radial-gradient(ellipse at 95% 95%, rgba(139,92,246,.2), transparent 38%), var(--page);
    }
    .shell { width: min(100%,960px); overflow: hidden; border: 1px solid var(--line); border-radius: 30px; background: var(--card); box-shadow: var(--shadow); animation: arrive .5s cubic-bezier(.2,.8,.2,1) both; }
    .topbar { min-height: 76px; padding: 0 34px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--line); }
    .brand { display: flex; align-items: center; gap: 11px; font-size: 14px; font-weight: 850; letter-spacing: .19em; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 11px; color: #fff; letter-spacing: 0; background: linear-gradient(135deg,var(--pink),var(--violet)); box-shadow: 0 6px 18px rgba(185,58,158,.24); }
    .secure-label { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .secure-dot { width: 8px; height: 8px; border-radius: 50%; background: #13b981; box-shadow: 0 0 0 4px rgba(19,185,129,.12); }
    .content { display: grid; grid-template-columns: 1.12fr .88fr; }
    .hero { padding: 58px 58px 48px; }
    .eyebrow { margin: 0 0 20px; color: var(--pink); font-size: 10px; font-weight: 850; letter-spacing: .16em; text-transform: uppercase; }
    .issue-mark { width: 78px; height: 78px; display: grid; place-items: center; margin: 0 0 28px; border: 1px solid rgba(230,159,55,.25); border-radius: 25px; color: var(--warn); background: var(--warn-soft); font-size: 36px; font-weight: 750; box-shadow: 0 12px 34px rgba(230,159,55,.1); }
    h1 { max-width: 510px; margin: 0; font-size: clamp(36px,6vw,54px); line-height: 1.05; letter-spacing: -.055em; }
    h1 span { color: transparent; background: linear-gradient(100deg,var(--pink),var(--violet)); background-clip: text; -webkit-background-clip: text; }
    .description { max-width: 440px; margin: 18px 0 28px; color: var(--muted); font-size: 15px; line-height: 1.8; }
    .close-button { width: min(100%,310px); min-height: 52px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; border: 0; border-radius: 15px; color: #fff; background: linear-gradient(110deg,var(--pink),var(--violet)); box-shadow: 0 10px 26px rgba(176,61,164,.25); font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; transition: transform .18s ease,box-shadow .18s ease; }
    .close-button:hover { transform: translateY(-2px); box-shadow: 0 14px 32px rgba(176,61,164,.33); }
    .close-button:focus-visible { outline: 3px solid rgba(139,92,246,.5); outline-offset: 3px; }
    .close-button svg { width: 17px; height: 17px; }
    .close-hint { max-width: 330px; min-height: 34px; margin: 12px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
    .details { padding: 42px 38px; border-left: 1px solid var(--line); background: linear-gradient(150deg,color-mix(in srgb,var(--soft) 64%,transparent),transparent 80%); }
    .details-heading { margin: 0 0 8px; font-size: 14px; font-weight: 850; }
    .details-copy { margin: 0 0 26px; color: var(--muted); font-size: 12px; line-height: 1.65; }
    .timeline { display: grid; }
    .timeline-item { position: relative; display: grid; grid-template-columns: 34px 1fr; gap: 13px; min-height: 76px; }
    .timeline-item:not(:last-child)::before { position: absolute; top: 31px; bottom: -1px; left: 16px; width: 1px; background: var(--line); content: ""; }
    .timeline-icon { z-index: 1; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 11px; color: var(--pink); background: var(--soft); font-size: 13px; font-weight: 800; }
    .timeline-title { margin: 2px 0 4px; font-size: 12px; font-weight: 800; }
    .timeline-copy { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
    .tip { display: flex; align-items: flex-start; gap: 10px; margin-top: 13px; padding: 13px; border: 1px solid var(--line); border-radius: 14px; color: var(--muted); background: color-mix(in srgb,var(--card) 72%,transparent); font-size: 10px; line-height: 1.6; }
    .tip strong { color: var(--ink); }
    .footer { min-height: 48px; display: flex; align-items: center; justify-content: center; padding: 10px 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; letter-spacing: .025em; }
    @keyframes arrive { from { opacity: 0; transform: translateY(12px) scale(.99); } to { opacity: 1; transform: none; } }
    @media (max-width: 700px) {
      body { padding: 16px; } .shell { border-radius: 23px; }
      .topbar { min-height: 64px; padding: 0 21px; }
      .content { grid-template-columns: 1fr; }
      .hero { padding: 38px 25px 25px; }
      .details { padding: 27px 25px 30px; border-top: 1px solid var(--line); border-left: 0; }
      .issue-mark { width: 68px; height: 68px; border-radius: 22px; font-size: 32px; }
      .close-button { width: 100%; }
      .secure-label { font-size: 0; gap: 0; }
      .secure-dot { width: 9px; height: 9px; }
    }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
  </style>
</head>
<body>
  <main class="shell" role="alert">
    <header class="topbar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">L</span><span>LUCY</span></div>
      <div class="secure-label"><span class="secure-dot" aria-hidden="true"></span>Secure sign-in</div>
    </header>
    <div class="content">
      <section class="hero" aria-labelledby="page-title">
        <p class="eyebrow">One more step</p>
        <div class="issue-mark" aria-hidden="true">!</div>
        <h1 id="page-title">Let’s get you <span>signed in.</span></h1>
        <p class="description">The secure sign-in handoff to the LUCY desktop app didn’t finish. Your account is safe; just start sign-in again from LUCY.</p>
        <button class="close-button" id="close-tab" type="button">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Close this tab
        </button>
        <p class="close-hint" id="close-hint">Return to LUCY and choose Sign in to safely try again.</p>
      </section>
      <aside class="details" aria-label="How to continue">
        <h2 class="details-heading">What to do next</h2>
        <p class="details-copy">This handoff could not be matched to the sign-in request.</p>
        <div class="timeline">
          <div class="timeline-item">
            <span class="timeline-icon" aria-hidden="true">1</span>
            <div><h3 class="timeline-title">Switch back to LUCY</h3><p class="timeline-copy">The desktop app is still open and ready.</p></div>
          </div>
          <div class="timeline-item">
            <span class="timeline-icon" aria-hidden="true">2</span>
            <div><h3 class="timeline-title">Start sign-in again</h3><p class="timeline-copy">Use the Sign in button in the app to open a fresh secure link.</p></div>
          </div>
          <div class="timeline-item">
            <span class="timeline-icon" aria-hidden="true">3</span>
            <div><h3 class="timeline-title">Keep the new tab open</h3><p class="timeline-copy">Let the browser return you to LUCY before closing the tab.</p></div>
          </div>
        </div>
        <div class="tip"><span aria-hidden="true">ⓘ</span><span><strong>No account changes were made.</strong> You can retry safely. If this keeps happening, restart LUCY and begin a new sign-in.</span></div>
      </aside>
    </div>
    <footer class="footer">LUCY · Your AI companion, ready when you are</footer>
  </main>
  <script>
    document.getElementById('close-tab').addEventListener('click', function () {
      window.close();
      setTimeout(function () {
        document.getElementById('close-hint').textContent = 'Your browser blocked automatic closing. Close this tab manually, then return to LUCY to retry.';
        document.getElementById('close-tab').textContent = 'Close this tab manually';
      }, 250);
    });
  </script>
</body>
</html>"#)
                    };
                    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len());
                    let _ = stream.write_all(response.as_bytes());
                    if accepted { break; }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
    });

    Ok(serde_json::json!({ "port": port, "state": callback_state }))
}

#[tauri::command]
fn take_auth_callback(callback_state: String) -> Option<String> {
    let slot = AUTH_CALLBACK_TOKEN.get()?;
    let mut stored = slot.lock().ok()?;
    if stored.as_ref().is_some_and(|(state, _)| state == &callback_state) {
        stored.take().map(|(_, token)| token)
    } else {
        None
    }
}

/// Verifies the Ed25519 signature returned by the server and stores an offline token.
/// Called by frontend after receiving signature from the Next.js server.
/// Returns { success: bool, tester_name: Option<String> }
#[tauri::command]
fn verify_license(
    app_handle: tauri::AppHandle,
    token_payload: String,
    signature: String,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let claims = match verify_token(&token_payload, &signature) {
        Ok(claims) => claims,
        Err(err) => {
            *state.authorized.lock().unwrap() = false;
            *state.pro_authorized.lock().unwrap() = false;
            return Err(err);
        }
    };

    // Signature is valid — set authorized flag
    *state.authorized.lock().unwrap() = true;
    *state.pro_authorized.lock().unwrap() = token_tier_is_pro(&token_payload);
    *state.authorization_expires_at.lock().unwrap() = claims["exp"].as_u64().unwrap_or(0);

    // Store offline token: JSON file in app data dir
    if let Ok(data_dir) = app_handle.path().app_local_data_dir() {
        let _ = std::fs::create_dir_all(&data_dir);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let token_data = serde_json::json!({
            "payload": token_payload,
            "signature": signature,
            "verified_at": now
        });
        let token_path = data_dir.join(".license_token");
        let _ = std::fs::write(token_path, serde_json::to_string(&token_data).unwrap_or_default());
    }

    Ok(serde_json::json!({ "success": true }))
}

/// Checks if the app is currently authorized.
/// On startup, also attempts to restore authorization from the local offline token.
#[tauri::command]
fn check_authorization(
    app_handle: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> serde_json::Value {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    if *state.authorization_expires_at.lock().unwrap() <= now {
        *state.authorized.lock().unwrap() = false;
        *state.pro_authorized.lock().unwrap() = false;
    }
    // If already authorized in memory, return immediately
    if *state.authorized.lock().unwrap() {
        return serde_json::json!({ "authorized": true, "source": "memory" });
    }

    // Try to restore from offline token file
    let data_dir = match app_handle.path().app_local_data_dir() {
        Ok(d) => d,
        Err(_) => return serde_json::json!({ "authorized": false }),
    };
    let token_path = data_dir.join(".license_token");

    if !token_path.exists() { return serde_json::json!({ "authorized": false }); }

    let content = match std::fs::read_to_string(&token_path) {
        Ok(c) => c,
        Err(_) => return serde_json::json!({ "authorized": false }),
    };

    let token: serde_json::Value = match serde_json::from_str(&content) { Ok(v) => v, Err(_) => return serde_json::json!({ "authorized": false }) };
    let payload = token.get("payload").and_then(|v| v.as_str()).unwrap_or("");
    let signature = token.get("signature").and_then(|v| v.as_str()).unwrap_or("");
    if verify_token(payload, signature).is_err() { return serde_json::json!({ "authorized": false }); }
    *state.authorized.lock().unwrap() = true;
    *state.pro_authorized.lock().unwrap() = token_tier_is_pro(payload);
    let token_claims = verify_token(payload, signature).unwrap_or(serde_json::Value::Null);
    *state.authorization_expires_at.lock().unwrap() = token_claims["exp"].as_u64().unwrap_or(0);
    serde_json::json!({ "authorized": true, "source": "offline_token" })
}

#[tauri::command]
fn logout_license(app_handle: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    *state.authorized.lock().map_err(|_| "Authorization state unavailable")? = false;
    *state.pro_authorized.lock().map_err(|_| "Entitlement state unavailable")? = false;
    *state.authorization_expires_at.lock().map_err(|_| "Authorization state unavailable")? = 0;
    if let Ok(dir) = app_handle.path().app_local_data_dir() {
        let _ = std::fs::remove_file(dir.join(".license_token"));
    }
    Ok(())
}

/// Retrieves the stored access code so the frontend can attempt an automatic background renewal
#[tauri::command]
fn get_stored_license(app_handle: tauri::AppHandle) -> serde_json::Value {
    let data_dir = match app_handle.path().app_local_data_dir() {
        Ok(d) => d,
        Err(_) => return serde_json::json!({ "success": false }),
    };
    let token_path = data_dir.join(".license_token");
    if !token_path.exists() {
        return serde_json::json!({ "success": false });
    }
    if let Ok(content) = std::fs::read_to_string(&token_path) {
        if let Ok(token_data) = serde_json::from_str::<serde_json::Value>(&content) {
            let payload = token_data["payload"].as_str().unwrap_or("");
            let signature = token_data["signature"].as_str().unwrap_or("");
            if !payload.is_empty() && !signature.is_empty() {
                return serde_json::json!({ "success": true, "payload": payload, "signature": signature });
            }
        }
    }
    serde_json::json!({ "success": false })
}

fn do_wake_up_main(app_handle: &tauri::AppHandle) {
    if let Some(state) = app_handle.try_state::<AppState>() {
        let mut is_sleeping = state.is_sleeping.lock().unwrap();
        *is_sleeping = false;
    }
    
    if let Some(win) = app_handle.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.set_always_on_top(true);
    }
    
    // Broadcast clean native Tauri event to all windows
    let _ = app_handle.emit("lucy-wake-up", ());
}

#[tauri::command]
fn enter_sleep_mode(_app_handle: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    *state.is_sleeping.lock().unwrap() = true;
    Ok(())
}

#[tauri::command]
fn wake_up_main(app_handle: tauri::AppHandle) -> Result<(), String> {
    do_wake_up_main(&app_handle);
    Ok(())
}

#[tauri::command]
fn is_autostart() -> bool {
    std::env::args().any(|arg| arg.contains("autostart") || arg == "-a")
}

#[tauri::command]
fn setup_wayland_automation(state: tauri::State<AppState>) -> Result<String, String> {
    require_pro(&state)?;
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("pkexec")
            .arg("ydotoold")
            .spawn()
            .map_err(|e| format!("Failed to start ydotoold: {}", e))?;
        Ok("Wayland automation daemon started successfully".to_string())
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("Wayland setup is only applicable on Linux".to_string())
    }
}

#[tauri::command]
fn exit_app() {
    std::process::exit(0);
}

#[derive(serde::Serialize)]
struct DesktopRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    is_taskbar: bool,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_window_proc(hwnd: windows_sys::Win32::Foundation::HWND, lparam: windows_sys::Win32::Foundation::LPARAM) -> windows_sys::Win32::Foundation::BOOL {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindowVisible, IsIconic, GetWindowRect, GetWindowTextLengthW};
    
    if IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0 {
        return 1;
    }

    let len = GetWindowTextLengthW(hwnd);
    if len == 0 {
        return 1;
    }
    
    let mut rect: windows_sys::Win32::Foundation::RECT = std::mem::zeroed();
    if GetWindowRect(hwnd, &mut rect) != 0 {
        let rects = &mut *(lparam as *mut Vec<DesktopRect>);
        rects.push(DesktopRect {
            x: rect.left,
            y: rect.top,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            is_taskbar: false,
        });
    }
    1
}

#[tauri::command]
fn get_desktop_rectangles() -> Vec<DesktopRect> {
    let mut rects = Vec::new();
    
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowRect, EnumWindows};
        unsafe {
            let tray_class: Vec<u16> = "Shell_TrayWnd".encode_utf16().chain(std::iter::once(0)).collect();
            let taskbar_hwnd = FindWindowW(tray_class.as_ptr(), std::ptr::null());
            if !taskbar_hwnd.is_null() {
                let mut rect: windows_sys::Win32::Foundation::RECT = std::mem::zeroed();
                if GetWindowRect(taskbar_hwnd, &mut rect) != 0 {
                    rects.push(DesktopRect {
                        x: rect.left,
                        y: rect.top,
                        width: rect.right - rect.left,
                        height: rect.bottom - rect.top,
                        is_taskbar: true,
                    });
                }
            }
            
            EnumWindows(Some(enum_window_proc), &mut rects as *mut _ as isize);
        }
    }
    rects
}

// ─────────────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single instance is handled by tauri-plugin-single-instance

    let is_autostart_boot = std::env::args().any(|arg| arg.contains("autostart") || arg == "-a");

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            do_wake_up_main(app);
            let _ = app.emit("lucy-exit-pet-mode", ());
        }))
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
            authorized: Mutex::new(false),
            pro_authorized: Mutex::new(false),
            authorization_expires_at: Mutex::new(0),
            is_sleeping: Mutex::new(is_autostart_boot),
        })
        // Keep phone networking out of application startup. The listener is bound only
        // after the user opens Phone Link and requests pairing data.
        .manage(std::sync::Arc::new(tokio::sync::Mutex::new(lucy_link::LucyLinkState::new())))
        .invoke_handler(tauri::generate_handler![
            get_system_stats,
            open_external_url,
            move_and_click_mouse,
            scroll_mouse,
            type_string,
            run_python_script,
            run_terminal_command,
            press_key,
            press_key_combo,
            capture_screen,
            save_3d_asset,
            delete_3d_asset,
            list_3d_assets,
            read_3d_asset,
            read_3d_asset_bytes,
            get_3d_asset_path,
            // License commands
            get_device_hwid,
            start_auth_callback,
            take_auth_callback,
            verify_license,
            check_authorization,
            get_stored_license,
            logout_license,
            trim_memory,
            enter_sleep_mode,
            wake_up_main,
            is_autostart,
            setup_wayland_automation,
            exit_app,
            get_desktop_rectangles,
            lucy_link::get_lucy_link_pairing_data,
            lucy_link::send_prompt_to_phone,
            lucy_link::resolve_mobile_prompt,
            lucy_link::get_lucy_link_status,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            #[cfg(target_os = "macos")]
            let cmd_modifier = Modifiers::SUPER;
            #[cfg(not(target_os = "macos"))]
            let cmd_modifier = Modifiers::CONTROL;

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if shortcut.matches(cmd_modifier | Modifiers::ALT, Code::KeyX) {
                                do_wake_up_main(app);
                                let _ = app.emit("lucy-exit-pet-mode", ());
                            }
                            if shortcut.matches(cmd_modifier | Modifiers::ALT, Code::KeyS) {
                                let _ = app.emit("lucy-toggle-mute", ());
                            }
                            if shortcut.matches(cmd_modifier | Modifiers::ALT, Code::KeyM) || shortcut.matches(Modifiers::empty(), Code::F9) {
                                let _ = app.emit("lucy-toggle-mic", ());
                            }
                        }
                    })
                    .build(),
            )?;

            // Background thread: try registering shortcuts until successful
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    use tauri_plugin_global_shortcut::GlobalShortcutExt;
                    let shortcuts = ["CommandOrControl+Alt+X", "CommandOrControl+Alt+S", "CommandOrControl+Alt+M", "F9"];
                    for _ in 0..20 {
                        let mut all_success = true;
                        for s in shortcuts.iter() {
                            if !app_handle.global_shortcut().is_registered(*s) {
                                if app_handle.global_shortcut().register(*s).is_err() {
                                    all_success = false;
                                }
                            }
                        }
                        if all_success {
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(500));
                    }
                });
            }

            // Tray Menu
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
            let refresh_i = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let options_i = MenuItem::with_id(app, "options", "Options (Settings)", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hide_i, &refresh_i, &options_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new().menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            
            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        do_wake_up_main(app.app_handle());
                    }
                    "hide" => {
                        let _ = app.emit("lucy-sleep", ());
                    }
                    "refresh" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.eval("window.location.reload();");
                        }
                    }
                    "options" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                        let _ = app.emit("lucy-open-settings", ());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: TrayMouseButton::Left,
                        ..
                    } => {
                        let app = tray.app_handle();
                        let is_sleeping = if let Some(state) = app.try_state::<AppState>() {
                            *state.is_sleeping.lock().unwrap()
                        } else { false };
                        
                        if is_sleeping {
                            do_wake_up_main(app);
                        } else {
                            let _ = app.emit("lucy-sleep", ());
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Only show the window on manual launch — autostart keeps it hidden
            // so it enters sleep/pet mode without a visible transparent overlay.
            let is_autostart = std::env::args().any(|arg| arg.contains("autostart") || arg == "-a");
            if !is_autostart {
                if let Some(win) = app.get_webview_window("main") {
                    win.show().ok();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
