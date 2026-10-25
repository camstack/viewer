/**
 * EventsDisplayMenu — the Events page's eye: the shared `DisplayMenu` over the
 * page's own display preferences (`events-display-menu.ts`). Opened from the
 * eye at the end of the Events header row.
 */
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../../data/use-settings.js'
import { DisplayMenu } from '../ui/DisplayMenu.js'
import { eventsDisplayMenu } from './events-display-menu.js'

export const EventsDisplayMenu = memo(function EventsDisplayMenu() {
  const { t } = useTranslation()
  const { settings, setEvents } = useSettings()
  return <DisplayMenu sections={eventsDisplayMenu({ t, events: settings.events, setEvents })} testID="events-display-menu" />
})
