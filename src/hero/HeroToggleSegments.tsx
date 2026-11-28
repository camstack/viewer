/**
 * HeroToggleSegments — the model's power toggles of a row (a pet fountain's pump)
 * as icon segments, for a row whose legacy shortcut group would otherwise hide
 * them. Render under an `IconButtonGroup`; nothing when the model has no toggle.
 */
import React from 'react'
import type { HeroControl } from '@dominevo/types'
import { useTranslation } from 'react-i18next'
import { heroLocale } from './hero-view.js'
import { HeroIconSegments } from './HeroIconGroup.js'
import { useHeroCaller } from './use-hero.js'

export interface HeroToggleSegmentsProps {
  readonly deviceId: number
  readonly online: boolean
  readonly controls: readonly HeroControl[]
}

export function HeroToggleSegments({ deviceId, online, controls }: HeroToggleSegmentsProps): React.JSX.Element | null {
  const { i18n } = useTranslation()
  const caller = useHeroCaller(deviceId)
  const toggles = controls.filter((control) => control.kind === 'toggle')
  if (toggles.length === 0) return null
  return <HeroIconSegments controls={toggles} locale={heroLocale(i18n.language)} caller={caller} online={online} />
}
