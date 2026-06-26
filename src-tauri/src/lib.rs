use enigo::{Enigo, KeyboardControllable, MouseButton, MouseControllable};
use std::sync::Mutex;
use sysinfo::System;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

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
fn type_string(text: String) {
    let mut enigo = Enigo::new();
    enigo.key_sequence(&text);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            sys: Mutex::new(System::new_all()),
        })
        .invoke_handler(tauri::generate_handler![
            get_system_stats,
            open_external_url,
            move_and_click_mouse,
            type_string,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let win = app
                .get_webview_window("main")
                .expect("main window not found");
            win.show().ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
