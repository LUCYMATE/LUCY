// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        // Allow the Tauri app's audio output to start without waiting for a
        // browser gesture. Microphone capture itself is owned by the native app.
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let flags = [
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
        ];
        let mut new_args = existing;
        for flag in flags {
            if !new_args.contains(flag) {
                if !new_args.is_empty() {
                    new_args.push(' ');
                }
                new_args.push_str(flag);
            }
        }
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", new_args);
    }

    lucy_lib::run()
}
