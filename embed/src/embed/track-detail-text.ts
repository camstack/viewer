/**
 * track-detail-text — the words the `?mode=track` page builds itself.
 *
 * Same rule as the events tile's age: the page has no i18n of its own, so the
 * two shipped languages live in one small table keyed by the page locale
 * (`lang=` / browser language, `resolveEventsLocale`). The flag badges come from
 * `events-labels` (host words win there).
 */
import type { EventsLocale } from './events-config'

export interface TrackDetailText {
  readonly camera: string
  readonly zone: string
  readonly time: string
  readonly loading: string
  readonly noCamera: string
  readonly notFound: string
  readonly loadFailed: string
  readonly noTrack: string
  readonly configError: string
}

const EN: TrackDetailText = {
  camera: 'Camera',
  zone: 'Zone',
  time: 'Time',
  loading: 'Loading',
  noCamera: 'The track link names no camera (device=)',
  notFound: 'Track not found',
  loadFailed: 'Failed to load the track',
  noTrack: 'The track link names no track (id=)',
  configError: 'Track embed config error',
}

const IT: TrackDetailText = {
  camera: 'Camera',
  zone: 'Zona',
  time: 'Ora',
  loading: 'Caricamento',
  noCamera: 'Il link della traccia non indica la camera (device=)',
  notFound: 'Traccia non trovata',
  loadFailed: 'Impossibile caricare la traccia',
  noTrack: 'Il link non indica nessuna traccia (id=)',
  configError: 'Errore di configurazione dell’embed traccia',
}

export function trackDetailText(locale: EventsLocale): TrackDetailText {
  return locale === 'it' ? IT : EN
}
