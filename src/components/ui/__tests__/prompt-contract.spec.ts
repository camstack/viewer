import { describe, it, expect } from 'vitest'

/**
 * The prompt's answer shape, asserted as a contract rather than through the
 * renderer: `null` means the operator CANCELLED, `''` means they submitted an
 * empty field on purpose. Collapsing the two would make "I have nothing to add"
 * indistinguishable from "I backed out".
 *
 * Its consumer is the per-track debug note (`TrackFlagButtons.askForNote`),
 * which branches on exactly that difference: a cancel leaves the stored note
 * untouched, while an empty submission clears it. The flow that exercises the
 * whole thing against a hub lives in
 * `components/events/track/__tests__/track-debug-note.spec.ts`; this file pins
 * the two-valued answer the flow reads.
 */
type PromptAnswer = string | null

function applyNote(previous: string, answer: PromptAnswer): string {
  if (answer === null) return previous
  return answer.trim()
}

describe('prompt answer semantics — the per-track debug note reads these', () => {
  it('keeps the previous note when the operator cancels', () => {
    expect(applyNote('timeline jumps on 618', null)).toBe('timeline jumps on 618')
  })

  it('clears the note when the operator submits an empty field', () => {
    expect(applyNote('timeline jumps on 618', '')).toBe('')
  })

  it('stores a trimmed note', () => {
    expect(applyNote('', '  scrub is laggy on 3836  ')).toBe('scrub is laggy on 3836')
  })

  it('treats whitespace-only as deliberately empty, not as a cancel', () => {
    expect(applyNote('old', '   ')).toBe('')
  })
})
