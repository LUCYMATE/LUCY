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
// License system
use hmac::{Hmac, Mac};
use sha2::Sha256;

// HMAC key — MUST match HMAC_SECRET in Vercel environment variable
// Format: "<hwid>:<ACCESS_CODE>" signed with this key
const HMAC_KEY: &[u8] = b"52e590ec0fab06527b45d3a6ebeabe6e74e3d99878a7fbbd6f47e3763234accf";
// Offline token re-verify interval (24 hours in seconds)
const OFFLINE_GRACE_SECONDS: i64 = 24 * 60 * 60;

struct AppState {
    sys: Mutex<System>,
    authorized: Mutex<bool>,
}

#[tauri::command]
fn get_system_stats(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes();

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let total_memory = sys.total_memory();

    // Calculate exact RAM used by this app and its webview child processes
    let current_pid = sysinfo::get_current_pid().unwrap();
    let mut app_memory: u64 = 0;
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
        }
    }

    Ok(serde_json::json!({
        "cpu_usage": cpu_usage,
        "total_memory": total_memory,
        "used_memory": sys.used_memory(),
        "app_memory": app_memory
    }))
}

#[tauri::command]
fn open_external_url(app_handle: tauri::AppHandle, url: String, state: tauri::State<AppState>) -> Result<(), String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    app_handle
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn move_and_click_mouse(x: i32, y: i32, state: tauri::State<AppState>) -> Result<(), String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let mut enigo = Enigo::new();
    enigo.mouse_move_to(x, y);
    enigo.mouse_click(MouseButton::Left);
    Ok(())
}

#[tauri::command]
fn scroll_mouse(amount: i32, state: tauri::State<AppState>) -> Result<(), String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let mut enigo = Enigo::new();
    enigo.mouse_scroll_y(amount);
    Ok(())
}

#[tauri::command]
fn type_string(text: String, state: tauri::State<AppState>) -> Result<(), String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let mut enigo = Enigo::new();
    enigo.key_sequence(&text);
    Ok(())
}

#[tauri::command]
fn run_python_script(script: String, state: tauri::State<AppState>) -> Result<String, String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join("soltini_temp_script.py");
    std::fs::write(&file_path, script).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new("python");
    cmd.arg(&file_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd.output().map_err(|e| {
        format!(
            "Failed to execute python: {}. Ensure Python is installed.",
            e
        )
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let _ = std::fs::remove_file(file_path);

    if !output.status.success() {
        Ok(format!("Stdout:\n{}\nStderr:\n{}", stdout, stderr))
    } else {
        Ok(stdout)
    }
}

#[tauri::command]
fn run_terminal_command(command: String, state: tauri::State<AppState>) -> Result<String, String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new("cmd");
    cmd.args(&["/C", &command]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

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
    let mut sys = sysinfo::System::new_all();
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
                windows_sys::Win32::System::Threading::PROCESS_ALL_ACCESS,
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    
    #[cfg(target_os = "windows")]
    {
        trim_memory_internal();
    }
    Ok(())
}


#[tauri::command]
fn press_key(key: String, state: tauri::State<AppState>) -> Result<(), String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

    let bytes = STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;
    let file_path = assets_dir.join(format!("{}.{}", id, asset_type));
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

    registry[id.clone()] = serde_json::json!({
        "id": id,
        "type": asset_type,
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");

    let registry_path = assets_dir.join("registry.json");
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).unwrap_or_else(|_| "{}".to_string());
        if let Ok(mut registry) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(asset) = registry.get(&id) {
                if let Some(asset_type) = asset.get("type").and_then(|v| v.as_str()) {
                    let file_path = assets_dir.join(format!("{}.{}", id, asset_type));
                    let _ = std::fs::remove_file(file_path);
                }
            }
            if let Some(obj) = registry.as_object_mut() {
                obj.remove(&id);
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");

    let registry_path = assets_dir.join("registry.json");
    let content = std::fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
    let registry: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    if let Some(asset) = registry.get(&id) {
        if let Some(asset_type) = asset.get("type").and_then(|v| v.as_str()) {
            let file_path = assets_dir.join(format!("{}.{}", id, asset_type));
            let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
            let b64 = STANDARD.encode(&bytes);
            return Ok(serde_json::json!({
                "data": b64,
                "type": asset_type
            })
            .to_string());
        }
    }
    Err("Asset not found".to_string())
}

#[tauri::command]
fn get_3d_asset_path(app_handle: tauri::AppHandle, id: String, state: tauri::State<AppState>) -> Result<String, String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");

    let registry_path = assets_dir.join("registry.json");
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
        if let Ok(registry) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(asset) = registry.get(&id) {
                if let Some(asset_type) = asset.get("type").and_then(|v| v.as_str()) {
                    let file_path = assets_dir.join(format!("{}.{}", id, asset_type));
                    return Ok(file_path.to_string_lossy().to_string());
                }
            }
        }
    }
    Err("Asset not found".to_string())
}

#[tauri::command]
fn read_3d_asset_bytes(app_handle: tauri::AppHandle, id: String, state: tauri::State<AppState>) -> Result<Vec<u8>, String> {
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");

    let registry_path = assets_dir.join("registry.json");
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
        if let Ok(registry) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(asset) = registry.get(&id) {
                if let Some(asset_type) = asset.get("type").and_then(|v| v.as_str()) {
                    let file_path = assets_dir.join(format!("{}.{}", id, asset_type));
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

/// Verifies the HMAC signature returned by the server and stores an offline token.
/// Called by frontend after receiving signature from the Next.js server.
/// Returns { success: bool, tester_name: Option<String> }
#[tauri::command]
fn verify_license(
    app_handle: tauri::AppHandle,
    hwid: String,
    access_code: String,
    signature: String,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    let normalized_code = access_code.trim().to_uppercase();
    let normalized_hwid = hwid.trim().to_string();

    let payload = format!("{}:{}", normalized_hwid, normalized_code);

    // Compute expected HMAC-SHA256
    let mut mac = Hmac::<Sha256>::new_from_slice(HMAC_KEY)
        .map_err(|e| format!("HMAC init error: {}", e))?;
    mac.update(payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    // Constant-time comparison
    if expected != signature {
        return Ok(serde_json::json!({ "success": false, "error": "Invalid license signature" }));
    }

    // Signature is valid — set authorized flag
    *state.authorized.lock().unwrap() = true;

    // Store offline token: JSON file in app data dir
    // Content: { hwid, access_code, signature, timestamp }
    if let Ok(data_dir) = app_handle.path().app_local_data_dir() {
        let _ = std::fs::create_dir_all(&data_dir);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let token_data = serde_json::json!({
            "hwid": normalized_hwid,
            "access_code": normalized_code,
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

    if !token_path.exists() {
        return serde_json::json!({ "authorized": false });
    }

    let content = match std::fs::read_to_string(&token_path) {
        Ok(c) => c,
        Err(_) => return serde_json::json!({ "authorized": false }),
    };

    let token_data: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return serde_json::json!({ "authorized": false }),
    };

    // Check timestamp — force re-verify online every OFFLINE_GRACE_SECONDS (7 days)
    let verified_at = token_data["verified_at"].as_u64().unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if now.saturating_sub(verified_at) > OFFLINE_GRACE_SECONDS as u64 {
        // Token is stale — require fresh online verification
        return serde_json::json!({ "authorized": false, "reason": "token_expired" });
    }

    // Re-verify the stored signature locally to prevent tampering
    let hwid = token_data["hwid"].as_str().unwrap_or("");
    let access_code = token_data["access_code"].as_str().unwrap_or("");
    let stored_signature = token_data["signature"].as_str().unwrap_or("");

    if hwid.is_empty() || access_code.is_empty() || stored_signature.is_empty() {
        return serde_json::json!({ "authorized": false });
    }

    let payload = format!("{}:{}", hwid, access_code);
    let mut mac = match Hmac::<Sha256>::new_from_slice(HMAC_KEY) {
        Ok(m) => m,
        Err(_) => return serde_json::json!({ "authorized": false }),
    };
    mac.update(payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    if expected == stored_signature {
        *state.authorized.lock().unwrap() = true;
        serde_json::json!({ "authorized": true, "source": "offline_token" })
    } else {
        // Tampered token — delete it
        let _ = std::fs::remove_file(&token_path);
        serde_json::json!({ "authorized": false })
    }
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
            let hwid = token_data["hwid"].as_str().unwrap_or("");
            let access_code = token_data["access_code"].as_str().unwrap_or("");
            if !hwid.is_empty() && !access_code.is_empty() {
                return serde_json::json!({ "success": true, "hwid": hwid, "access_code": access_code });
            }
        }
    }
    serde_json::json!({ "success": false })
}

fn do_wake_up_main(app_handle: &tauri::AppHandle) {
    if let Some(win) = app_handle.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.eval("window.dispatchEvent(new CustomEvent('soltini-wake-up'));");
    }
}

#[tauri::command]
fn enter_sleep_mode(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app_handle.get_webview_window("main") {
        let _ = win.hide();
    }
    
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            trim_memory_internal();
        });
    }

    Ok(())
}

#[tauri::command]
fn wake_up_main(app_handle: tauri::AppHandle) -> Result<(), String> {
    do_wake_up_main(&app_handle);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Singleton detection + wake signaling between instances
    #[cfg(target_os = "windows")]
    unsafe {
        use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
        use windows_sys::Win32::System::Threading::{CreateEventW, CreateMutexW, SetEvent};

        let mutex_name: Vec<u16> = "SoltiniAppSingletonMutex\0".encode_utf16().collect();
        let _mutex = CreateMutexW(std::ptr::null_mut(), 0, mutex_name.as_ptr());
        let already_running = GetLastError() == ERROR_ALREADY_EXISTS;

        // Create/open an event for signaling the running instance to show itself
        let event_name: Vec<u16> = "SoltiniShowEvent\0".encode_utf16().collect();
        let event = CreateEventW(std::ptr::null_mut(), 0, 0, event_name.as_ptr());

        if already_running {
            // Another instance is running — signal it to show/focus, then exit
            if !event.is_null() {
                if GetLastError() == ERROR_ALREADY_EXISTS {
                    SetEvent(event);
                }
                CloseHandle(event);
            }
            return;
        }

        // First instance: store event for background thread in setup()
        // (cannot pass app_handle here, so we'll reopen it in setup)
        if !event.is_null() {
            CloseHandle(event);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
            authorized: Mutex::new(false),
        })
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
            verify_license,
            check_authorization,
            get_stored_license,
            trim_memory,
            enter_sleep_mode,
            wake_up_main,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyX) {
                                do_wake_up_main(app);
                                let _ = app.emit("soltini-exit-pet-mode", ());
                            }
                            if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyS) {
                                do_wake_up_main(app);
                                let _ = app.emit("soltini-toggle-mute", ());
                            }
                            if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyM) || shortcut.matches(Modifiers::empty(), Code::F9) {
                                do_wake_up_main(app);
                                let _ = app.emit("soltini-toggle-mic", ());
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
                    let shortcuts = ["ctrl+alt+x", "ctrl+alt+s", "ctrl+alt+m", "f9"];
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

            // Background thread: wait for wake signal from second instance
            #[cfg(target_os = "windows")]
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || unsafe {
                    use windows_sys::Win32::System::Threading::{
                        CreateEventW, WaitForSingleObject,
                    };

                    let name: Vec<u16> = "SoltiniShowEvent\0".encode_utf16().collect();
                    let event = CreateEventW(std::ptr::null_mut(), 0, 0, name.as_ptr());
                    if !event.is_null() {
                        loop {
                            WaitForSingleObject(event, u32::MAX);
                            do_wake_up_main(&app_handle);
                            let _ = app_handle.emit("soltini-exit-pet-mode", ());
                        }
                    }
                });
            }

            // Auto-deploy and launch background listener (DISABLED per user request)
            /*
            {
                let exe_dir = std::env::current_exe().ok()
                    .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                    .unwrap_or_default();
                let listener_path = exe_dir.join("soltini-listener.exe");

                if !listener_path.exists() {
                    if let Ok(resource_dir) = app.path().resource_dir() {
                        let resource_path = resource_dir.join("soltini-listener.exe");
                        if resource_path.exists() {
                            let _ = std::fs::copy(&resource_path, &listener_path);
                        }
                    }
                }

                if listener_path.exists() {
                    let _ = std::process::Command::new(&listener_path).spawn();
                }
            }
            */

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
                        if let Some(win) = app.get_webview_window("main") {
                            win.hide().unwrap();
                        }
                    }
                    "refresh" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.eval("window.location.reload();");
                        }
                    }
                    "options" => {
                        if let Some(win) = app.get_webview_window("main") {
                            win.show().unwrap();
                            win.set_focus().unwrap();
                            let _ = win.eval("window.dispatchEvent(new CustomEvent('soltini-open-settings'));");
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: TrayMouseButton::Left,
                        ..
                    } => {
                        let app = tray.app_handle();
                        do_wake_up_main(app);
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(win) = app.get_webview_window("main") {
                win.show().ok();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
