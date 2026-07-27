use std::fs;

fn main() {
    let path = "src-tauri/src/lib.rs";
    let contents = fs::read_to_string(path).unwrap();

    let old_capture = "
#[tauri::command]
fn capture_screen() -> Result<serde_json::Value, String> {
    let screens = Screen::all().map_err(|e| format!(\"Failed to get screens: {}\", e))?;
    let screen = screens.first().ok_or(\"No screen found\")?;

    let mut img = screen
        .capture()
        .map_err(|e| format!(\"Capture failed: {}\", e))?;

    let width = img.width();
    let height = img.height();
    let grid_spacing = 100;

    // Draw 100px grid overlay
    for x in (0..width).step_by(grid_spacing as usize) {
        for y in 0..height {
            let pixel = img.get_pixel_mut(x, y);
            // Subtle Red for vertical
            pixel[0] = 255;
            pixel[1] = pixel[1].saturating_sub(50);
            pixel[2] = pixel[2].saturating_sub(50);
        }
    }
    for y in (0..height).step_by(grid_spacing as usize) {
        for x in 0..width {
            let pixel = img.get_pixel_mut(x, y);
            // Subtle Blue for horizontal
            pixel[0] = pixel[0].saturating_sub(50);
            pixel[1] = pixel[1].saturating_sub(50);
            pixel[2] = 255;
        }
    }

    let mut bytes = Vec::new();
    let dynamic_img = screenshots::image::DynamicImage::ImageRgba8(img);
    dynamic_img
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            screenshots::image::ImageFormat::Jpeg,
        )
        .map_err(|e| format!(\"JPEG conversion failed: {}\", e))?;

    let base64_image = STANDARD.encode(&bytes);

    Ok(serde_json::json!({
        \"base64\": base64_image,
        \"width\": screen.display_info.width,
        \"height\": screen.display_info.height
    }))
}
";

    let new_capture = "
#[tauri::command]
fn capture_screen() -> Result<serde_json::Value, String> {
    let screens = Screen::all().map_err(|e| format!(\"Failed to get screens: {}\", e))?;
    let screen = screens.first().ok_or(\"No screen found\")?;

    let img = screen
        .capture()
        .map_err(|e| format!(\"Capture failed: {}\", e))?;

    let orig_width = img.width();
    let orig_height = img.height();
    
    let max_width = 1920.0;
    let scale_factor = if orig_width as f32 > max_width {
        orig_width as f32 / max_width
    } else {
        1.0
    };

    let mut dynamic_img = screenshots::image::DynamicImage::ImageRgba8(img);
    if scale_factor > 1.0 {
        let new_width = (orig_width as f32 / scale_factor).round() as u32;
        let new_height = (orig_height as f32 / scale_factor).round() as u32;
        dynamic_img = dynamic_img.resize_exact(new_width, new_height, screenshots::image::imageops::FilterType::Triangle);
    }
    
    let mut final_img = dynamic_img.to_rgba8();
    let width = final_img.width();
    let height = final_img.height();
    let grid_spacing = 100;

    for x in (0..width).step_by(grid_spacing as usize) {
        for y in 0..height {
            let pixel = final_img.get_pixel_mut(x, y);
            // Blend red nicely for thinner look
            pixel[0] = pixel[0].saturating_add((255_u16.saturating_sub(pixel[0] as u16) / 2) as u8);
            pixel[1] = pixel[1].saturating_sub(40);
            pixel[2] = pixel[2].saturating_sub(40);
        }
    }
    for y in (0..height).step_by(grid_spacing as usize) {
        for x in 0..width {
            let pixel = final_img.get_pixel_mut(x, y);
            // Blend blue nicely
            pixel[0] = pixel[0].saturating_sub(40);
            pixel[1] = pixel[1].saturating_sub(40);
            pixel[2] = pixel[2].saturating_add((255_u16.saturating_sub(pixel[2] as u16) / 2) as u8);
        }
    }

    let mut bytes = Vec::new();
    let dynamic_final = screenshots::image::DynamicImage::ImageRgba8(final_img);
    dynamic_final
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            screenshots::image::ImageFormat::Jpeg,
        )
        .map_err(|e| format!(\"JPEG conversion failed: {}\", e))?;

    let base64_image = STANDARD.encode(&bytes);

    Ok(serde_json::json!({
        \"base64\": base64_image,
        \"width\": width,
        \"height\": height,
        \"scale_factor\": scale_factor
    }))
}
";

    // Remove first newline from raw strings
    let old_capture = &old_capture[1..];
    let new_capture = &new_capture[1..];

    if let Some(start) = contents.find(\"#[tauri::command]\\nfn capture_screen()\") {
        let mut end = contents[start..].find(\"}\\n\\n#[tauri::command]\").unwrap();
        end += start + 1; // point to the closing brace
        let mut new_contents = String::new();
        new_contents.push_str(&contents[..start]);
        new_contents.push_str(new_capture);
        new_contents.push_str(&contents[end..]);
        fs::write(path, new_contents).unwrap();
        println!(\"Replaced!\");
    } else {
        println!(\"Could not find capture_screen in lib.rs\");
    }
}
