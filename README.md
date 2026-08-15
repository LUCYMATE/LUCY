
# Soltini

> A living AI companion for your desktop.

Soltini is an AI-powered desktop companion built around a real-time
3D avatar.

Instead of interacting with an AI only through a chat window, Soltini
puts the assistant directly on the desktop so it can talk with you,
respond to commands, react visually and interact with your computer.

## ✨ Features

- 🧠 AI-powered conversation
- 🎙️ Live voice interaction
- 🧍 Real-time 3D avatar
- 🦴 VRM avatar support
- 🖥️ Desktop interaction
- ⚡ Global keyboard shortcuts
- 🚀 Automatic startup
- 🌐 HTTP and web integration
- 🔗 Deep-link support
- 💬 Context-aware interaction
- 💃 Expressive avatar actions and behaviors

## 🧩 Core Technologies

- Tauri 2
- React
- TypeScript
- Vite
- Rust
- Three.js
- React Three Fiber
- Three.js VRM
- Google Gemini / GenAI
- Zustand

## 🏗️ Architecture

```text
                  ┌────────────────────┐
                  │       Soltini      │
                  │   Desktop Client   │
                  └─────────┬──────────┘
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
       AI Core          Avatar Engine      PC Control
          │                 │                 │
          ▼                 ▼                 ▼
       GenAI API        Three.js / VRM    Tauri / Rust
          │                 │                 │
          └─────────────────┼─────────────────┘
                            ▼
                     Desktop Experience
```
