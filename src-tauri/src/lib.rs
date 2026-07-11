use enigo::{Enigo, KeyboardControllable, MouseButton, MouseControllable, Key};
use std::sync::Mutex;
use sysinfo::System;
use tauri::{Emitter, Manager};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton as TrayMouseButton};
use tauri::menu::{Menu, MenuItem};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};
use tauri_plugin_opener::OpenerExt;
use screenshots::Screen;
use base64::{Engine as _, engine::general_purpose::STANDARD};

struct AppState {
    sys: Mutex<System>,
}

#[tauri::command]
fn get_system_stats(state: tauri::State<AppState>) -> serde_json::Value {
    let mut sys = state.sys.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    sys.refresh_processes();

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let total_memory = sys.total_memory();
    
    // Calculate exact RAM used by this app and its webview child processes
    let current_pid = sysinfo::get_current_pid().unwrap();
    let mut app_memory: u64 = 0;
    
    for (pid, process) in sys.processes() {
        if *pid == current_pid || process.parent() == Some(current_pid) {
            app_memory += process.memory();
        }
    }

    serde_json::json!({
        "cpu_usage": cpu_usage,
        "total_memory": total_memory,
        "used_memory": sys.used_memory(),
        "app_memory": app_memory
    })
}

#[tauri::command]
fn open_external_url(app_handle: tauri::AppHandle, url: String) -> Result<(), String> {
    app_handle.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_and_click_mouse(x: i32, y: i32) {
    let mut enigo = Enigo::new();
    enigo.mouse_move_to(x, y);
    enigo.mouse_click(MouseButton::Left);
}

#[tauri::command]
fn scroll_mouse(amount: i32) -> Result<(), String> {
    let mut enigo = Enigo::new();
    enigo.mouse_scroll_y(amount);
    Ok(())
}

#[tauri::command]
fn type_string(text: String) {
    let mut enigo = Enigo::new();
    enigo.key_sequence(&text);
}

#[tauri::command]
fn run_python_script(script: String) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join("soltini_temp_script.py");
    std::fs::write(&file_path, script).map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new("python");
    cmd.arg(&file_path);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd.output()
        .map_err(|e| format!("Failed to execute python: {}. Ensure Python is installed.", e))?;

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
fn run_terminal_command(command: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new("cmd");
    cmd.args(&["/C", &command]);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let output = cmd.output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        Ok(format!("Stdout:\n{}\nStderr:\n{}", stdout, stderr))
    } else {
        Ok(stdout)
    }
}

#[tauri::command]
fn press_key(key: String) -> Result<(), String> {
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
fn press_key_combo(keys: Vec<String>) -> Result<(), String> {
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
fn capture_screen() -> Result<serde_json::Value, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;
    let screen = screens.first().ok_or("No screen found")?;
    
    let mut img = screen.capture().map_err(|e| format!("Capture failed: {}", e))?;
    
    let width = img.width();
    let height = img.height();
    let grid_spacing = 100;
    
    // Draw 100px grid overlay
    for x in (0..width).step_by(grid_spacing as usize) {
        for y in 0..height {
            let pixel = img.get_pixel_mut(x, y);
            // Subtle Red for vertical
            pixel[0] = 255; 
            pixel[1] = pixel[1].saturating_sub(50);
            pixel[2] = pixel[2].saturating_sub(50);
        }
    }
    for y in (0..height).step_by(grid_spacing as usize) {
        for x in 0..width {
            let pixel = img.get_pixel_mut(x, y);
            // Subtle Blue for horizontal
            pixel[0] = pixel[0].saturating_sub(50);
            pixel[1] = pixel[1].saturating_sub(50);
            pixel[2] = 255;
        }
    }

    let mut bytes = Vec::new();
    let dynamic_img = screenshots::image::DynamicImage::ImageRgba8(img);
    dynamic_img.write_to(&mut std::io::Cursor::new(&mut bytes), screenshots::image::ImageFormat::Jpeg)
        .map_err(|e| format!("JPEG conversion failed: {}", e))?;
    
    let base64_image = STANDARD.encode(&bytes);

    Ok(serde_json::json!({
        "base64": base64_image,
        "width": screen.display_info.width,
        "height": screen.display_info.height
    }))
}

#[tauri::command]
fn save_3d_asset(app_handle: tauri::AppHandle, id: String, asset_type: String, name: String, data_base64: String) -> Result<(), String> {
    let local_data = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
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

    std::fs::write(registry_path, serde_json::to_string_pretty(&registry).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_3d_asset(app_handle: tauri::AppHandle, id: String) -> Result<(), String> {
    let local_data = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
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
            let _ = std::fs::write(registry_path, serde_json::to_string_pretty(&registry).unwrap());
        }
    }
    Ok(())
}

#[tauri::command]
fn list_3d_assets(app_handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let local_data = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let registry_path = local_data.join("assets").join("registry.json");
    if registry_path.exists() {
        let content = std::fs::read_to_string(&registry_path).map_err(|e| e.to_string())?;
        let registry: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        
        if let Some(obj) = registry.as_object() {
            let values: Vec<serde_json::Value> = obj.values().cloned().collect();
            return Ok(serde_json::Value::Array(values));
        }
    }
    Ok(serde_json::json!([]))
}

#[tauri::command]
fn read_3d_asset(app_handle: tauri::AppHandle, id: String) -> Result<String, String> {
    let local_data = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
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
            }).to_string());
        }
    }
    Err("Asset not found".to_string())
}

#[tauri::command]
fn get_3d_asset_path(app_handle: tauri::AppHandle, id: String) -> Result<String, String> {
    let local_data = app_handle.path().app_local_data_dir().map_err(|e| e.to_string())?;
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
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
            get_3d_asset_path,
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
                                let _ = app.emit("soltini-exit-pet-mode", ());
                            }
                            if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyS) {
                                let _ = app.emit("soltini-toggle-mute", ());
                            }
                            if shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyM) {
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
                    let shortcuts = ["ctrl+alt+x", "ctrl+alt+s", "ctrl+alt+m"];
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
                std::thread::spawn(move || {
                    unsafe {
                        use windows_sys::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

                        let name: Vec<u16> = "SoltiniShowEvent\0".encode_utf16().collect();
                        let event = CreateEventW(std::ptr::null_mut(), 0, 0, name.as_ptr());
                        if !event.is_null() {
                            loop {
                                WaitForSingleObject(event, u32::MAX);
                                let _ = app_handle.emit("soltini-exit-pet-mode", ());
                            }
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
            let show_i = MenuItem::with_id(app, "show", "Show Soltini", true, None::<&str>)?;
            let pet_mode_i = MenuItem::with_id(app, "pet_mode", "Exit Pet Mode", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &pet_mode_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            win.show().unwrap();
                            win.set_focus().unwrap();
                        }
                    }
                    "pet_mode" => {
                        let _ = app.emit("soltini-exit-pet-mode", ());
                        if let Some(win) = app.get_webview_window("main") {
                            win.show().unwrap();
                            win.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click { button: TrayMouseButton::Left, .. } => {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            win.show().unwrap();
                            win.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            let win = app
                .get_webview_window("main")
                .expect("main window not found");
            win.show().ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
