/**
 * The viewer never writes the hub's linked-device set.
 *
 * Operator, 2026-09-22: "assicurati che ovunque non permettiamo di cambiare i
 * linked devices del server". The set is admin-ui's; the viewer's "+" is a
 * LOCAL addition (`accessories/accessory-prefs.ts`). This guard reads every
 * source file under `src/` and `app/` with comments stripped, so a docblock
 * may still NAME the old path while no code can take it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/__tests__/.test(full)) out.push(full)
  }
  return out
}

function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const FILES = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'app'))]

describe('the hub’s link set is read, never written, from this app', () => {
  it('no code names the linked-ids config key or the settings patch that carried it', () => {
    const offenders = FILES.filter((file) => {
      const src = code(file)
      return src.includes('_linkedDeviceIds') || src.includes('applyDeviceSettingsPatch')
    }).map((file) => file.slice(ROOT.length + 1))
    expect(offenders).toEqual([])
  })

  it('no code calls a link-editing procedure', () => {
    const offenders = FILES.filter((file) => {
      const src = code(file)
      return /setLinkedDevices|setLinkDeviceId|linkDevice\(|unlinkDevice\(/.test(src)
    }).map((file) => file.slice(ROOT.length + 1))
    expect(offenders).toEqual([])
  })
})
