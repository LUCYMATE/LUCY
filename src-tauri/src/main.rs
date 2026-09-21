// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        // Auto-enable and allow microphone by default without annoying browser pop-ups
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let flags = "--auto-accept-camera-and-microphone-capture --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
        let new_args = if existing.is_empty() {
            flags.to_string()
        } else if !existing.contains("--auto-accept-camera-and-microphone-capture") {
            format!("{} {}", existing, flags)
        } else {
            existing
        };
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", new_args);
    }

    lucy_lib::run()
}
