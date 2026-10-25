/**
 * The rename must LOOK like a control, not only be one.
 *
 * The operator, 2026-09-23, from a panel where he had already found the icon
 * picker and the reorder arrows: *"non riesco però a cambiare il nome
 * locale"*. The rename was there and reachable — the name text is a
 * `Pressable` — but it was drawn as plain text while every other edit control
 * in the same row is drawn as a control. Four visible affordances and one
 * invisible, and the invisible one was the one he wanted.
 *
 * The row's own docblock had said "tap the name to rename" since it was
 * written. A paragraph that describes an affordance the pixels do not
 * implement reads as verification of it, which is why this is asserted here
 * and not left to the comment.
 *
 * ## The door moved the same evening
 *
 * The tap opened `usePrompt`, and from inside one of this panel's modal hosts
 * that dialog could not be presented at all — *"blocca la ui, non si vede
 * nulla"*. The name is now an inline `TextInput` committed on blur/submit
 * (`accessory-rename-inline.spec.ts`), so the assertions below moved WITH it:
 * a signpost is only honest while it marks the control that exists. It now
 * underlines the FIELD, and it stretches, because a field the width of the
 * text already in it is not a field anyone can type in.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { ACCESSORY_NAME_EDIT_AFFORDANCE } from '../AccessoryRow.js'

const SRC = readFileSync(new URL('../AccessoryRow.tsx', import.meta.url).pathname, 'utf8')
/** Comments stripped: a rule the code does not run must not be satisfied by prose. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

describe('the affordance itself', () => {
  it('actually draws something — a border, not an empty object', () => {
    // The disarm this exists for is a style that is emptied or reduced to a
    // no-op: every assertion about "is it applied" would stay green.
    expect(ACCESSORY_NAME_EDIT_AFFORDANCE.borderBottomWidth).toBeGreaterThan(0)
    expect(ACCESSORY_NAME_EDIT_AFFORDANCE.borderStyle).toBe('dashed')
  })

  it('borrows the icon picker’s language rather than inventing a second one', () => {
    // The icon's edit treatment is `{ borderWidth: 1, borderStyle: 'dashed' }`
    // with the primary colour supplied by the caller. One row must have ONE
    // way of saying "this can be tapped".
    expect(CODE).toContain("iconEditable: { borderWidth: 1, borderStyle: 'dashed' }")
    expect(ACCESSORY_NAME_EDIT_AFFORDANCE.borderStyle).toBe('dashed')
    expect(ACCESSORY_NAME_EDIT_AFFORDANCE.borderBottomWidth).toBe(1)
  })

  it('underlines the name only, so the caption is not claimed as editable', () => {
    // A box around the identity block would say the location line can be
    // renamed too: bottom border only, and the caption sits below it.
    expect('borderWidth' in ACCESSORY_NAME_EDIT_AFFORDANCE).toBe(false)
  })

  it('spans the name column, because it underlines a FIELD now', () => {
    // `flex-start` sized the rule to the text already in the row. Under a
    // `TextInput` that is a tap target as narrow as the current name, which
    // is the affordance defeating itself.
    expect(ACCESSORY_NAME_EDIT_AFFORDANCE.alignSelf).toBe('stretch')
  })
})

describe('the row applies it, and only in edit mode', () => {
  it('applies it to the rename FIELD, which exists only in edit mode', () => {
    // The edit branch is the only place a `TextInput` appears, so "gated on
    // editing" is structural rather than a ternary — but the affordance must
    // be on that input and not on some other element of the row.
    const input = CODE.slice(CODE.indexOf('<TextInput'), CODE.indexOf('/>', CODE.indexOf('<TextInput')))
    expect(input).toContain('ACCESSORY_NAME_EDIT_AFFORDANCE')
    // …and it carries a real colour, or a dashed border of the default colour
    // is a grey line nobody reads as a control.
    expect(input).toContain('borderBottomColor: colors.primary')
    // The field IS the rename: its label is what an operator reaches for.
    expect(input).toContain("t('v2.accessoryPanel.rename', vars)")
  })

  it('leaves the VIEW row untouched — plain text, no field, no rule', () => {
    const viewBranch = CODE.slice(CODE.indexOf('if (!editing)'), CODE.indexOf('return (\n    <View style={[styles.row'))
    expect(viewBranch).not.toContain('ACCESSORY_NAME_EDIT_AFFORDANCE')
    expect(viewBranch).not.toContain('TextInput')
  })

  it('commits on blur AND on submit — a field left by tapping away still saves', () => {
    // Blur alone loses the edit of anyone who presses done; submit alone loses
    // the edit of anyone who taps the next row. The manage screen wires both
    // for the same reason.
    expect(CODE).toContain('onBlur={commit}')
    expect(CODE).toContain('onSubmitEditing={commit}')
  })

  it('never writes a name equal to the one already shown', () => {
    // Typing nothing, or retyping the hub's own name, must not stamp an
    // override into the prefs document.
    expect(CODE).toContain('if (draft !== row.label) onRename(row, draft)')
  })
})
