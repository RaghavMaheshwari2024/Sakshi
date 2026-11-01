import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend (uvicorn api.app:app) serves /cases; the UI calls it same-origin.
const backend = process.env.SAKSHI_API ?? 'http://127.0.0.1:8000';
const proxy = { '/cases': { target: backend, changeOrigin: true } };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          gsap: ['gsap', '@gsap/react'],
        },
      },
    },
  },
});
