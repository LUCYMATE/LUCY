use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{DeviceId, SampleFormat, Stream, StreamConfig};
use oww_rs::oww::audio::AudioFeaturesTract;
use serde::Serialize;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
pub struct InputDevice {
    id: String,
    label: String,
    is_default: bool,
}

#[derive(Clone, Copy)]
struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl BiquadFilter {
    fn lowpass(sample_rate: f32, cutoff_hz: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * (cutoff_hz / sample_rate).clamp(0.01, 0.49);
        let sn = omega.sin();
        let cs = omega.cos();
        let alpha = sn / (2.0 * std::f32::consts::FRAC_1_SQRT_2);
        let a0 = 1.0 + alpha;
        let b0 = ((1.0 - cs) / 2.0) / a0;
        let b1 = (1.0 - cs) / a0;
        let b2 = ((1.0 - cs) / 2.0) / a0;
        let a1 = (-2.0 * cs) / a0;
        let a2 = (1.0 - alpha) / a0;
        Self { b0, b1, b2, a1, a2, z1: 0.0, z2: 0.0 }
    }

    fn highpass(sample_rate: f32, cutoff_hz: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * (cutoff_hz / sample_rate).clamp(0.001, 0.45);
        let sn = omega.sin();
        let cs = omega.cos();
        let alpha = sn / (2.0 * std::f32::consts::FRAC_1_SQRT_2);
        let a0 = 1.0 + alpha;
        let b0 = ((1.0 + cs) / 2.0) / a0;
        let b1 = (-(1.0 + cs)) / a0;
        let b2 = ((1.0 + cs) / 2.0) / a0;
        let a1 = (-2.0 * cs) / a0;
        let a2 = (1.0 - alpha) / a0;
        Self { b0, b1, b2, a1, a2, z1: 0.0, z2: 0.0 }
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

#[inline]
fn soft_clip(x: f32) -> f32 {
    if x > 1.25 {
        1.0
    } else if x < -1.25 {
        -1.0
    } else {
        x - (x * x * x) * 0.16
    }
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
    test_mode: bool,
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
    // 1. If background wake detector is running, stop and join it first so WASAPI releases the mic
    if let Ok(mut wake_slot) = state.wake.lock() {
        if let Some(worker) = wake_slot.take() {
            worker.stop.store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = worker.thread.join();
        }
    }

    let mut slot = state
        .stream
        .lock()
        .map_err(|_| "Microphone state is unavailable")?;

    // 2. Cleanly stop any existing capture so we always open a fresh healthy stream
    if let Some(existing) = slot.take() {
        drop(existing);
    }

    let host = cpal::default_host();
    let preferred_id = device_id.filter(|s| !s.is_empty() && s != "default");
    let preferred = preferred_id
        .as_deref()
        .and_then(|id| id.parse::<DeviceId>().ok())
        .and_then(|id| host.device_by_id(&id));
    if preferred.is_none() && preferred_id.is_some() {
        let _ = app.emit(
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
    // Buffer up to 32 chunks (~3.2s) to prevent any frame drops during frontend animation spikes
    let (frame_sender, frame_receiver) = std::sync::mpsc::sync_channel::<Vec<i16>>(32);
    let emitter_app = app.clone();
    let emitter = std::thread::Builder::new()
        .name("lucy-mic-event-forwarder".into())
        .spawn(move || {
            while let Ok(frame) = frame_receiver.recv() {
                let _ = emitter_app.emit("native-mic-frame", frame);
            }
        })
        .map_err(|e| format!("Could not create microphone audio forwarder: {e}"))?;
    let mut phase = 0usize;
    let mut output = Vec::<i16>::with_capacity(1600);
    let mut hp_filter = BiquadFilter::highpass(input_rate as f32, 80.0);
    let error_app = app.clone();
    let error_callback = move |error: cpal::StreamError| {
        let _ = error_app.emit("native-mic-error", error.to_string());
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
                            let filtered = hp_filter.process(mono);
                            phase += 16_000;
                            while phase >= input_rate {
                                phase -= input_rate;
                                let current_gain = f32::from_bits(gain.load(Ordering::Relaxed));
                                let amplified = soft_clip(filtered * current_gain).clamp(-1.0, 1.0);
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
    device_id: Option<String>,
) -> Result<(), String> {
    start_wake_worker(app, state, device_id, false)
}

#[tauri::command]
pub fn start_native_wake_test(
    app: AppHandle,
    state: tauri::State<'_, NativeAudioState>,
    device_id: Option<String>,
) -> Result<(), String> {
    start_wake_worker(app, state, device_id, true)
}

fn start_wake_worker(
    app: AppHandle,
    state: tauri::State<'_, NativeAudioState>,
    device_id: Option<String>,
    test_mode: bool,
) -> Result<(), String> {
    if let Ok(mut stream_slot) = state.stream.lock() {
        stream_slot.take();
    }

    let mut slot = state
        .wake
        .lock()
        .map_err(|_| "Wake listener state is unavailable")?;
    if let Some(worker) = slot.as_ref() {
        if !worker.stop.load(std::sync::atomic::Ordering::SeqCst)
            && !worker.thread.is_finished()
            && worker.test_mode == test_mode
        {
            return Ok(());
        }
    }
    if let Some(worker) = slot.take() {
        worker.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = worker.thread.join();
    }
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let worker_stop = stop.clone();
    let boost = state.boost.clone();
    let thread = std::thread::Builder::new()
        .name("lucy-native-wake".into())
        .spawn(move || {
            run_native_wake_listener(app, worker_stop, device_id, test_mode, boost);
        })
        .map_err(|e| format!("Could not start wake listener: {e}"))?;
    *slot = Some(WakeWorker { stop, thread, test_mode });
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
        let _ = worker.thread.join();
    }
    Ok(())
}

fn wake_model_path(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let relative = format!("models/wakeword/{name}.onnx");
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join(&relative);
        if bundled.is_file() {
            return Ok(bundled);
        }
    }

    let development = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(&relative);
    if development.is_file() {
        return Ok(development);
    }
    Err(format!("Wake-word model is missing: {relative}"))
}

struct MonoResampler16k {
    ratio: f64,
    offset: f64,
    last_sample: f32,
    has_first: bool,
    highpass: BiquadFilter,
    lowpass: Option<BiquadFilter>,
}

impl MonoResampler16k {
    fn new(input_rate: usize) -> Self {
        let rate_f32 = input_rate as f32;
        let highpass = BiquadFilter::highpass(rate_f32, 80.0);
        let lowpass = if input_rate > 16_000 {
            Some(BiquadFilter::lowpass(rate_f32, 7_500.0))
        } else {
            None
        };
        Self {
            ratio: input_rate as f64 / 16_000.0,
            offset: 0.0,
            last_sample: 0.0,
            has_first: false,
            highpass,
            lowpass,
        }
    }

    fn push(&mut self, current: f32, out: &mut Vec<f32>) {
        let hp = self.highpass.process(current);
        let filtered = match &mut self.lowpass {
            Some(lp) => lp.process(hp),
            None => hp,
        };

        if (self.ratio - 1.0).abs() < 1e-4 {
            out.push(filtered);
            return;
        }

        if !self.has_first {
            self.last_sample = filtered;
            self.has_first = true;
            out.push(filtered);
            self.offset = self.ratio;
            return;
        }

        while self.offset <= 1.0 {
            let alpha = self.offset as f32;
            let interpolated = self.last_sample + alpha * (filtered - self.last_sample);
            out.push(interpolated);
            self.offset += self.ratio;
        }

        self.offset -= 1.0;
        self.last_sample = filtered;
    }
}

fn run_native_wake_listener(
    app: AppHandle,
    stop: Arc<std::sync::atomic::AtomicBool>,
    preferred_id: Option<String>,
    test_mode: bool,
    boost: Arc<AtomicU32>,
) {
    use std::time::Duration;

    let result = (|| -> Result<(), String> {
        let _ = app.emit("native-wake-status", "Opening wake microphone…".to_string());
        let host = cpal::default_host();
        let preferred = preferred_id
            .as_deref()
            .filter(|id| !id.is_empty() && *id != "default")
            .and_then(|id| id.parse::<DeviceId>().ok())
            .and_then(|id| host.device_by_id(&id));
        if preferred.is_none() && preferred_id.as_deref().is_some_and(|id| id != "default") {
            let _ = app.emit(
                "native-wake-status",
                "Selected microphone unavailable; using the system default microphone.".to_string(),
            );
        }
        let device = preferred
            .or_else(|| host.default_input_device())
            .ok_or_else(|| "No microphone is available for wake-word listening.".to_string())?;
        let supported = device
            .default_input_config()
            .map_err(|e| format!("Could not open wake microphone format: {e}"))?;
        let sample_format = supported.sample_format();
        let config: StreamConfig = supported.into();
        let channels = config.channels as usize;
        let input_rate = config.sample_rate as usize;
        if channels == 0 || input_rate == 0 {
            return Err("Microphone reported zero audio channels or invalid sample rate.".to_string());
        }

        let (sender, receiver) = std::sync::mpsc::sync_channel::<Vec<f32>>(256);
        let dropped_chunks = Arc::new(AtomicU64::new(0));

        let error_app = app.clone();
        let error_stop = stop.clone();
        let on_error = move |error: cpal::StreamError| {
            error_stop.store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = error_app.emit(
                "native-wake-error",
                format!("Wake microphone stopped: {error}"),
            );
        };

        let gain = boost.clone();
        macro_rules! build_stream {
            ($sample:ty) => {{
                let sender = sender.clone();
                let gain = gain.clone();
                let dropped_chunks = dropped_chunks.clone();
                device
                    .build_input_stream(
                        &config,
                        move |data: &[$sample], _| {
                            use cpal::Sample;
                            let current_gain = f32::from_bits(gain.load(Ordering::Relaxed)).clamp(1.0, 5.0);
                            let mut chunk = Vec::with_capacity(data.len() / channels);
                            for frame in data.chunks(channels) {
                                if frame.is_empty() {
                                    continue;
                                }
                                let mono = frame
                                    .iter()
                                    .map(|sample| sample.to_sample::<f32>())
                                    .sum::<f32>()
                                    / frame.len() as f32;
                                let amplified = soft_clip(mono * current_gain).clamp(-1.0, 1.0);
                                chunk.push(amplified);
                            }
                            if sender.try_send(chunk).is_err() {
                                dropped_chunks.fetch_add(1, Ordering::Relaxed);
                            }
                        },
                        on_error,
                        None,
                    )
                    .map_err(|e| format!("Could not start wake microphone: {e}"))?
            }};
        }

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
                    "Unsupported wake microphone format: {sample_format:?}"
                ))
            }
        };
        stream
            .play()
            .map_err(|e| format!("Could not activate wake microphone: {e}"))?;
        let _ = app.emit(
            "native-wake-status",
            format!("Microphone open ({input_rate} Hz); loading wake models…"),
        );

        // Prepare wake-word neural models
        let lucy_path = wake_model_path(&app, "lucy")?;
        let hey_lucy_path = wake_model_path(&app, "hey_lucy")?;
        use tract_core::model::IntoRunnable;
        use tract_core::prelude::{
            multithread::{self, Executor},
            Framework,
        };
        use tract_onnx::prelude::{tvec, InferenceModelExt, IntoTensor};

        multithread::set_default_executor(Executor::SingleThread);
        let mut models = Vec::new();
        for (phrase, path) in [("Lucy", &lucy_path), ("Hey Lucy", &hey_lucy_path)] {
            let model = tract_onnx::onnx()
                .model_for_path(path)
                .map_err(|e| format!("Could not read {phrase} wake model: {e}"))?
                .into_optimized()
                .map_err(|e| format!("Could not optimize {phrase} wake model: {e}"))?
                .into_runnable()
                .map_err(|e| format!("Could not prepare {phrase} wake model: {e}"))?;
            models.push((phrase, model));
        }
        let mut audio_features = AudioFeaturesTract::create_default();

        // Report readiness only after the microphone and both models are usable.
        let _ = app.emit(
            "native-wake-status",
            format!("listening on selected microphone ({input_rate} Hz input)"),
        );

        let mut resampler = MonoResampler16k::new(input_rate);
        let mut mono_16k_buffer = Vec::<f32>::with_capacity(32000);
        let mut processed_inference_chunks = 0u64;
        const WARMUP_CHUNKS: u64 = 8; // 8 chunks * 80ms = 0.64s to fill AudioFeatures buffers with real audio
        let mut score_history = [
            std::collections::VecDeque::<f32>::with_capacity(12),
            std::collections::VecDeque::<f32>::with_capacity(12),
        ];
        let mut last_detection = None::<std::time::Instant>;
        let mut last_audio_at = std::time::Instant::now();
        while !stop.load(std::sync::atomic::Ordering::SeqCst) {
            match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(chunk) => {
                    last_audio_at = std::time::Instant::now();
                    for sample in chunk {
                        resampler.push(sample, &mut mono_16k_buffer);
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("Wake microphone audio stream disconnected unexpectedly.".to_string());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if last_audio_at.elapsed() > Duration::from_secs(10) {
                        return Err("Wake microphone stopped delivering audio for 10 seconds.".to_string());
                    }
                }
            }

            while mono_16k_buffer.len() >= 1280 {
                if mono_16k_buffer.len() > 32_000 {
                    mono_16k_buffer.drain(..mono_16k_buffer.len() - 32_000);
                }

                let mono: Vec<f32> = mono_16k_buffer.drain(..1280).collect();
                // Keep the energy gate on the same 80 ms frame as the model score.
                // Using the last device callback (often only a few milliseconds) can
                // reject a valid wake when that callback happens between syllables.
                let frame_rms = (mono.iter().map(|sample| sample * sample).sum::<f32>()
                    / mono.len() as f32)
                    .sqrt();
                let frame_peak = mono.iter().map(|sample| sample.abs()).fold(0.0, f32::max);
                processed_inference_chunks += 1;
                let features = audio_features
                    .get_audio_features(&mono)
                    .map_err(|e| format!("Wake audio feature extraction failed: {e}"))?
                    .into_shape(&[1, 16, 96])
                    .map_err(|e| format!("Wake audio features had an invalid shape: {e}"))?;

                for (index, (phrase, model)) in models.iter_mut().enumerate() {
                    let outputs = model
                        .run(tvec!(features.clone().into()))
                        .map_err(|e| format!("{phrase} wake inference failed: {e}"))?;
                    let score_tensor = outputs[0]
                        .clone()
                        .into_tensor()
                        .cast_to::<f32>()
                        .map_err(|e| format!("{phrase} wake score had an invalid type: {e}"))?
                        .into_owned();
                    let raw_score = score_tensor
                        .into_plain_array::<f32>()
                        .map_err(|e| format!("{phrase} wake score could not be read: {e}"))?
                        .as_slice()
                        .and_then(|values| values.first().copied())
                        .unwrap_or(0.0);

                    // Suppress unbuffered zero-state scores during the initial warmup window
                    let is_warming_up = processed_inference_chunks < WARMUP_CHUNKS;
                    let score = if is_warming_up { 0.0 } else { raw_score };

                    let history = &mut score_history[index];
                    history.push_back(score);
                    if history.len() > 8 {
                        history.pop_front();
                    }

                    let recent_len = history.len().min(3);
                    let recent_avg = if recent_len > 0 {
                        history.iter().rev().take(recent_len).sum::<f32>() / recent_len as f32
                    } else {
                        0.0
                    };
                    let smoothed = score.max(recent_avg);

                    if test_mode {
                        let _ = app.emit(
                            "native-wake-test-score",
                            serde_json::json!({ "phrase": phrase, "score": score, "smoothed": smoothed }),
                        );
                    }

                    // The single-word model retains a responsive high-confidence path, while
                    // both phrases require stronger confidence or repeated evidence to reduce
                    // false wakes. Lucy is intentionally stricter than the compound phrase.
                    let (phrase_triggered, energy_satisfied) = if *phrase == "Lucy" {
                        let positive_frames = history.iter().rev().take(5).filter(|&&val| val >= 0.55).count();
                        let energy_ok = frame_peak >= 0.018 || frame_rms >= 0.0025;
                        let trigger = score >= 0.78 || (smoothed >= 0.62 && positive_frames >= 3);
                        (trigger, energy_ok)
                    } else {
                        // "Hey Lucy"
                        let positive_frames = history.iter().rev().take(5).filter(|&&val| val >= 0.38).count();
                        let energy_ok = frame_peak >= 0.010 || frame_rms >= 0.0018;
                        // Keep the compound phrase somewhat more responsive than "Lucy",
                        // but reject the previous weak single-frame and two-frame triggers.
                        let trigger = score >= 0.58 || (smoothed >= 0.46 && positive_frames >= 3);
                        (trigger, energy_ok)
                    };

                    let is_detected = !is_warming_up
                        && energy_satisfied
                        && phrase_triggered
                        && last_detection.map_or(true, |last: std::time::Instant| {
                            last.elapsed() > Duration::from_secs(2)
                        });

                    if is_detected {
                        last_detection = Some(std::time::Instant::now());
                        if test_mode {
                            let _ = app.emit("native-wake-test-detected", phrase.to_string());
                        } else {
                            stop.store(true, std::sync::atomic::Ordering::SeqCst);
                            let _ = app.emit("native-wake-detected", phrase.to_string());
                            crate::do_wake_up_main(&app, true);
                            break;
                        }
                    }
                }
            }
        }
        drop(stream);
        Ok(())
    })();

    if let Err(error) = result {
        if !stop.swap(true, std::sync::atomic::Ordering::SeqCst) {
            let _ = app.emit("native-wake-error", error);
        }
    }
    let _ = app.emit("native-wake-status", "stopped".to_string());
}
