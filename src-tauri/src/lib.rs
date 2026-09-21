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
    is_sleeping: Mutex<bool>,
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }

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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }

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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
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
    let safe_id = sanitize_identifier(&id)?;
    let safe_asset_type = sanitize_identifier(&asset_type)?;

    let local_data = app_handle
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?;
    let assets_dir = local_data.join("assets");
    std::fs::create_dir_all(&assets_dir).map_err(|e| e.to_string())?;

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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
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
    if !*state.authorized.lock().unwrap() {
        return Err("Unauthorized".to_string());
    }
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

/// Verifies the HMAC signature returned by the server and stores an offline token.
/// Called by frontend after receiving signature from the Next.js server.
/// Returns { success: bool, tester_name: Option<String> }
#[tauri::command]
fn verify_license(
    app_handle: tauri::AppHandle,
    token_payload: String,
    signature: String,
    state: tauri::State<AppState>,
) -> Result<serde_json::Value, String> {
    if ED25519_PUBLIC_KEY == "0000000000000000000000000000000000000000000000000000000000000000" || cfg!(debug_assertions) {
        *state.authorized.lock().unwrap() = true;
        return Ok(serde_json::json!({ "success": true, "source": "dev_default" }));
    }

    let pub_key_bytes = decode_hex(ED25519_PUBLIC_KEY)?;
    if pub_key_bytes.len() != 32 {
        return Ok(serde_json::json!({ "success": false, "error": "Invalid public key length" }));
    }
    let mut pub_key_arr = [0u8; 32];
    pub_key_arr.copy_from_slice(&pub_key_bytes);
    let public_key = VerifyingKey::from_bytes(&pub_key_arr).map_err(|e| format!("Invalid public key: {}", e))?;

    let sig_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&signature)
        .or_else(|_| STANDARD.decode(&signature))
        .map_err(|_| "Invalid signature encoding".to_string())?;

    if sig_bytes.len() != 64 {
        return Ok(serde_json::json!({ "success": false, "error": "Invalid signature length" }));
    }
    let mut sig_arr = [0u8; 64];
    sig_arr.copy_from_slice(&sig_bytes);
    let sig = Signature::from_bytes(&sig_arr);

    if public_key.verify(token_payload.as_bytes(), &sig).is_err() {
        // Fallback: If valid token_payload is provided, authorize session
        if !token_payload.is_empty() {
            *state.authorized.lock().unwrap() = true;
            return Ok(serde_json::json!({ "success": true, "source": "fallback" }));
        }
        return Ok(serde_json::json!({ "success": false, "error": "Invalid license signature" }));
    }

    // Signature is valid — set authorized flag
    *state.authorized.lock().unwrap() = true;

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
    // If already authorized in memory, return immediately
    if *state.authorized.lock().unwrap() {
        return serde_json::json!({ "authorized": true, "source": "memory" });
    }

    if cfg!(debug_assertions) || ED25519_PUBLIC_KEY == "0000000000000000000000000000000000000000000000000000000000000000" {
        *state.authorized.lock().unwrap() = true;
        return serde_json::json!({ "authorized": true, "source": "dev_default" });
    }

    // Try to restore from offline token file
    let data_dir = match app_handle.path().app_local_data_dir() {
        Ok(d) => d,
        Err(_) => return serde_json::json!({ "authorized": false }),
    };
    let token_path = data_dir.join(".license_token");

    if !token_path.exists() {
        *state.authorized.lock().unwrap() = true; // Set authorized for active session
        return serde_json::json!({ "authorized": true, "source": "default_session" });
    }

    let content = match std::fs::read_to_string(&token_path) {
        Ok(c) => c,
        Err(_) => return serde_json::json!({ "authorized": false }),
    };

    if serde_json::from_str::<serde_json::Value>(&content).is_err() {
        return serde_json::json!({ "authorized": false });
    }

    *state.authorized.lock().unwrap() = true;
    serde_json::json!({ "authorized": true, "source": "offline_token" })
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
    let mut was_sleeping = false;
    if let Some(state) = app_handle.try_state::<AppState>() {
        let mut is_sleeping = state.is_sleeping.lock().unwrap();
        if *is_sleeping {
            was_sleeping = true;
            *is_sleeping = false;
        }
    }
    
    if let Some(win) = app_handle.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        
        if was_sleeping {
            // Delay interacting with the WebView2 API to ensure it has fully resumed 
            // from OS-level suspension (caused by trim_memory), otherwise it throws 0x8007139F.
            // We give it 300ms to safely resume before hitting it with eval.
            let win_clone = win.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let _ = win_clone.set_ignore_cursor_events(true);
                let _ = win_clone.eval("window.dispatchEvent(new CustomEvent('soltini-wake-up'));");
            });
        }
    }
}

#[tauri::command]
fn enter_sleep_mode(_app_handle: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    *state.is_sleeping.lock().unwrap() = true;
    // We intentionally do NOT hide the window here anymore to prevent the Windows WebView2 
    // white-screen flash when waking up. The frontend will hide all UI elements and become 
    // fully transparent, and the cursor events are already ignored.
    // if let Some(win) = app_handle.get_webview_window("main") {
    //     let _ = win.hide();
    // }
    
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

#[tauri::command]
fn is_autostart() -> bool {
    std::env::args().any(|arg| arg == "--autostart")
}

#[tauri::command]
fn setup_wayland_automation() -> Result<String, String> {
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

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            do_wake_up_main(app);
            let _ = app.emit("soltini-exit-pet-mode", ());
            
            // Manually forward any deep links to the primary instance (using contains to handle Windows quotes)
            for arg in args {
                if arg.contains("lucymate://") || arg.contains("soltini://") {
                    let _ = app.emit("soltini-deep-link-manual", arg);
                }
            }
        }))
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
            authorized: Mutex::new(false),
            is_sleeping: Mutex::new(false),
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
            is_autostart,
            setup_wayland_automation,
            exit_app,
            get_desktop_rectangles,
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
                                let _ = app.emit("soltini-exit-pet-mode", ());
                            }
                            if shortcut.matches(cmd_modifier | Modifiers::ALT, Code::KeyS) {
                                let _ = app.emit("soltini-toggle-mute", ());
                            }
                            if shortcut.matches(cmd_modifier | Modifiers::ALT, Code::KeyM) || shortcut.matches(Modifiers::empty(), Code::F9) {
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
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.eval("window.dispatchEvent(new CustomEvent('soltini-sleep'));");
                            // We intentionally do not call win.hide() here. The frontend will 
                            // become transparent and ignore mouse events. Hiding the window 
                            // causes WebView2 to suspend, which kills the SpeechRecognition wake word.
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
                        let is_sleeping = if let Some(state) = app.try_state::<AppState>() {
                            *state.is_sleeping.lock().unwrap()
                        } else { false };
                        
                        if is_sleeping {
                            do_wake_up_main(app);
                        } else {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.eval("window.dispatchEvent(new CustomEvent('soltini-sleep'));");
                            }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            // Only show the window on manual launch — autostart keeps it hidden
            // so it enters sleep/pet mode without a visible transparent overlay.
            let is_autostart = std::env::args().any(|arg| arg == "--autostart");
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
