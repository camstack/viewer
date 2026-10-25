/**
 * Refuse a haptic call that bypasses the policy.
 *
 * Press feedback has ONE authority — the user's "Vibration" switch, read in
 * `src/lib/haptics-policy.ts` and applied by `src/lib/haptics.ts`. A component
 * that reaches past those (straight to `expo-haptics`, or straight to the
 * `fireHaptic` driver) vibrates a device whose owner switched vibration off,
 * and no amount of documentation stops the next author from doing it because
 * both imports look perfectly reasonable in isolation.
 *
 * So the layering is checked, not merely written down:
 *
 *   components  →  lib/haptics.ts        hapticTap / hapticAction / hapticResult
 *                  lib/haptics-policy.ts the decision (pure)
 *                  lib/haptics-driver.ts the ONLY `expo-haptics` import
 *
 * This is a guard rather than a comment because the failure is INVISIBLE to the
 * person who causes it: their phone buzzes correctly, and only a user who
 * turned the setting off ever finds out.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const ROOT = process.cwd()

/** The single translator into `expo-haptics`. */
const DRIVER = path.join(ROOT, 'src/lib/haptics-driver.ts')

/**
 * Modules allowed to call the driver directly, with the reason each is exempt:
 *  • haptics.ts        — the press-feedback policy applier (the point of it).
 *  • use-event-haptics — PASSIVE event pulses, gated by their own master switch
 *                        (`HapticsConfig.enabled`) plus a rate limit. A
 *                        different function with a different authority, not a
 *                        bypass of this one.
 */
const DRIVER_CALLERS = [
  path.join(ROOT, 'src/lib/haptics.ts'),
  path.join(ROOT, 'src/data/use-event-haptics.ts'),
]

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'app'))]

const nativeOffenders = []
const driverOffenders = []

for (const file of files) {
  const resolved = path.resolve(file)
  const src = fs.readFileSync(file, 'utf-8')
  const isDriver = resolved === path.resolve(DRIVER)
  const mayCallDriver =
    isDriver || DRIVER_CALLERS.some((allowed) => path.resolve(allowed) === resolved)

  for (const [index, line] of src.split('\n').entries()) {
    const at = `${path.relative(ROOT, file)}:${index + 1}`
    // Prose naming these modules is how the layering gets explained — only
    // CODE is an offence.
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue
    // 1 — `expo-haptics` itself: driver only (static OR dynamic import).
    if (!isDriver && /['"]expo-haptics['"]/.test(line)) {
      nativeOffenders.push(at)
    }
    // 2 — the driver's `fireHaptic`: policy appliers only. Tests are exempt —
    //     asserting on the driver is exactly how the wiring gets proven.
    if (!mayCallDriver && !/__tests__/.test(file) && /\bfireHaptic\b/.test(line)) {
      driverOffenders.push(at)
    }
  }
}

let failed = false

if (nativeOffenders.length > 0) {
  failed = true
  console.error(
    `${nativeOffenders.length} direct import(s) of expo-haptics — only src/lib/haptics-driver.ts may touch it:\n  ${nativeOffenders.join('\n  ')}`,
  )
}

if (driverOffenders.length > 0) {
  failed = true
  console.error(
    `${driverOffenders.length} direct fireHaptic call(s) bypassing the user's Vibration setting — call hapticTap/hapticAction/hapticResult from src/lib/haptics.ts instead:\n  ${driverOffenders.join('\n  ')}`,
  )
}

if (failed) process.exit(1)
console.log('haptics wiring ok — every press routes through the policy')
