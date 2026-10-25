import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(__dirname),
  base: './',
  resolve: {
    alias: {
      'node:crypto': path.resolve(__dirname, 'src/shims/node-crypto.ts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../embed-dist'),
    emptyOutDir: true,
  },
})
