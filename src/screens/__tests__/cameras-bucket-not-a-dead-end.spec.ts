/**
 * Choosing an EMPTY bucket must never take the page away.
 *
 * ## The report this closes (operator, 2026-09-16)
 *
 * "e se non ci sono favorite scompare tutto, il reel deve rimanere cosi come il
 * selettore."
 *
 * Exactly right, and the cause was a one-word slip in the screen: the branch
 * that decides between "the page" and "the empty state" was reading `cameras`,
 * which had just become the BUCKET-FILTERED list. Pressing Favourites with
 * nothing starred therefore replaced the reel, the selector and the list with
 * the "no cameras configured" message — and since the selector went with it,
 * there was no way back out. A dead end, which is the exact failure the bar's
 * press-to-clear behaviour exists to prevent.
 *
 * The question "does this hub have cameras" is about the FLEET. The question
 * "does this bucket have any" is about the list inside the page. They are
 * different questions and must be asked of different values.
 *
 * Structural, on the source, because there is no render that can distinguish a
 * correct page from a correct-looking one here: both branches render a `View`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(
  fileURLToPath(new URL('../CamerasScreen.tsx', import.meta.url)),
  'utf8',
)

describe('the cameras page is not taken away by an empty bucket', () => {
  it('branches the whole page on the UNFILTERED fleet, never on the bucket', () => {
    // `allCameras` is what the hub returned; `cameras` is what the chip chose.
    expect(SOURCE).toContain('allCameras.length > 0')
    expect(SOURCE).not.toContain('cameras.length > 0 ?')
  })

  it('says something when the bucket itself is empty, inside the page', () => {
    // Not the fleet-level "no cameras" text — that would tell an operator with
    // twelve cameras that they have none.
    expect(SOURCE).toContain('v2.cameras.bucketEmpty')
  })
})
