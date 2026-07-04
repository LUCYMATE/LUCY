use enigo::{Enigo, KeyboardControllable, MouseButton, MouseControllable, Key};
use std::sync::Mutex;
use sysinfo::System;
use tauri::{Manager, Emitter};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_global_shortcut::{Builder as ShortcutBuilder, Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
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
    let file_path = temp_dir.join("syra_temp_script.py");
    std::fs::write(&file_path, script).map_err(|e| e.to_string())?;

    let output = std::process::Command::new("python")
        .arg(&file_path)
        .output()
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
    let output = std::process::Command::new("cmd")
        .args(&["/C", &command])
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
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(
            ShortcutBuilder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app.emit("toggle-mic", ());
                    }
                })
                .build(),
        )
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

            // Register global shortcut Alt+Space
            let shortcut = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            app.global_shortcut().register(shortcut)?;

            let win = app
                .get_webview_window("main")
                .expect("main window not found");
            win.show().ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
