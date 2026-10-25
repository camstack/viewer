/**
 * EventsCard — one track, in either of the two layouts the surfaces need.
 *
 * ## `reel` is a REPRODUCTION, not a resemblance
 *
 * The native reel card is a square hero with the caption OVERLAID on the image
 * and a one-line footer holding the time — and the host reserves exactly that
 * height (`reelRowHeight(cardWidth)` = hero + 3+3 padding + a 14 px time line +
 * the list's 4+4). A card that stacks text lines below the hero, as the gallery
 * one does, does not merely look different: it overflows the reserved strip and
 * the footer falls below the fold. That is how "the embed shows no time"
 * happened — the time was rendered, at a y the host had already cut.
 *
 * So the reel variant mirrors `TrackCard`'s reel layout line for line:
 * `bodyReel` (paddingVertical 3, centered), `styles.time` (11 px text on an
 * explicit 14 px line, tabular numerals), and the label as an accent-tinted
 * pill over the image rather than a line under it.
 *
 * ## `gallery` is the tile layout
 *
 * The events-page tile stacks its text under the hero — title, subtitle,
 * camera · time, zone chips — because it has the room. That is the original
 * card and it is unchanged.
 *
 * The image comes from the AUTHENTICATED media plane, so it is fetched with the
 * bearer token and rendered from an object URL (see `use-authed-image.ts`). A
 * track with no stored crop (or a failed fetch) falls back to a class-tinted
 * tile rather than a broken-image glyph.
 */
import { resolveEventKindIcon } from '@camstack/ui-library'
import { ScanFace } from 'lucide-react'
import { memo, useRef, type CSSProperties } from 'react'
import type { EventsFields } from '../embed/events-config'
import { DEFAULT_EVENTS_LABELS, type EventsLabels } from '../../../shared/events/events-labels'
import { buildTrackThumbUrl } from '../../../shared/events/events-media-url'
import {
  audioKindId,
  audioLabelFor,
  EMPTY_KIND_LABELS,
  kindLabelFor,
} from '../../../shared/events/events-taxonomy'
import {
  accentForClass,
  AUDIO_ACCENT,
  type EventsPalette,
  formatEventTime,
  hhmm,
} from '../embed/events-theme'
import {
  type EventsTrackRow,
  isAudioSourceRow,
  resolveRowTitle,
  rowCaption,
} from '../../../shared/events/events-track-row'
import { fitPillText, PILL_FONT_MAX_PX } from '../embed/pill-fit'
import { useAuthedImage } from '../embed/use-authed-image'
import { useInViewport } from '../embed/use-in-viewport'
import { mediaScrim, THEME, withAlpha } from '../../../src/theme/tokens'

export interface EventsCardProps {
  readonly row: EventsTrackRow
  readonly serverUrl: string
  readonly token: string | undefined
  /** Square edge requested from the media plane (px, already DPR-scaled). */
  readonly thumbPx: number
  /** Rendered card width, as a CSS length. */
  readonly width: string
  /** Hero edge in CSS px. Square, so this is also the hero height. */
  readonly heroPx: number
  readonly fields: EventsFields
  readonly palette: EventsPalette
  readonly nowMs: number
  readonly variant: 'reel' | 'gallery'
  /** Declared glyph id for this row's class (from the server taxonomy). */
  readonly iconId: string
  /**
   * `kind → translated label`, from the host (see `events-config.kindLabels`).
   * Optional so a test — and a host too old to send one — still renders; an
   * absent dictionary falls back to the raw taxonomy id, which is what every
   * card printed before this existed.
   */
  readonly kindLabels?: ReadonlyMap<string, string>
  /**
   * The card's OWN words, injected by the host in the config it already sends
   * (see `events-config.labels`). The flag pills and the active dot have no
   * text content, so this attribute is the only name they carry.
   *
   * Absent ⇒ the English that ships — an older host, or an external iframe
   * that sends no strings, draws exactly the card it drew before.
   */
  readonly labels?: EventsLabels
  /** The scrolling element, so the card can tell when it is near the viewport.
   *  Its thumbnail is not fetched until then — sixty at once cost 13.6 s. */
  readonly scrollRoot: Element | null
  /** Load the image regardless of visibility (no-layout environments). */
  readonly eagerImages?: boolean
  /** D/T/✓ pills. Favourite ★ is always shown when the row is favourited. */
  readonly showAdminFlags?: boolean
  readonly onClick: (row: EventsTrackRow) => void
  /**
   * The "?" chip was tapped — open the assignment, not the detail. Optional so
   * a host that has no assignment surface simply renders an inert chip rather
   * than a button that lies.
   */
  readonly onAssignFace?: (row: EventsTrackRow) => void
}

const FLAG_PILL_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 14,
  height: 14,
  padding: '0 3px',
  borderRadius: 4,
  fontSize: 9,
  fontWeight: 700,
  lineHeight: '14px',
  letterSpacing: 0.2,
}

export const EventsCard = memo(function EventsCard({
  row,
  serverUrl,
  token,
  thumbPx,
  width,
  heroPx,
  fields,
  palette,
  nowMs,
  variant,
  iconId,
  kindLabels = EMPTY_KIND_LABELS,
  labels = DEFAULT_EVENTS_LABELS,
  scrollRoot,
  eagerImages,
  showAdminFlags,
  onClick,
  onAssignFace,
}: EventsCardProps) {
  const themeColors = THEME[palette.colorScheme]
  const imageScrim = mediaScrim({ background: palette.background })
  const onImageText = palette.text
  const onAccentFill = THEME.light.primaryForeground
  const flagPill: CSSProperties = {
    ...FLAG_PILL_BASE,
    background: imageScrim,
    color: onImageText,
  }
  const cardRef = useRef<HTMLButtonElement | null>(null)
  const near = useInViewport(cardRef, {
    root: scrollRoot,
    ...(eagerImages === true ? { disabled: true } : {}),
  })
  // The URL is only built once the card is near — `useAuthedImage` treats null
  // as "not known yet" and holds the skeleton, which is exactly the state a
  // tile below the fold should be in. Addressed by `row.trackId`, never
  // `row.bestEventId` (D482: a bare/polymorphic id can no longer resolve — see
  // `events-media-url.ts`).
  const url = near ? buildTrackThumbUrl(serverUrl, row.trackId, thumbPx) : null
  const image = useAuthedImage(url, token)
  // The class chip of an AUDIO episode is tinted as AUDIO, not by a class name
  // that reads as video (`animal`, `water`) — see `accentForClass`.
  const accent = accentForClass(row.className, isAudioSourceRow(row))
  const isReel = variant === 'reel'
  const reelCardHeight = heroPx
  /**
   * The pill REPLACES the glyph of the class it represents.
   *
   * A pill only exists when something finer than the class is known, and that
   * finer thing always implies the class: a face identity (`Dave`) implies
   * a person, a plate implies a vehicle, a sub-class (`Car`) IS the class said
   * more precisely. A glyph beside it restates what the pill already carries —
   * the operator called it out on a face card, where a person icon next to a
   * person's name is pure noise.
   *
   * The glyph stays wherever it is the ONLY thing said: a bare `person` /
   * `vehicle` / `motion` track — the majority of the feed, and where the glyph
   * is what makes the surface scannable.
   *
   * The test is the TIER, never `title !== className`: with the class
   * translated (`Auto`) that compare is true on every row, and it would have
   * put a text pill on every bare `person` tile and removed its glyph.
   */
  const title = resolveRowTitle(row, kindLabels)
  const hasPill = title.tier !== 'class'
  const showClassGlyph = !hasPill
  /**
   * How the pill holds its text. Gallery only: a translated type
   * (`Monossido di carbonio`) or an identity does not fit one line at 106 px,
   * and these strings differ at the TAIL, which is what an ellipsis eats — see
   * `pill-fit.ts`. The reel keeps one line: its hero is as small as 80 px and
   * its own footer already names the producing device.
   */
  const pillFit = fitPillText(title.text, heroPx)
  /**
   * Everything the THUMBNAIL is carrying: the class glyph, the finest-label
   * pill, and (gallery) one glyph per audio label. The caption below is
   * whatever is left, which — when this is true — is nothing.
   */
  const thumbnailCarriesLabels = fields.label
  const caption = rowCaption(row, thumbnailCarriesLabels, title.text, kindLabels)
  // Resolved through the SHARED web icon set (`@camstack/ui-library`), which is
  // byte-identical to the viewer's native map — 65 ids, one source, bundled.
  // No CDN: lucide-react is a direct dependency and tree-shakes into the bundle.
  const ClassGlyph = resolveEventKindIcon(iconId)

  const hero = (
    <div
      style={{
        position: 'relative',
        width: isReel ? heroPx : '100%',
        height: isReel ? heroPx : undefined,
        aspectRatio: isReel ? undefined : '1 / 1',
        borderRadius: 10,
        overflow: 'hidden',
        background: palette.skeleton,
        border: `1px solid ${palette.border}`,
        boxSizing: 'border-box',
        flex: '0 0 auto',
      }}
    >
      <div
        className={image.status === 'loading' ? 'events-skeleton' : undefined}
        data-testid="card-image-backing"
        style={{
          position: 'absolute',
          inset: 0,
          background: image.status === 'failed' ? `${accent}22` : palette.skeleton,
          boxShadow: `inset 0 0 0 1px ${palette.border}`,
        }}
      />
      {image.status === 'ready' ? (
        <img
          src={image.src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      ) : null}
      {/* Caption chips over the image — the native card's hierarchy:
          (1) the detection CLASS as its taxonomy glyph, (2) the FINEST label
          available (identity / plate / sub-class), (3) one chip per audio
          enrichment. The reel keeps only (1)+(2) on one line; the gallery has
          room for the audio chips to wrap. */}
      {fields.label && (
        <div
          style={{
            position: 'absolute',
            left: 4,
            right: 4,
            bottom: 4,
            display: 'flex',
            flexWrap: isReel ? 'nowrap' : 'wrap',
            gap: 3,
            alignItems: 'center',
            pointerEvents: 'none',
          }}
        >
          {showClassGlyph && (
            <span
              data-testid="card-class-glyph"
              title={kindLabelFor(row.className, kindLabels)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: `${accent}E6`,
                color: onAccentFill,
                borderRadius: 4,
                padding: '2px 4px',
                flex: '0 0 auto',
              }}
            >
              <ClassGlyph size={13} color={onAccentFill} />
            </span>
          )}
          {/* The finest thing known — a sensor TYPE, an identity, or the
              translated sub-class (`resolveRowTitle`). Shown only when it says
              more than the glyph already does.

              The pill is SHORT on purpose: a sensor's whole name covered the
              thumbnail, so the tile carries the type and the detail carries the
              name. The name is still reachable here without spending image —
              it is the hover (`title.fullText`), and nothing else in the card
              renders it.

              GALLERY: the pill wraps and steps its font down before it will
              clip, because a translated type is not always short
              (`Monossido di carbonio`) and an identity never is. REEL: one
              line, as before. */}
          {hasPill && (
            <span
              data-testid="card-title"
              title={title.fullText ?? title.text}
              style={{
                background: imageScrim,
                color: onImageText,
                fontSize: isReel ? PILL_FONT_MAX_PX : pillFit.fontSizePx,
                fontWeight: 700,
                lineHeight: 1.35,
                padding: '2px 6px',
                borderRadius: 4,
                overflow: 'hidden',
                minWidth: 0,
                ...(isReel
                  ? { textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                  : {
                      display: '-webkit-box',
                      WebkitLineClamp: pillFit.maxLines,
                      WebkitBoxOrient: 'vertical',
                      whiteSpace: 'normal',
                      // A single unbroken token (a plate, a machine label) must
                      // wrap rather than push the pill past the tile.
                      overflowWrap: 'anywhere',
                    }),
              }}
            >
              {title.text}
            </span>
          )}
          {/* An ASSIGNABLE face still waiting for a name — the "?" chip, in
              the exact slot the name pill occupies once someone assigns one.
              The glyph is what gives the "?" its subject; a recognised face
              never shows it (the name pill already says everything). */}
          {row.hasUnassignedFace === true && (
            <span
              // NOT a `button`: the card itself is one, and a button inside a
              // button is invalid — React says so on every render and the
              // parser would split them apart anywhere the markup is parsed
              // rather than built. A `role`/`tabIndex` span is the same control
              // with none of that.
              {...(onAssignFace === undefined
                ? {}
                : { role: 'button' as const, tabIndex: 0 })}
              data-testid="card-face-unassigned"
              title={labels.unassignedFace}
              // The chip IS the request. It used to be an inert `span`: it said
              // a face was waiting for a name and did nothing when tapped, so
              // the operator opened the card and looked for the assignment
              // again — answering a question they had already asked.
              onClick={(e) => {
                // Never the card's own open as well: two views would race, and
                // the one that wins is whichever handler ran last.
                e.stopPropagation()
                onAssignFace?.(row)
              }}
              onKeyDown={(e) => {
                if (onAssignFace === undefined) return
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.stopPropagation()
                e.preventDefault()
                onAssignFace(row)
              }}
              style={{
                border: 'none',
                cursor: onAssignFace ? 'pointer' : 'default',
                // The chip row above is `pointerEvents: 'none'` on purpose —
                // caption chips must never eat the card's own open. A `button`
                // inside it inherits that and is NOT hit-tested: making the
                // chip a button changed nothing on screen, every tap still fell
                // through to the card and opened the plain detail. The ONE
                // interactive chip opts back in, and only when it has somewhere
                // to send the tap — otherwise it stays transparent so the card
                // keeps opening through it.
                pointerEvents: onAssignFace ? 'auto' : 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                background: imageScrim,
                color: onImageText,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1.35,
                padding: '2px 6px',
                borderRadius: 4,
                flex: '0 0 auto',
              }}
            >
              <ScanFace size={13} color={onImageText} />
              {'?'}
            </span>
          )}
          {!isReel &&
            row.audioLabels
              .filter((a) => a !== row.className && a !== row.label)
              .map((audio) => {
                const audioKind = audioKindId(audio)
                const AudioGlyph = resolveEventKindIcon(audioKind)
                return (
                  <span
                    key={`audio-${audio}`}
                    title={audioLabelFor(audio, kindLabels)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `${AUDIO_ACCENT}E6`,
                      color: onAccentFill,
                      borderRadius: 4,
                      padding: '2px 4px',
                      flex: '0 0 auto',
                    }}
                  >
                    <AudioGlyph size={13} color={onAccentFill} />
                  </span>
                )
              })}
        </div>
      )}
      {((showAdminFlags === true &&
        (row.debug === true ||
          row.reviewed === true ||
          row.markForTrain === true ||
          row.retrainStatus === 'trained')) ||
        row.favourited === true) && (
        <span
          data-testid="card-flags"
          style={{
            position: 'absolute',
            top: 4,
            right: fields.badges && row.active ? 16 : 4,
            display: 'inline-flex',
            gap: 2,
            zIndex: 2,
          }}
        >
          {showAdminFlags === true && row.reviewed === true && (
            <span title={labels.reviewed} style={flagPill}>
              ✓
            </span>
          )}
          {showAdminFlags === true && row.debug === true && row.reviewed !== true && (
            <span title={labels.debug} style={flagPill}>
              D
            </span>
          )}
          {showAdminFlags === true && row.markForTrain === true && (
            <span title={labels.train} style={flagPill}>
              T
            </span>
          )}
          {showAdminFlags === true &&
            row.retrainStatus === 'trained' &&
            row.markForTrain !== true && (
              <span title={labels.trained} data-testid="retrain-status-trained" style={flagPill}>
                ✓T
              </span>
            )}
          {row.favourited === true && (
            <span title={labels.favourite} style={{ ...flagPill, color: themeColors.warning }}>
              ★
            </span>
          )}
        </span>
      )}
      {fields.badges && row.active && (
        <span
          title={labels.active}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 8,
            height: 8,
            borderRadius: 999,
            background: themeColors.laneMotion,
            boxShadow: `0 0 0 2px ${withAlpha(palette.background, 0.35)}`,
          }}
        />
      )}
      {fields.time && isReel ? (
        <span
          data-testid="card-time"
          style={{
            position: 'absolute',
            top: 4,
            right: fields.badges && row.active ? 16 : 4,
            background: imageScrim,
            color: onImageText,
            fontSize: 9,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            padding: '1px 5px',
            borderRadius: 5,
            zIndex: 2,
          }}
        >
          {formatEventTime(row.lastSeen, nowMs)}
        </span>
      ) : null}
    </div>
  )

  if (isReel) {
    return (
      <button
        ref={cardRef}
        type="button"
        onClick={() => onClick(row)}
        data-track-id={row.trackId}
        data-device-id={row.deviceId}
        style={{
          width,
          height: reelCardHeight,
          minWidth: width,
          minHeight: reelCardHeight,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          font: 'inherit',
          color: palette.text,
          boxSizing: 'border-box',
          contain: 'layout paint',
          overflow: 'hidden',
        }}
      >
        {hero}
      </button>
    )
  }

  // ── Gallery: the events-page tile ─────────────────────────────────────────
  //
  // The native tile puts the LABELS over the hero (chips, above) and the
  // ATTRIBUTION under it: the camera name, then the time. Reproduced here in
  // that order and that priority — the camera wraps to at most two lines, the
  // time is a single fixed-height line beneath it, and neither is inside an
  // overflow-hidden box, so a long camera name can never push the clock out of
  // the tile the way the reel's footer was pushed out of its strip.
  //
  // The line is the CAMERA on every tile, synthetic ones included.
  //
  // It used to prefer a synthetic row's `producingDeviceName`, which put the
  // SENSOR name here — and the pill over the thumbnail carried the same name,
  // so a contact event said `Contatto porta front door` twice: once in full
  // underneath, once clipped to `Contatto p…` on the image. One fact, said
  // twice, one of the two mutilated. This line is where every other tile
  // answers "which camera am I looking at", and a sensor event has one — the
  // synthetic track is attributed to the camera it is linked to (`cameraId` in
  // the hub's `synthetic-track.ts`), so `cameraName` is never a guess. When the
  // device directory has not named it, it degrades to `Camera <id>` exactly as
  // it does for a detection track — there is no synthetic-only fallback.
  //
  // The sensor's own name is now on NEITHER line: the pill says its TYPE and
  // the detail says its name. The tile is 106 px and a device name spends all
  // of it.
  const showCameraLine = fields.camera
  const cameraText = row.cameraName
  const anyBody = showCameraLine || fields.time || (fields.sublabel && caption.length > 0)

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={() => onClick(row)}
      data-track-id={row.trackId}
      data-device-id={row.deviceId}
      style={{
        width,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        font: 'inherit',
        color: palette.text,
        boxSizing: 'border-box',
      }}
    >
      {hero}
      {anyBody && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            minWidth: 0,
            paddingTop: 2,
            paddingBottom: 2,
          }}
        >
          {fields.sublabel && caption.length > 0 && (
            <span
              style={{
                fontSize: 11,
                color: palette.textMuted,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {caption}
            </span>
          )}
          {showCameraLine && (
            <span
              data-testid="card-camera"
              title={cameraText}
              style={{
                fontSize: 12,
                fontWeight: 600,
                lineHeight: '15px',
                // Two lines MAX, then ellipsis — a long camera name
                // ("Camera bedroom") must stay readable without
                // growing the tile and shoving the clock off the bottom.
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {cameraText}
            </span>
          )}
          {fields.time && (
            <span
              data-testid="card-time"
              style={{
                fontSize: 11,
                lineHeight: '14px',
                color: palette.textMuted,
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
                // Never shrink: this is the line the operator reported missing.
                flex: '0 0 auto',
              }}
            >
              {formatEventTime(row.lastSeen, nowMs)}
            </span>
          )}
          {fields.badges && row.zonesVisited.length > 0 && (
            <span
              style={{
                fontSize: 10,
                color: palette.textMuted,
                background: palette.chip,
                borderRadius: 5,
                padding: '1px 5px',
                alignSelf: 'flex-start',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}
            >
              {row.zonesVisited.join(' · ')}
            </span>
          )}
        </div>
      )}
    </button>
  )
})
