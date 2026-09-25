import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  // Keep React-based dependencies (including qrcode.react) on the same React
  // instance as the renderer. Duplicate React instances break hook dispatch.
  resolve: {
    dedupe: ['react', 'react-dom']
  },
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
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'three-vendor': ['three', '@react-three/fiber', '@react-three/drei', '@pixiv/three-vrm'],
          'genai-vendor': ['@google/genai']
        }
      }
    }
  }
});
