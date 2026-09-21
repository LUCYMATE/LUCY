// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        // Enable autoplay without requiring user gesture
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let flags = "--autoplay-policy=no-user-gesture-required";
        let new_args = if existing.is_empty() {
            flags.to_string()
        } else if !existing.contains("--autoplay-policy=no-user-gesture-required") {
            format!("{} {}", existing, flags)
        } else {
            existing
        };
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", new_args);
    }

    lucy_lib::run()
}
