// Soltini Auto Scroll - Content Script

let isAutoScrollEnabled = true; 

function checkAndScroll() {
    if (!isAutoScrollEnabled) return;

    // Grab all video elements on the page
    const videos = Array.from(document.querySelectorAll('video'));
    
    // Find the currently playing/visible video
    const currentVideo = videos.find(v => {
        const rect = v.getBoundingClientRect();
        // Check if a significant portion of the video is visible and playing
        return rect.top >= -rect.height / 2 && 
               rect.bottom <= window.innerHeight + rect.height / 2 && 
               v.readyState >= 2 && 
               !v.paused;
    });

    if (currentVideo) {
        // Detect if video has reached the end or just looped
        // Platforms like YT Shorts use loop=true, so currentTime jumps back to 0
        if (currentVideo.currentTime >= currentVideo.duration - 0.2) {
            triggerScroll();
            // Prevent multiple triggers by disabling briefly
            isAutoScrollEnabled = false;
            setTimeout(() => { isAutoScrollEnabled = true; }, 2000);
        } else {
            // Check for sudden loops (time jumps backward significantly)
            if (currentVideo.lastTime && currentVideo.currentTime < currentVideo.lastTime - 1.0) {
                 triggerScroll();
                 isAutoScrollEnabled = false;
                 setTimeout(() => { isAutoScrollEnabled = true; }, 2000);
            }
        }
        currentVideo.lastTime = currentVideo.currentTime;
    }
}

function triggerScroll() {
    console.log("[Soltini] Video ended! Auto-scrolling...");
    
    // Fallback 1: Simulated Keyboard ArrowDown
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        code: 'ArrowDown',
        keyCode: 40,
        which: 40,
        bubbles: true
    }));

    // Fallback 2: DOM Scroll injection (often intercepted by modern SPAs)
    window.scrollBy({
        top: window.innerHeight,
        behavior: 'smooth'
    });
}

// Check the video state 10 times a second
setInterval(checkAndScroll, 100);
console.log("[Soltini Auto Scroll] Loaded and active.");
