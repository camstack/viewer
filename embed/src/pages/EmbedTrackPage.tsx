/**
 * EmbedTrackPage — `?mode=track`: ONE track in isolation, for a host that
 * opens it on a `trackClick` (Home Assistant's card shows it in a dialog).
 *
 * Auth and transport are the events embed's, unchanged: the same three config
 * sources (injected global, `embed-ready` handshake, URL + `#t=` or relay), the
 * same `createSystem`, the same bearer-fetched media (`use-authed-image`). A
 * relayed page carries no credential at all. Which track is in the query
 * (`events-track-detail.ts`).
 *
 * Read-only by design: no flag toggles, no face assignment, no seek. Those are
 * operator actions of the app's detail view; an iframe in someone else's
 * dashboard shows what happened and where.
 */
import { resolveEventKindIcon } from '@camstack/ui-library'
import { createSystem, type System } from '@camstack/sdk'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { PaletteBridge } from '../embed/PaletteBridge'
import { parseEventsConfig, type EventsConfig } from '../embed/events-config'
import { accentForClass, formatEventTime, resolvePalette, type EventsPalette } from '../embed/events-theme'
import { readEventsUrlConfig } from '../embed/events-url-config'
import { useEmbedConfig } from '../embed/host-bridge'
import {
  formatTrackSpan,
  parseTrackDetailQuery,
  selectTrackDetailMedia,
  type TrackDetailMedia,
  type TrackDetailMediaSet,
  type TrackDetailQuery,
} from '../embed/events-track-detail'
import { useAuthedImage } from '../embed/use-authed-image'
import { resolveEventsLabels } from '../../../shared/events/events-labels'
import { buildTrackThumbUrl } from '../../../shared/events/events-media-url'
import { usePaletteView } from '../../../shared/palette'
import {
  buildKindLabels,
  EMPTY_KIND_LABELS,
  iconIdForClass,
} from '../../../shared/events/events-taxonomy'
import {
  isAudioSourceRow,
  resolveRowTitle,
  toEventsTrackRow,
  type EventsTrackRow,
} from '../../../shared/events/events-track-row'

/** Hero edge requested from the plane; it clamps to 320. */
const HERO_THUMB_PX = 320

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly row: EventsTrackRow; readonly media: TrackDetailMediaSet }

/** Read the track and its media manifest through the embed's own system. */
async function loadTrack(
  system: System,
  query: TrackDetailQuery,
  deviceName: string | undefined,
  serverUrl: string,
): Promise<LoadState> {
  if (query.deviceId === null) {
    return { status: 'error', message: 'The track link names no camera (device=)' }
  }
  const names = new Map<number, string>(deviceName !== undefined ? [[query.deviceId, deviceName]] : [])
  const [rawTrack, rawMedia] = await Promise.all([
    system.trpcClient.pipelineAnalytics.getTrack.query({
      deviceId: query.deviceId,
      trackId: query.trackId,
    }),
    system.trpcClient.pipelineAnalytics.listTrackMedia
      .query({ deviceId: query.deviceId, trackId: query.trackId })
      .catch(() => []),
  ])
  const row = toEventsTrackRow(rawTrack, names)
  if (row === null) return { status: 'error', message: 'Track not found' }
  return { status: 'ready', row, media: selectTrackDetailMedia(rawMedia, serverUrl) }
}

interface ImgProps {
  readonly url: string | null
  readonly token: string | undefined
  readonly palette: EventsPalette
  readonly style: CSSProperties
  readonly alt: string
}

function AuthedImg({ url, token, palette, style, alt }: ImgProps) {
  const state = useAuthedImage(url, token)
  const frame: CSSProperties = {
    background: palette.skeleton,
    border: `1px solid ${palette.border}`,
    borderRadius: 10,
    overflow: 'hidden',
    boxSizing: 'border-box',
    ...style,
  }
  if (state.status !== 'ready') return <div style={frame} role="img" aria-label={alt} />
  return (
    <div style={frame}>
      <img
        src={state.src}
        alt={alt}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </div>
  )
}

interface BodyProps {
  readonly row: EventsTrackRow
  readonly media: TrackDetailMediaSet
  readonly config: EventsConfig
  readonly palette: EventsPalette
}

export function TrackDetail({ row, media, config, palette }: BodyProps) {
  const kindPalette = usePaletteView()
  const labels = useMemo(() => resolveEventsLabels(config.labels), [config.labels])
  const kindLabels = useMemo(
    () => (Object.keys(config.kindLabels).length > 0 ? buildKindLabels(config.kindLabels) : EMPTY_KIND_LABELS),
    [config.kindLabels],
  )
  const title = resolveRowTitle(row, kindLabels)
  const accent = accentForClass(row.className, isAudioSourceRow(row), kindPalette)
  const Glyph = resolveEventKindIcon(iconIdForClass(row.className, new Map(), isAudioSourceRow(row)))
  const [selected, setSelected] = useState<string | null>(null)
  const heroUrl =
    media.stills.find((m) => m.key === selected)?.url.replace(/&size=\d+/, `&size=${HERO_THUMB_PX}`) ??
    buildTrackThumbUrl(config.serverUrl, row.trackId, HERO_THUMB_PX)
  const zones = row.zoneNames.length > 0 ? row.zoneNames : []
  const badges: string[] = []
  if (row.active) badges.push(labels.active)
  if (row.favourited === true) badges.push(labels.favourite)
  if (row.debug === true) badges.push(labels.debug)
  if (row.markForTrain === true) badges.push(labels.train)
  const chip: CSSProperties = {
    background: palette.chip,
    color: palette.text,
    borderRadius: 999,
    padding: '2px 10px',
    fontSize: 12,
    lineHeight: '18px',
  }
  return (
    <main
      data-testid="track-detail"
      style={{
        minHeight: '100%',
        boxSizing: 'border-box',
        background: palette.background,
        color: palette.text,
        fontFamily: 'system-ui, sans-serif',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <AuthedImg
        url={heroUrl}
        token={config.token}
        palette={palette}
        alt={title.text}
        style={{ width: '100%', aspectRatio: '4 / 3' }}
      />
      {media.clip !== null && config.token === undefined && (
        // A relayed page holds no credential, so a plain element can stream the
        // clip; a bearer-only page cannot attach a header to <video>, and the
        // clip is simply not offered rather than offered broken.
        <video
          data-testid="track-clip"
          src={media.clip.url}
          controls
          preload="none"
          style={{ width: '100%', borderRadius: 10, background: palette.skeleton }}
        />
      )}
      {media.stills.length > 1 && (
        <div
          data-testid="track-strip"
          style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}
        >
          {media.stills.map((m: TrackDetailMedia) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setSelected(m.key)}
              aria-label={m.kind}
              style={{
                all: 'unset',
                cursor: 'pointer',
                flex: '0 0 auto',
                outline: m.key === selected ? `2px solid ${accent}` : 'none',
                borderRadius: 10,
              }}
            >
              <AuthedImg
                url={m.url}
                token={config.token}
                palette={palette}
                alt={m.kind}
                style={{ width: 84, height: 84 }}
              />
            </button>
          ))}
        </div>
      )}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Glyph size={20} color={accent} aria-hidden />
          <h1 style={{ fontSize: 18, lineHeight: '24px', margin: 0, fontWeight: 600 }}>
            {title.fullText ?? title.text}
          </h1>
        </div>
        {badges.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {badges.map((b) => (
              <span key={b} style={chip}>
                {b}
              </span>
            ))}
          </div>
        )}
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13 }}>
          <dt style={{ color: palette.textMuted }}>Camera</dt>
          <dd style={{ margin: 0 }}>{row.cameraName}</dd>
          {zones.length > 0 && (
            <>
              <dt style={{ color: palette.textMuted }}>Zone</dt>
              <dd style={{ margin: 0 }}>{zones.join(', ')}</dd>
            </>
          )}
          <dt style={{ color: palette.textMuted }}>Time</dt>
          <dd style={{ margin: 0 }}>
            {formatEventTime(row.lastSeen, Date.now())} · {formatTrackSpan(row.firstSeen, row.lastSeen)}
          </dd>
        </dl>
      </section>
    </main>
  )
}

function Notice({ message, palette }: { message: string; palette: EventsPalette }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: palette.background,
        color: palette.textMuted,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        padding: 16,
        textAlign: 'center',
      }}
    >
      {message}
    </div>
  )
}

function Loaded({ config, query, palette }: { config: EventsConfig; query: TrackDetailQuery; palette: EventsPalette }) {
  const system = useMemo(
    () => createSystem({ serverUrl: config.serverUrl, token: config.token }),
    [config.serverUrl, config.token],
  )
  useEffect(() => () => system.close(), [system])
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  useEffect(() => {
    let alive = true
    loadTrack(system, query, config.deviceNames[String(query.deviceId)], config.serverUrl)
      .then((s) => alive && setState(s))
      .catch((e: unknown) =>
        alive && setState({ status: 'error', message: e instanceof Error ? e.message : 'Failed to load the track' }),
      )
    return () => {
      alive = false
    }
  }, [system, query, config.deviceNames, config.serverUrl])
  return (
    <>
      <PaletteBridge system={system} />
      {state.status === 'loading' && <Notice message="Loading" palette={palette} />}
      {state.status === 'error' && <Notice message={state.message} palette={palette} />}
      {state.status === 'ready' && (
        <TrackDetail row={state.row} media={state.media} config={config} palette={palette} />
      )}
    </>
  )
}

export function EmbedTrackPage() {
  // Same sources, same precedence as the events page — see EmbedEventsPage.
  const result = useEmbedConfig(
    'events',
    () => (window as unknown as { __CAMSTACK_EVENTS__?: unknown }).__CAMSTACK_EVENTS__,
    parseEventsConfig,
    readEventsUrlConfig,
    { urlFirst: true },
  )
  const query = useMemo(() => parseTrackDetailQuery(location.search), [])
  const palette = resolvePalette(
    result !== null && result.ok ? result.config.theme : 'auto',
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  )
  if (result === null) return null
  if (!result.ok) return <Notice message={`Track embed config error: ${result.error}`} palette={palette} />
  if (query === null) return <Notice message="The track link names no track (id=)" palette={palette} />
  return <Loaded config={result.config} query={query} palette={palette} />
}
