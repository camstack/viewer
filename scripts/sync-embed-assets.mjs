import { cp, copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const webBuild = resolve(root, 'embed-dist')
const otaBuild = resolve(root, 'embed-ota-dist', 'camstack-embed.html')
const webTarget = resolve(root, 'public', 'embed')
const otaTarget = resolve(root, 'assets', 'embed', 'camstack-embed.html')

await rm(webTarget, { recursive: true, force: true })
await mkdir(webTarget, { recursive: true })
await cp(webBuild, webTarget, { recursive: true })
await mkdir(resolve(root, 'assets', 'embed'), { recursive: true })
await copyFile(otaBuild, otaTarget)

console.log('Synced embed → public/embed and assets/embed/camstack-embed.html')
