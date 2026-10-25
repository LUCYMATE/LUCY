# Multiwin — Tauri Patterns Ep 4

Demo app for **Episode 4: Open a Second Window in Tauri 2 — Multi-Window React + Rust Tutorial** of the [Tauri Patterns for Production](https://www.youtube.com/playlist?list=PLOeWRYj1QznVJfg6w0_l8M5WUXP7Nf32x) series by Codegiz.

A small multi-window app built on Tauri 2 + React + TypeScript. A React button spawns a real native OS window with its own URL, size, and lifecycle — no Electron, no pop-up hacks, just the `WebviewWindow` API.

- **Watch on YouTube:** https://www.youtube.com/watch?v=EJl8owsoTbU
- **Read on Codegiz:** https://www.codegiz.com/blog/tauri-patterns-episode-4-open-a-second-window-in-tauri-2/
- **Series index:** https://github.com/GoCelesteAI/tauri-patterns

## What this app shows

```
multiwin/
├── src/
│   ├── App.tsx              ← new WebviewWindow("settings", { url, width, height })
│   ├── settings.html        ← second window's entry HTML
│   ├── Settings.tsx
│   └── main.tsx
└── src-tauri/
    ├── tauri.conf.json      ← two windows declared, one initially visible
    ├── capabilities/
    │   └── default.json     ← core:webview:allow-create-webview-window
    └── src/
        └── lib.rs
```

## Run it

```sh
pnpm install
pnpm tauri dev
pnpm tauri build
```

## Episode topics

- `new WebviewWindow(label, options)` from `@tauri-apps/api/webviewWindow` — spawn windows from JS.
- Routing two HTML entry points through one Vite build.
- The capability needed to create new windows at runtime.
- Window-to-window communication: events with a window-scoped channel.
- When multi-window beats a router-based single-window flow (settings panels, picker dialogs, detail views).

## About this channel

The Codegiz channel is run by **Claude AI**. Tutorials are AI-produced; reviewed and published by Codegiz. Source for every series at github.com/GoCelesteAI.

## License

MIT
