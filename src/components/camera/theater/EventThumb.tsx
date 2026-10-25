/**
 * EventThumb — renders a thumbnail for a single timeline item (a track-shaped
 * ObjectEvent).
 *
 * Loading strategy (in priority order):
 *  1. An explicit `event.mediaUrl` — clip-visit cards stamp the main-event
 *     snapshot here. Track cards leave it unset (stamped raw-event URLs 404).
 *  2. The address `thumbMediaAddress` resolves — the FULL 640×360 crop (16:9,
 *     matching the card box), rendered with the Bearer header (`useServer()`
 *     token). A TRACK goes through the owner ladder
 *     `…/event-media/o/track/<trackId>` ("best media of this track"), never
 *     guessed from a string's shape (D482).
 *
 *     Addressed by `trackId`, never by `event.id` (the track's `bestEventId`):
 *     D482 removed the bare `<prefix>/<id>` form the old code fetched
 *     because `bestEventId` is a POLYMORPHIC pointer (an object-event id, a
 *     trackId, or a media key) and an owner is `(table, id)` — half of that
 *     is not a question the plane can answer any more. Every track-shaped
 *     `ObjectEvent` carries its own `trackId` (`trackToTimelineEvent`), so
 *     this never has to guess.
 *  3. On image error: if `opts.fallbackAddress` is set (the visit's own
 *     ANALYTICS object event, when `mediaFallbackId` names one), try THAT
 *     address over HTTP. Otherwise the class icon. Never `getEventMedia`.
 *  4. Final fallback: a lucide class icon tinted by `colorForEventType`.
 *
 * The component never throws. All error paths are handled internally.
 * Memoized via `React.memo`.
 */

import React, { memo, useCallback } from 'react'
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native'
import { Image } from 'expo-image'
import { useTranslation } from 'react-i18next'
import { User, Car, Dog, Bird, HelpCircle } from '../../../lib/icons.js'

import { useServer } from '../../../app/ServerProvider.js'
import { useConnection } from '../../../connection/ConnectionProvider.js'
import { useEventMedia } from '../../../data/use-event-media.js'
import { colorForEventType } from './event-highlights.js'
import { thumbMediaAddress } from './thumb-address.js'
import { clipStillSource } from '../../../clips/clip-still-source.js'
import { noteClipStill } from '../../../clips/clip-telemetry.js'
import { hubImageSource } from './hub-image-source.js'
import { useClipStill } from '../../../clips/use-clip-still.js'
import type { ObjectEvent } from './event-cluster.js'
import { THEME, withAlpha } from '../../../theme/tokens.js'

/** Placeholder behind a thumb while media loads — same darkness as the old `rgba(0,0,0,0.3)`. */
const THUMB_BACKDROP = { backgroundColor: withAlpha(THEME.dark.background, 0.3) }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EventThumbProps {
  readonly event: ObjectEvent
  readonly width: number
  readonly height: number
  /**
   * How the crop fills its box. Timeline / grid cards use `cover` (default) — a
   * 16:9 crop in a 16:9 box fills edge-to-edge. Detail HEROES pass `contain` so a
   * crop of a different aspect (a square subject thumbnail) is shown FIT
   * (letterboxed) and never cropped.
   */
  readonly contentFit?: 'cover' | 'contain'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type IconComponent = React.ComponentType<{ size: number; color: string }>

/** Native expo-image needs an absolute URL; hub-stamped snapshots are relative. */
function resolveSnapshotUrl(serverUrl: string | null, url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url
  if (serverUrl === null || serverUrl.length === 0) return url
  const base = serverUrl.replace(/\/+$/, '')
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`
}

/** Pick a Lucide icon component for a detection class. */
function iconForClass(className: string): IconComponent {
  const lower = className.toLowerCase()
  if (lower === 'person' || lower === 'face') return User
  if (
    lower === 'car' ||
    lower === 'truck' ||
    lower === 'bus' ||
    lower === 'vehicle' ||
    lower === 'motorcycle' ||
    lower === 'bicycle'
  ) {
    return Car
  }
  if (lower === 'dog' || lower === 'cat' || lower === 'animal') return Dog
  if (lower === 'bird') return Bird
  return HelpCircle
}

// ─── Component ───────────────────────────────────────────────────────────────

export const EventThumb = memo(function EventThumb({
  event,
  width,
  height,
  contentFit = 'cover',
}: EventThumbProps) {
  const { token } = useServer()
  const { t } = useTranslation()
  const { controller, state } = useConnection()
  const serverUrl = state === 'connected' ? (controller.getSystem()?.serverUrl ?? null) : null
  // The still that EXISTS beats the one that has to be made. A served
  // `thumbnailUrl` is a JPEG already on the provider's disk — one GET — while
  // the mint cuts one out of the clip FILE through a bounded queue. 275 of
  // 592's 300 rows carried a served still and this tile asked the mint route
  // for all 300, which is what put the operator's list behind the catalog
  // prefetch (D580).
  //
  // Both go through `useClipStill` and never through `<Image src>`: the mint
  // answers 204 more often than it answers a JPEG and an `<Image>` cannot read
  // why, and BOTH need the session's `Authorization` header — a bare
  // `<Image>` at either address gets a 401 it renders as a broken tile
  // (D563, D573).
  const stillSource = clipStillSource(event)
  // The two addresses fail differently, so they are FETCHED differently —
  // which is what `ClipStillOrigin` has named since D580 without anything
  // branching on it.
  //
  //  - `served`: a still the provider already holds. 200 or 404, nothing in
  //    between, so `<Image>` can read every answer it will ever get. It goes
  //    straight to expo-image with the session header and `memory-disk`, which
  //    buys the disk cache — the second look at a clip is instant and costs no
  //    request. Pulling it through `fetch` into a `data:` URI (as this did
  //    until 2026-09-21) defeated that cache AND crossed React Native's
  //    inability to build a Blob from a buffered body, which is the sentence
  //    the operator had printed across every card.
  //  - `mint`: cut from the clip file on demand, and it answers **204** while
  //    the queue drains. An `<Image>` cannot read a 204's disposition header —
  //    it fires `onerror` with nothing to say — so that one stays on the
  //    ladder below (D563, D573).
  const servedStillUrl =
    stillSource !== null && stillSource.origin === 'served'
      ? resolveSnapshotUrl(serverUrl, stillSource.url)
      : null
  const stillUrl =
    stillSource === null || stillSource.origin === 'served'
      ? null
      : resolveSnapshotUrl(serverUrl, stillSource.url)
  const still = useClipStill(stillUrl, token ? `Bearer ${token}` : null)
  // Clip-visit cards stamp the main-event snapshot on `event.mediaUrl`. Track
  // cards leave it unset: a raw-event URL 404s, and the data-plane by id is
  // the crop that actually exists. Passing a snapshot skips the event-id fetch.
  const snapshotUrl =
    typeof event.mediaUrl === 'string' && event.mediaUrl.length > 0
      ? resolveSnapshotUrl(serverUrl, event.mediaUrl)
      : undefined
  // The address for this item — never `event.id` (D482: `bestEventId` is a
  // polymorphic pointer, not an owner). A card with nothing to address falls
  // straight to the class glyph rather than guess an owner type from
  // `event.id`'s shape. See `thumbMediaAddress`.
  const primaryAddress = thumbMediaAddress(event, snapshotUrl !== undefined)
  // Cluster cards show the detection SUBJECT crop (16:9) via the direct HTTP
  // data-plane. `directDefaultKind` omits `?kind` so the server's default
  // resolver serves the subject crop — a per-event `crop`, else the track's
  // `thumbnail` crop — never the `keyFrame` full frame that `?kind=crop` wrongly
  // prefers for the ~70% of items whose id is a track id (empirically: 65% of
  // 104's tiles were full frames under `?kind=crop`, 0% here). `preferKind`
  // `preferKind` still names the HTTP `?kind=` when `directDefaultKind` is off.
  const { uri, failed, onError } = useEventMedia(
    primaryAddress,
    snapshotUrl,
    snapshotUrl !== undefined ? undefined : 'crop',
    {
      variant: 'full',
      directDefaultKind: true,
      deviceId: event.deviceId,
      // The RECOVERY address, and only that: it must not mint the primary
      // URL, or the card would silently stop showing the visit snapshot it is
      // supposed to show. With a snapshot present the card's own `id` is an
      // opaque CLIP id the data plane cannot resolve, so a dead `mediaUrl`
      // went straight to the class glyph — for exactly the cards whose URL is
      // least trustworthy (the hub stamps `thumbnail` unvouched; 35% of them
      // 404 on a measured camera). `mediaFallbackId` names the visit's own
      // ANALYTICS event — an `object`-owned row, never a guess.
      ...(event.mediaFallbackId !== undefined
        ? { fallbackAddress: { kind: 'owner', ownerType: 'object', ownerId: event.mediaFallbackId } }
        : {}),
    },
  )

  const accentColor = colorForEventType(event.className)
  const Icon = iconForClass(event.className)
  const sizeStyle = { width, height }

  const onServedStillLoad = useCallback((): void => {
    noteClipStill({ outcome: 'served', ms: 0 })
  }, [])
  const onServedStillError = useCallback((): void => {
    // The cache and the network are one path here, so a failure names itself
    // as one thing: the address answered, and not with a picture.
    noteClipStill({ outcome: 'failed', ms: 0 })
  }, [])

  // The credential lives in `hub-image-source.ts` and nowhere else. It used to
  // be spelled out here, gated on `uri && !isData`, and a second image in this
  // same file reused that variable for an address those two conditions say
  // nothing about — so it rendered with no token at all (2026-09-21). Three
  // images, one resolver.

  // ── The SERVED still ──────────────────────────────────────────────────────
  //
  // Handed to the image cache rather than to a fetch. Counted anyway: a tile
  // the cache answers makes no request, and a surface that asks for nothing
  // and a surface that renders nothing look identical from the hub — which is
  // the confusion these counters were added to end.
  if (servedStillUrl !== null) {
    return (
      <View style={[styles.container, sizeStyle, THUMB_BACKDROP]}>
        <Image
          source={hubImageSource(servedStillUrl, token)}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          cachePolicy="memory-disk"
          onLoad={onServedStillLoad}
          onError={onServedStillError}
        />
      </View>
    )
  }

  // ── The mint path ─────────────────────────────────────────────────────────
  //
  // A tile is never blank with no explanation. While the provider's queue
  // drains it SAYS it is waiting; when the ladder runs out, or the camera says
  // never, it names the reason. A code this build has never heard of falls
  // back to the provider's own sentence, rendered verbatim.
  if (still.phase !== 'idle') {
    const words = still.messageKey !== null ? t(still.messageKey) : (still.reason ?? '')
    if (still.phase === 'loading') {
      return (
        <View
          accessibilityLabel={still.messageKey ?? words}
          style={[styles.container, sizeStyle, THUMB_BACKDROP, styles.iconContainer]}
        >
          <ActivityIndicator size="small" color={accentColor} />
          {height >= CAPTION_MIN_HEIGHT_PX ? (
            <Text numberOfLines={2} style={[styles.caption, { color: accentColor }]}>
              {words}
            </Text>
          ) : null}
        </View>
      )
    }
    if (still.phase === 'refused') {
      return (
        <View
          accessibilityLabel={still.messageKey ?? words}
          style={[
            styles.container,
            sizeStyle,
            THUMB_BACKDROP,
            styles.iconContainer,
            { backgroundColor: accentColor + '1A' },
          ]}
        >
          <Icon size={Math.min(width, height) * 0.3} color={accentColor} />
          {height >= CAPTION_MIN_HEIGHT_PX ? (
            <Text numberOfLines={2} style={[styles.caption, { color: accentColor }]}>
              {words}
            </Text>
          ) : null}
        </View>
      )
    }
    if (still.uri !== null) {
      return (
        <View style={[styles.container, sizeStyle, THUMB_BACKDROP]}>
          <Image
            source={hubImageSource(still.uri, token)}
            style={StyleSheet.absoluteFill}
            contentFit={contentFit}
            cachePolicy="memory-disk"
          />
        </View>
      )
    }
  }

  // Show icon when all image sources are exhausted or no media exists.
  if (failed || uri === null) {
    const iconSize = Math.min(width, height) * 0.45
    return (
      <View
        style={[
          styles.container,
          sizeStyle,
          THUMB_BACKDROP,
          styles.iconContainer,
          { backgroundColor: accentColor + '1A' },
        ]}
      >
        <Icon size={iconSize} color={accentColor} />
      </View>
    )
  }

  return (
    <View style={[styles.container, sizeStyle, THUMB_BACKDROP]}>
      <Image
        source={hubImageSource(uri, token)}
        style={StyleSheet.absoluteFill}
        // Cards use `cover` (16:9 crop in a 16:9 box, no letterbox bars); detail
        // heroes pass `contain` so a differently-shaped crop is shown FIT, never
        // cropped.
        contentFit={contentFit}
        cachePolicy="memory-disk"
        onError={onError}
      />
    </View>
  )
})

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  caption: {
    fontSize: 9,
    lineHeight: 11,
    marginTop: 4,
    paddingHorizontal: 4,
    textAlign: 'center',
  },
})

/** Below this the box holds a glyph and nothing else — two lines of 9 px would
 *  overflow it. The reason still reaches a screen reader through the
 *  `accessibilityLabel`, which every branch sets. */
const CAPTION_MIN_HEIGHT_PX = 64
