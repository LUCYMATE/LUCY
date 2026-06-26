use enigo::{Enigo, KeyboardControllable, MouseButton, MouseControllable};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use lazy_static::lazy_static;
use base64::prelude::*;
use std::sync::Mutex;
use sysinfo::System;
use tauri::{Manager, Emitter};
use tauri_plugin_opener::OpenerExt;

lazy_static! {
    static ref MIC_STREAM: Mutex<Option<cpal::Stream>> = Mutex::new(None);
}
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

fn downsample_to_pcm16(data: &[f32], sample_rate: f32, channels: usize) -> Vec<u8> {
    let mut pcm16 = Vec::new();
    let ratio = sample_rate / 16000.0;
    let mut i = 0.0;
    while (i as usize) * channels < data.len() {
        let sample = data[(i as usize) * channels];
        let sample_i16 = (sample.max(-1.0).min(1.0) * 32767.0) as i16;
        pcm16.extend_from_slice(&sample_i16.to_le_bytes());
        i += ratio;
    }
    pcm16
}

fn downsample_i16_to_pcm16(data: &[i16], sample_rate: f32, channels: usize) -> Vec<u8> {
    let mut pcm16 = Vec::new();
    let ratio = sample_rate / 16000.0;
    let mut i = 0.0;
    while (i as usize) * channels < data.len() {
        let sample = data[(i as usize) * channels];
        pcm16.extend_from_slice(&sample.to_le_bytes());
        i += ratio;
    }
    pcm16
}

#[tauri::command]
fn start_native_mic(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Stop any existing stream before opening a new one
    {
        let mut mic_stream = MIC_STREAM.lock().unwrap();
        if let Some(stream) = mic_stream.take() {
            stream.pause().ok();
            drop(stream);
        }
    }

    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("No input device available")?;
    
    let supported_config = device.default_input_config().map_err(|e| e.to_string())?;
    let sample_format = supported_config.sample_format();
    let config = supported_config.config();
    
    let sample_rate = config.sample_rate as f32;
    let channels = config.channels as usize;

    let err_fn = |err| log::error!("an error occurred on stream: {}", err);
    
    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _: &_| {
                let pcm16 = downsample_to_pcm16(data, sample_rate, channels);
                let base64_str = BASE64_STANDARD.encode(&pcm16);
                app_handle.emit("audio-data", base64_str).ok();
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _: &_| {
                let pcm16 = downsample_i16_to_pcm16(data, sample_rate, channels);
                let base64_str = BASE64_STANDARD.encode(&pcm16);
                app_handle.emit("audio-data", base64_str).ok();
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _: &_| {
                let floats: Vec<f32> = data
                    .iter()
                    .step_by(channels)
                    .map(|&s| (s as f32 / 32768.0) - 1.0)
                    .collect();
                let pcm16 = downsample_to_pcm16(&floats, sample_rate, 1);
                let base64_str = BASE64_STANDARD.encode(&pcm16);
                app_handle.emit("audio-data", base64_str).ok();
            },
            err_fn,
            None,
        ),
        _ => return Err(format!("Unsupported sample format: {:?}", sample_format)),
    }.map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;

    let mut mic_stream = MIC_STREAM.lock().unwrap();
    *mic_stream = Some(stream);

    Ok(())
}

#[tauri::command]
fn stop_native_mic() {
    let mut mic_stream = MIC_STREAM.lock().unwrap();
    if let Some(stream) = mic_stream.take() {
        stream.pause().ok();
        drop(stream);
    }
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

/// Checks the Windows registry to see if the microphone is allowed at the OS level.
/// Returns "granted", "denied", or "unknown".
#[tauri::command]
fn check_microphone_permission() -> String {
    check_mic_permission_impl()
}

#[cfg(target_os = "windows")]
fn check_mic_permission_impl() -> String {
    use std::process::Command;
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone",
            "/v",
            "Value",
        ])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_lowercase();
            if stdout.contains("allow") {
                "granted".to_string()
            } else if stdout.contains("deny") {
                "denied".to_string()
            } else {
                "unknown".to_string()
            }
        }
        Err(_) => "unknown".to_string(),
    }
}

#[cfg(not(target_os = "windows"))]
fn check_mic_permission_impl() -> String {
    // On macOS/Linux, getUserMedia handles it at the browser/OS level
    "granted".to_string()
}

/// Opens the native OS microphone privacy settings so the user can grant access.
/// On Windows: ms-settings:privacy-microphone
#[tauri::command]
fn open_microphone_privacy_settings(app_handle: tauri::AppHandle) -> Result<(), String> {
    open_mic_settings_impl(app_handle)
}

#[cfg(target_os = "windows")]
fn open_mic_settings_impl(app_handle: tauri::AppHandle) -> Result<(), String> {
    app_handle
        .opener()
        .open_url("ms-settings:privacy-microphone", None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn open_mic_settings_impl(_app_handle: tauri::AppHandle) -> Result<(), String> {
    Ok(())
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
            check_microphone_permission,
            open_microphone_privacy_settings,
            start_native_mic,
            stop_native_mic,
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
