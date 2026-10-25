import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

const root = resolve(__dirname)
const outDir = resolve(__dirname, '../embed-ota-dist')

function inlineEmbedAssets(): Plugin {
  return {
    name: 'camstack-inline-ota-embed',
    closeBundle() {
      const indexPath = resolve(outDir, 'index.html')
      let html = readFileSync(indexPath, 'utf8')

      html = html.replace(
        /<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/,
        (_tag, assetPath: string) => {
          const source = readFileSync(resolve(outDir, assetPath), 'utf8')
            .trim()
            .replace(/<\/script/gi, '<\\/script')
          return `<script type="module">${source}</script>`
        },
      )
      html = html.replace(
        /<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/,
        (_tag, assetPath: string) =>
          `<style>${readFileSync(resolve(outDir, assetPath), 'utf8').trim()}</style>`,
      )
      if (html.includes('="./assets/')) {
        throw new Error('OTA embed still references external build assets')
      }

      writeFileSync(resolve(outDir, 'camstack-embed.html'), `${html.trimEnd()}\n`)
    },
  }
}

export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwindcss(), inlineEmbedAssets()],
  resolve: {
    alias: {
      'node:crypto': resolve(__dirname, 'src/shims/node-crypto.ts'),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
