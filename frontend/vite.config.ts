import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // En dev, /api est relayé vers le backend: pas de CORS ni d'URL en dur dans le frontend.
    proxy: { '/api': 'http://localhost:4000' },
  },
})
