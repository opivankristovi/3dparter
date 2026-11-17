import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  worker: { format: 'es' },
  // The OpenCascade build ships its own .wasm; pre-bundling it breaks the wasm URL lookup.
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
})
