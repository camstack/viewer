/**
 * HeroIconGroup — the model-drawn controls of a row that are plain presses (a
 * power toggle, an action) drawn as icon-only segments of one `IconButtonGroup`
 * (an automation's run · enabled, a pet fountain's pump), each carrying its old
 * label as `accessibilityLabel`. Steppers, values and pickers are not presses and
 * stay with `HeroControlView`.
 */
import React from 'react'
import type { HeroControl } from '@dominevo/types'
import { IconButton } from '../components/camera/accessory-controls/control-atoms.js'
import { IconButtonGroup } from '../components/ui/IconButtonGroup.js'
import { Play, Power, Square, type LucideIcon } from '../lib/icons.js'
import { controlView, heroText, type HeroLocale } from './hero-view.js'
import type { HeroCaller } from './use-hero.js'

/** The glyph of a model action: a stop is a square, every other press a play. */
export function actionGlyph(actionId: string): LucideIcon {
  return actionId.endsWith('.stop') ? Square : Play
}

/** Is this control a press the icon group can draw? */
export function isGroupablePress(control: HeroControl): boolean {
  return control.kind === 'toggle' || control.kind === 'action'
}

export interface HeroIconSegmentsProps {
  readonly controls: readonly HeroControl[]
  readonly locale: HeroLocale
  readonly caller: HeroCaller
  readonly online: boolean
}

/** The segments alone: render them under an `IconButtonGroup`. */
export function HeroIconSegments({ controls, locale, caller, online }: HeroIconSegmentsProps): React.JSX.Element {
  const disabled = !online || caller.pending
  return (
    <>
      {controls.map((control) => {
        const view = controlView(control)
        if (view === null) return null
        if (view.kind === 'power') {
          return (
            <IconButton
              key={view.id}
              icon={Power}
              label={heroText(view.press.label, locale)}
              active={view.look === 'on'}
              disabled={disabled}
              haptic="action"
              onPress={() => void caller.runAction(view.press)}
            />
          )
        }
        if (view.kind === 'action') {
          return (
            <IconButton
              key={view.action.id}
              icon={actionGlyph(view.action.id)}
              label={heroText(view.action.label, locale)}
              disabled={disabled}
              haptic="action"
              onPress={() => void caller.runAction(view.action)}
            />
          )
        }
        return null
      })}
    </>
  )
}

export function HeroIconGroup(props: HeroIconSegmentsProps): React.JSX.Element {
  return (
    <IconButtonGroup>
      <HeroIconSegments {...props} />
    </IconButtonGroup>
  )
}
