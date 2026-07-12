#![windows_subsystem = "windows"]

use global_hotkey::hotkey::{Code, HotKey, Modifiers};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager};
use std::process::Command;
use std::time::Duration;
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE, WM_QUIT,
};

const MUTEX_NAME: &str = "SoltiniAppSingletonMutex";

fn get_soltini_path() -> std::path::PathBuf {
    let exe = std::env::current_exe().expect("failed to get current exe path");
    let dir = exe.parent().expect("failed to get parent directory");
    dir.join("soltini.exe")
}

fn is_soltini_running() -> bool {
    unsafe {
        let name: Vec<u16> = MUTEX_NAME
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let handle = CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr());
        if handle.is_null() {
            return false;
        }
        let running = GetLastError() == ERROR_ALREADY_EXISTS;
        let _ = CloseHandle(handle);
        running
    }
}

fn register_hotkeys(manager: &GlobalHotKeyManager) {
    let hotkeys = vec![
        HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyX),
        HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS),
        HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM),
    ];
    for hk in &hotkeys {
        let _ = manager.register(*hk);
    }
}

fn unregister_hotkeys(manager: &GlobalHotKeyManager) {
    let hotkeys = vec![
        HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyX),
        HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyS),
        HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM),
    ];
    for hk in &hotkeys {
        let _ = manager.unregister(*hk);
    }
}

fn main() {
    let manager = GlobalHotKeyManager::new().expect("failed to create hotkey manager");
    let receiver = GlobalHotKeyEvent::receiver();
    let soltini_path = get_soltini_path();

    let mut was_running = is_soltini_running();
    let mut shortcuts_registered = false;

    if !was_running {
        register_hotkeys(&manager);
        shortcuts_registered = true;
    }

    loop {
        // Drain Windows messages so global-hotkey's hidden window receives WM_HOTKEY
        unsafe {
            let mut msg = std::mem::zeroed::<MSG>();
            while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_QUIT {
                    return;
                }
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }

        // Check for hotkey events from global-hotkey channel
        while let Ok(_event) = receiver.try_recv() {
            if shortcuts_registered {
                unregister_hotkeys(&manager);
                shortcuts_registered = false;
                let _ = Command::new(&soltini_path).spawn();
            }
        }

        // Monitor soltini running state
        let now_running = is_soltini_running();
        if now_running && !was_running && shortcuts_registered {
            unregister_hotkeys(&manager);
            shortcuts_registered = false;
        } else if !now_running && was_running && !shortcuts_registered {
            register_hotkeys(&manager);
            shortcuts_registered = true;
        }
        was_running = now_running;

        std::thread::sleep(Duration::from_millis(500));
    }
}
