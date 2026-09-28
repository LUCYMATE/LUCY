use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{DeviceId, SampleFormat, Stream, StreamConfig};
use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
pub struct InputDevice {
    id: String,
    label: String,
    is_default: bool,
}

pub struct NativeAudioState {
    stream: Mutex<Option<NativeCapture>>,
    wake: Mutex<Option<WakeWorker>>,
    boost: Arc<AtomicU32>,
}

struct NativeCapture {
    stream: Option<Stream>,
    sender: Option<std::sync::mpsc::SyncSender<Vec<i16>>>,
    emitter: Option<std::thread::JoinHandle<()>>,
}

impl Drop for NativeCapture {
    fn drop(&mut self) {
        self.stream.take();
        self.sender.take();
        if let Some(emitter) = self.emitter.take() {
            let _ = emitter.join();
        }
    }
}

impl NativeAudioState {
    pub fn new() -> Self {
        Self {
            stream: Mutex::new(None),
            wake: Mutex::new(None),
            boost: Arc::new(AtomicU32::new(2.0f32.to_bits())),
        }
    }
}

struct WakeWorker {
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}

#[tauri::command]
pub fn list_native_microphones() -> Result<Vec<InputDevice>, String> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|device| device.id().ok());
    let devices = host
        .input_devices()
        .map_err(|e| format!("Could not list microphones: {e}"))?;
    Ok(devices
        .filter_map(|device| {
            let id = device.id().ok()?;
            let label = device.description().ok()?.name().to_string();
            let is_default = default_id.as_ref() == Some(&id);
            Some(InputDevice {
                id: id.to_string(),
                label,
                is_default,
            })
        })
        .collect())
}

#[tauri::command]
pub fn start_native_mic(
    app: AppHandle,
    state: tauri::State<'_, NativeAudioState>,
    device_id: Option<String>,
    boost: Option<f32>,
) -> Result<(), String> {
    let mut slot = state
        .stream
        .lock()
        .map_err(|_| "Microphone state is unavailable")?;
    if slot.is_some() {
        return Ok(());
    }

    let host = cpal::default_host();
    let preferred_id = device_id.filter(|s| !s.is_empty() && s != "default");
    let preferred = preferred_id
        .as_deref()
        .and_then(|id| id.parse::<DeviceId>().ok())
        .and_then(|id| host.device_by_id(&id));
    if preferred.is_none() && preferred_id.is_some() {
        let _ = app.emit_to(
            "main",
            "native-mic-warning",
            "The saved microphone is unavailable; Lucy is using the Windows default input device."
                .to_string(),
        );
    }
    let device = preferred
        .or_else(|| host.default_input_device())
        .ok_or_else(|| "No microphone is available".to_string())?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("Could not open microphone format: {e}"))?;
    let sample_format = supported.sample_format();
    let config: StreamConfig = supported.into();
    let channels = config.channels as usize;
    let input_rate = config.sample_rate as usize;
    if channels == 0 || input_rate == 0 {
        return Err("Microphone reported an invalid audio format".into());
    }

    let gain = state.boost.clone();
    gain.store(
        boost.unwrap_or(2.0).clamp(1.0, 5.0).to_bits(),
        Ordering::Relaxed,
    );
    let (frame_sender, frame_receiver) = std::sync::mpsc::sync_channel::<Vec<i16>>(8);
    let emitter_app = app.clone();
    let emitter = std::thread::Builder::new()
        .name("lucy-mic-event-forwarder".into())
        .spawn(move || {
            while let Ok(frame) = frame_receiver.recv() {
                let _ = emitter_app.emit_to("main", "native-mic-frame", frame);
            }
        })
        .map_err(|e| format!("Could not create microphone audio forwarder: {e}"))?;
    let mut phase = 0usize;
    let mut output = Vec::<i16>::with_capacity(1600);
    let error_app = app.clone();
    let error_callback = move |error: cpal::StreamError| {
        let _ = error_app.emit_to("main", "native-mic-error", error.to_string());
    };

    macro_rules! build_stream {
        ($sample:ty) => {{
            let frame_sender = frame_sender.clone();
            device
                .build_input_stream(
                    &config,
                    move |data: &[$sample], _| {
                        for frame in data.chunks(channels) {
                            if frame.is_empty() {
                                continue;
                            }
                            let mono = frame
                                .iter()
                                .map(|sample| sample.to_sample::<f32>())
                                .sum::<f32>()
                                / frame.len() as f32;
                            phase += 16_000;
                            while phase >= input_rate {
                                phase -= input_rate;
                                let current_gain = f32::from_bits(gain.load(Ordering::Relaxed));
                                let amplified = (mono * current_gain).clamp(-1.0, 1.0);
                                output.push((amplified * i16::MAX as f32) as i16);
                                if output.len() >= 1600 {
                                    let frame =
                                        std::mem::replace(&mut output, Vec::with_capacity(1600));
                                    let _ = frame_sender.try_send(frame);
                                }
                            }
                        }
                    },
                    error_callback,
                    None,
                )
                .map_err(|e| format!("Could not start microphone capture: {e}"))?
        }};
    }

    use cpal::Sample;
    let stream = match sample_format {
        SampleFormat::I8 => build_stream!(i8),
        SampleFormat::I16 => build_stream!(i16),
        SampleFormat::I32 => build_stream!(i32),
        SampleFormat::I64 => build_stream!(i64),
        SampleFormat::U8 => build_stream!(u8),
        SampleFormat::U16 => build_stream!(u16),
        SampleFormat::U32 => build_stream!(u32),
        SampleFormat::U64 => build_stream!(u64),
        SampleFormat::F32 => build_stream!(f32),
        SampleFormat::F64 => build_stream!(f64),
        _ => {
            return Err(format!(
                "Unsupported microphone audio format: {sample_format:?}"
            ))
        }
    };
    if let Err(error) = stream.play() {
        drop(stream);
        drop(frame_sender);
        let _ = emitter.join();
        return Err(format!("Could not activate microphone: {error}"));
    }
    *slot = Some(NativeCapture {
        stream: Some(stream),
        sender: Some(frame_sender),
        emitter: Some(emitter),
    });
    Ok(())
}

#[tauri::command]
pub fn stop_native_mic(state: tauri::State<'_, NativeAudioState>) -> Result<(), String> {
    let mut stream = state
        .stream
        .lock()
        .map_err(|_| "Microphone state is unavailable")?;
    stream.take();
    Ok(())
}

#[tauri::command]
pub fn set_native_mic_boost(
    state: tauri::State<'_, NativeAudioState>,
    boost: f32,
) -> Result<(), String> {
    state
        .boost
        .store(boost.clamp(1.0, 5.0).to_bits(), Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn start_native_wake_listener(
    app: AppHandle,
    state: tauri::State<'_, NativeAudioState>,
) -> Result<(), String> {
    let mut slot = state
        .wake
        .lock()
        .map_err(|_| "Wake listener state is unavailable")?;
    if let Some(worker) = slot.as_ref() {
        if !worker.thread.is_finished() {
            return Ok(());
        }
        slot.take();
    }
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let worker_stop = stop.clone();
    let thread = std::thread::Builder::new()
        .name("lucy-native-wake".into())
        .spawn(move || {
            #[cfg(target_os = "windows")]
            run_windows_wake_listener(app, worker_stop);
            #[cfg(not(target_os = "windows"))]
            {
                let _ = app.emit_to(
                    "main",
                    "native-wake-error",
                    "Native wake recognition is supported on Windows only.".to_string(),
                );
                let _ = worker_stop;
            }
        })
        .map_err(|e| format!("Could not start wake listener: {e}"))?;
    *slot = Some(WakeWorker { stop, thread });
    Ok(())
}

#[tauri::command]
pub fn stop_native_wake_listener(state: tauri::State<'_, NativeAudioState>) -> Result<(), String> {
    let mut slot = state
        .wake
        .lock()
        .map_err(|_| "Wake listener state is unavailable")?;
    if let Some(worker) = slot.take() {
        worker.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        // The WinRT recognizer can take time to release its audio endpoint; do
        // not block the UI command. The worker exits on its own after StopAsync.
        drop(worker.thread);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn run_windows_wake_listener(app: AppHandle, stop: Arc<std::sync::atomic::AtomicBool>) {
    use windows::Foundation::TypedEventHandler;
    use windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechContinuousRecognitionSession,
        SpeechRecognitionResultStatus, SpeechRecognizer,
    };
    use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

    unsafe {
        if RoInitialize(RO_INIT_MULTITHREADED).is_err() {
            let _ = app.emit_to(
                "main",
                "native-wake-error",
                "Windows speech recognition could not initialize.".to_string(),
            );
            return;
        }
    }

    let result = (|| -> windows::core::Result<()> {
        let recognizer = SpeechRecognizer::new()?;
        let compilation = recognizer.CompileConstraintsAsync()?.get()?;
        if compilation.Status()? != SpeechRecognitionResultStatus::Success {
            let _ = app.emit_to("main", "native-wake-error", "Windows speech recognition grammar is unavailable. Check that Windows speech recognition is enabled for your language.".to_string());
            recognizer.Close()?;
            return Ok(());
        }
        let session = recognizer.ContinuousRecognitionSession()?;
        let app_for_result = app.clone();
        let stop_for_result = stop.clone();
        let _token = session.ResultGenerated(&TypedEventHandler::new(
            move |_: windows::core::Ref<'_, SpeechContinuousRecognitionSession>,
                  args: windows::core::Ref<
                '_,
                SpeechContinuousRecognitionResultGeneratedEventArgs,
            >| {
                let args = args.ok()?;
                if let Ok(result) = args.Result() {
                    if let Ok(hypothesis) = result.Text() {
                        let text = hypothesis.to_string();
                        let normalized = text.to_lowercase();
                        let detected = [
                            "lucy",
                            "luci",
                            "lucie",
                            "loosey",
                            "losey",
                            "wake up",
                            "wakeup",
                            "hey lucy",
                            "hello lucy",
                        ]
                        .iter()
                        .any(|phrase| normalized.contains(phrase));
                        if detected
                            && !stop_for_result.swap(true, std::sync::atomic::Ordering::SeqCst)
                        {
                            let _ = app_for_result.emit_to("main", "native-wake-detected", text);
                        }
                    }
                }
                Ok(())
            },
        ))?;
        let _ = app.emit_to("main", "native-wake-status", "listening".to_string());
        session.StartAsync()?.get()?;
        while !stop.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let _ = session.StopAsync()?.get();
        let _ = recognizer.Close();
        Ok(())
    })();

    if let Err(error) = result {
        let _ = app.emit_to(
            "main",
            "native-wake-error",
            format!("Windows speech listener failed: {error}"),
        );
    }
    let _ = app.emit_to("main", "native-wake-status", "stopped".to_string());
    unsafe {
        RoUninitialize();
    }
}
