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

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let total_memory = sys.total_memory();
    let used_memory = sys.used_memory();

    serde_json::json!({
        "cpu_usage": cpu_usage,
        "total_memory": total_memory,
        "used_memory": used_memory
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
fn scroll_mouse(amount: i32) {
    let mut enigo = Enigo::new();
    enigo.mouse_scroll_y(amount);
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
fn press_key(key: String) {
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
                return;
            }
        }
    };
    enigo.key_click(enigo_key);
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
            capture_screen,
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
