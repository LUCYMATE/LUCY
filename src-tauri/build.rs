use std::path::PathBuf;

fn main() {
    // Vite loads the project .env for the frontend, but Cargo does not. Forward
    // only the public verification key so option_env! can embed it in the app.
    println!("cargo:rerun-if-env-changed=VITE_ED25519_PUBLIC_KEY");
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let env_path = manifest_dir.join("..").join(".env");
    println!("cargo:rerun-if-changed={}", env_path.display());

    if std::env::var_os("VITE_ED25519_PUBLIC_KEY").is_none() {
        if let Ok(contents) = std::fs::read_to_string(&env_path) {
            for line in contents.lines() {
                let line = line.trim();
                if line.starts_with('#') { continue; }
                let Some((name, value)) = line.split_once('=') else { continue };
                if name.trim() != "VITE_ED25519_PUBLIC_KEY" { continue; }
                let value = value.trim().trim_matches(|c| c == '\"' || c == '\'');
                if !value.is_empty() {
                    println!("cargo:rustc-env=VITE_ED25519_PUBLIC_KEY={value}");
                }
                break;
            }
        }
    }

    tauri_build::build()
}
