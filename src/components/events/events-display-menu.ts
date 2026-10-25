/**
 * The Events page's eye menu, as a {@link DisplayMenuSection} list for the
 * shared `DisplayMenu`: the tile size, what the chips on a tile say, and the
 * optional details under it. Every card has its title (operator, 2026-10-23:
 * the first card had none).
 *
 * Pure — pinned by `__tests__/events-display-menu.spec.ts`.
 */
import type { DisplayMenuSection } from '../ui/display-menu.js'
import { pickValue } from '../ui/display-menu.js'
import {
  GRID_DENSITIES,
  TILE_LABEL_MODES,
  type EventsPreferences,
  type GridDensity,
  type TileLabelMode,
} from '../../store/settings-store.js'

type Translate = (key: string) => string

const DENSITY_LABEL_KEY: Readonly<Record<GridDensity, string>> = {
  compact: 'v2.events.densitySmall',
  medium: 'v2.events.densityMedium',
  large: 'v2.events.densityLarge',
}

const LABEL_MODE_KEY: Readonly<Record<TileLabelMode, string>> = {
  off: 'v2.settings.tileLabelModeOff',
  icon: 'v2.settings.tileLabelModeIcon',
  label: 'v2.settings.tileLabelModeLabel',
}

export type EventsDisplayPreferences = Pick<
  EventsPreferences,
  'gridDensity' | 'tileLabelMode' | 'tileDetailCamera' | 'tileDetailZone'
>

export interface EventsDisplayMenuInput {
  readonly t: Translate
  readonly events: EventsDisplayPreferences
  readonly setEvents: <K extends keyof EventsPreferences>(key: K, value: EventsPreferences[K]) => void
}

export function eventsDisplayMenu({ t, events, setEvents }: EventsDisplayMenuInput): readonly DisplayMenuSection[] {
  return [
    {
      id: 'tile-size',
      title: t('v2.library.tileSize'),
      items: [
        {
          kind: 'choice',
          id: 'density',
          options: GRID_DENSITIES.map((d) => ({ value: d, label: t(DENSITY_LABEL_KEY[d]) })),
          value: events.gridDensity,
          onChange: (v) => {
            const density = pickValue(GRID_DENSITIES, v)
            if (density !== undefined) setEvents('gridDensity', density)
          },
        },
      ],
    },
    {
      id: 'tile-labels',
      title: t('v2.settings.tileLabelMode'),
      items: [
        {
          kind: 'choice',
          id: 'label-mode',
          options: TILE_LABEL_MODES.map((m) => ({ value: m, label: t(LABEL_MODE_KEY[m]) })),
          value: events.tileLabelMode,
          onChange: (v) => {
            const mode = pickValue(TILE_LABEL_MODES, v)
            if (mode !== undefined) setEvents('tileLabelMode', mode)
          },
        },
      ],
    },
    {
      id: 'under-tile',
      title: t('v2.settings.tileDetailsSection'),
      items: [
        {
          kind: 'toggle',
          id: 'camera',
          label: t('v2.library.showCamera'),
          value: events.tileDetailCamera,
          onChange: (v) => setEvents('tileDetailCamera', v),
        },
        {
          kind: 'toggle',
          id: 'zone',
          label: t('v2.library.showZone'),
          value: events.tileDetailZone,
          onChange: (v) => setEvents('tileDetailZone', v),
        },
      ],
    },
  ]
}
