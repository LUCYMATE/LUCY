// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "windows")]
    {
        // Match Soltini's WebView2 media behavior: allow the app's local
        // SpeechRecognition/getUserMedia wake listener to obtain microphone
        // access while Lucy is transparent and asleep, when a permission UI
        // could not be presented interactively. Also allow app audio playback.
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
