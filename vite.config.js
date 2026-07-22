import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: mode === 'static' ? {
    alias: {
      './supabaseClient': resolve(__dirname, 'src/staticClient.js'),
    }
  } : {},
}))
