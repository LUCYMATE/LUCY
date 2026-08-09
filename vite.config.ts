import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react()
  ],
  define: {
    'process.env': {}
  },
  optimizeDeps: {
    include: ['three', '@react-three/fiber', '@react-three/drei', 'lucide-react', '@pixiv/three-vrm']
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three': ['three'],
          'three-vrm': ['@pixiv/three-vrm'],
          'react-three': ['@react-three/fiber', '@react-three/drei'],
          'genai-vendor': ['@google/genai'],
          'tauri': ['@tauri-apps/api', '@tauri-apps/plugin-autostart', '@tauri-apps/plugin-deep-link', '@tauri-apps/plugin-fs', '@tauri-apps/plugin-shell', '@tauri-apps/plugin-http']
        }
      }
    }
  }
});
