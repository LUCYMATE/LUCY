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
        manualChunks(id) {
          const modulePath = id.replace(/\\/g, '/');
          if (!modulePath.includes('/node_modules/')) return;

          // Keep shared state outside the 3D renderer chunk. Both renderer and
          // secondary-window stores use Zustand, but only the main window needs Three.
          if (/\/node_modules\/zustand\//.test(modulePath)) {
            return 'state-vendor';
          }
          if (/\/node_modules\/(react|react-dom|react-reconciler|scheduler|use-sync-external-store)\//.test(modulePath)) {
            return 'react-vendor';
          }
          if (modulePath.includes('/node_modules/@google/genai/')) {
            return 'genai-vendor';
          }
        }
      }
    }
  }
});
