/**
 * hero-parse — the boundary of the hub's hero model (D1023).
 *
 * The viewer reaches `hero-layout` through the untyped cap client, and the
 * schemas that validate it live in `@camstack/types` (not in the `/client`
 * entry, which a bundle may import values from). The hub already validated the
 * answer against `HeroModelSchema` / `HeroRowModelSchema`; what is checked here
 * is only what the renderer would otherwise crash on, so a malformed entry
 * becomes "no model" (a row without a control), never a thrown render.
 *
 * Types are `import type` from the published package: the shape is declared once.
 */
import type { HeroControl, HeroModel, HeroRowModel, HeroText } from '@camstack/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isHeroText(value: unknown): value is HeroText {
  return isRecord(value) && typeof value.en === 'string' && typeof value.it === 'string'
}

const CONTROL_KINDS: readonly string[] = ['action', 'toggle', 'slider', 'picker']

export function isHeroControl(value: unknown): value is HeroControl {
  return isRecord(value) && typeof value.kind === 'string' && CONTROL_KINDS.includes(value.kind)
}

function isLook(value: unknown): boolean {
  return isRecord(value) && typeof value.icon === 'string' && typeof value.tone === 'string'
}

function isScene(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string'
}

export function isHeroRowModel(value: unknown): value is HeroRowModel {
  if (!isRecord(value)) return false
  if (typeof value.deviceId !== 'number' || typeof value.name !== 'string') return false
  if (typeof value.state !== 'string' || !isLook(value.look) || !isScene(value.scene)) return false
  if (!Array.isArray(value.statusLine) || !value.statusLine.every(isHeroText)) return false
  if (value.primary !== null && !isHeroControl(value.primary)) return false
  return value.trailing === null || (isRecord(value.trailing) && isHeroText(value.trailing.text))
}

/** One entry per requested id, in order; anything unusable is `null` (no row model). */
export function parseHeroRowModels(raw: unknown): readonly (HeroRowModel | null)[] {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => (isHeroRowModel(entry) ? entry : null))
}

export function isHeroModel(value: unknown): value is HeroModel {
  if (!isRecord(value)) return false
  if (typeof value.deviceId !== 'number' || typeof value.name !== 'string') return false
  if (typeof value.state !== 'string' || !isLook(value.look) || !isScene(value.scene)) return false
  if (!isHeroText(value.title) || !Array.isArray(value.facts) || !Array.isArray(value.rows)) return false
  if (!Array.isArray(value.gated) || !isRecord(value.sideTiles)) return false
  return value.ownPower === null || isRecord(value.ownPower)
}

export function parseHeroModel(raw: unknown): HeroModel | null {
  return isHeroModel(raw) ? raw : null
}
