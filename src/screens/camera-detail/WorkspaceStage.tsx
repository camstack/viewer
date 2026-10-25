/**
 * WorkspaceStage — the wall, wired to the store, in the picture's slot.
 *
 * ## Why the wall needs a host of its own
 *
 * `CameraDetailScreen` mounts this where it used to mount the picture, so the
 * wall is now inside the most scarred file in the repo. Everything that reads
 * the workspace store on a per-CELL basis — the arrangement, the remove, the
 * resize, the close — lives here instead of there, for the reason
 * `BelowStreamArea`'s docblock has always given: a `useWorkspaceStore(s =>
 * s.workspace.cells)` in the screen would re-render the whole theater on every
 * frame of a resize drag. Here the blast radius is this subtree, and a render of
 * this subtree is not a remount of the wall — `GridLiveEmbed` is not keyed on
 * anything that changes here.
 *
 * The screen keeps exactly one workspace subscription (`workspace.members`),
 * because it needs the list for the timeline's scope and for the single↔wall
 * decision itself. `devices` arrives as a prop from that one derivation rather
 * than being re-derived here: the wall and the timeline must never disagree
 * about which cameras this screen is about (`workspace-grid.ts`).
 *
 * ## The grid page's bar, docked under the cells
 *
 * This wall IS an ad-hoc grid, so it carries the grid page's control bar —
 * the same `GridControlBar`, not a copy: pause all, audio (per camera + mute
 * all), quality, layout, the highlight menu (master switch, triggers, box
 * layers) and active-only, each acting on every camera on the wall. The
 * saved-grid verbs are not passed and therefore not drawn: there is no grid to
 * EDIT or SHARE, no page to go BACK from (the toolbar owns that) and no
 * timeline clock (the theater's timeline is always here).
 *
 * Nothing the bar does writes a saved grid or a camera's preferences. Transport
 * and audio are this component's session state, as they always were; the view
 * options land in the session workspace (`workspace-wall-options.ts` has the
 * rules), which is device-local, unpersisted and dropped with the view.
 *
 * The bar is DOCKED in a row of its own under the cells (`footer`), not
 * floated over them: here the wall shares the screen with the timeline and the
 * reel, and a bar over the bottom row would cover live picture.
 */
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useWorkspaceStore } from '../../store/workspace-store.js'
import { FEATURE, useCameras, type CameraInfo } from '../../data/use-cameras.js'
import {
  heldTileIds,
  toggleTileTransport,
  toggleWallTransport,
  type GridTransport,
} from '../../live/battery-stream-gate.js'
import type { GridCellPanelKind } from '../../grid/cell-controls.js'
import type { GridCellSpan } from '../../grid-embed/embed-messages.js'
import { GridControlBar } from '../../components/grid/GridControlBar.js'
import { GridTapDismiss } from '../../components/grid/GridTapDismiss.js'
import { WorkspaceGrid } from './WorkspaceGrid.js'
import {
  resolveWorkspaceWall,
  toggleWallAudio,
  toggleWallLayer,
  type WorkspaceWallPrimary,
} from './workspace-wall-options.js'

/** Hoisted: a fresh literal per render would give the wall a new identity, and
 *  on web the config builder closes over these. */
const NO_IDS: readonly number[] = []
const EMPTY_TRANSPORT: GridTransport = { pausedIds: new Set(), startedIds: new Set() }

/** `find` returns `CameraInfo | undefined`; this narrows without a cast. */
function isCamera(c: CameraInfo | undefined): c is CameraInfo {
  return c !== undefined
}

export interface WorkspaceStageProps {
  /** Every camera on screen, picture first (`workspaceOnScreenCameras`). */
  readonly devices: readonly number[]
  /** What the wall draws until the bar says otherwise — the primary's tier,
   *  highlight config (ungated) and `objects` layer. */
  readonly primary: WorkspaceWallPrimary
  /** On the live edge? Off it the embed's own highlight must stop. */
  readonly liveOverlaysVisible: boolean
  /** A cell asked to become the primary — `router.replace('/camera/<id>')`. */
  readonly onGoTo: (deviceId: number) => void
  readonly onCellPanel: (kind: GridCellPanelKind, deviceId: number) => void
}

export function WorkspaceStage({
  devices,
  primary,
  liveOverlaysVisible,
  onGoTo,
  onCellPanel,
}: WorkspaceStageProps): React.JSX.Element {
  const { t } = useTranslation()
  const cells = useWorkspaceStore((s) => s.workspace.cells)
  const wallOptions = useWorkspaceStore((s) => s.wallOptions)
  const setWallOptions = useWorkspaceStore((s) => s.setWallOptions)
  const clear = useWorkspaceStore((s) => s.clear)
  const remove = useWorkspaceStore((s) => s.remove)
  const resize = useWorkspaceStore((s) => s.resize)

  // The store keys the arrangement by NUMBER; the wire keys it by string (a
  // JSON object's keys always are). Converted once here, and memoised, because
  // on web the config builder closes over this value and a fresh object every
  // render would re-run the iframe's config handshake for nothing.
  const spans = useMemo<Readonly<Record<string, GridCellSpan>>>(() => {
    const out: Record<string, GridCellSpan> = {}
    for (const key of Object.keys(cells)) out[key] = cells[Number(key)]
    return out
  }, [cells])

  // ── Per-cell transport ────────────────────────────────────────────────
  //
  // Session state, never persisted: a view is not a saved grid, and
  // `workspace-store.ts` already argues why a workspace restored at launch is
  // the wrong feature. The grid page keeps its audio per GRID because that one
  // IS an artifact.
  //
  // The pause goes through `toggleTileTransport` rather than a set membership
  // test, because that function is where the battery gate lives: on a battery
  // tile that has never run the press means START. Writing a second, simpler
  // pause here would be two arithmetics over one idea — which is exactly the
  // defect this screen shipped in its wall gate this morning.
  const { data: cameras } = useCameras()
  const [transport, setTransport] = useState<GridTransport>(EMPTY_TRANSPORT)
  const [audioOnIds, setAudioOnIds] = useState<readonly number[]>(NO_IDS)

  const onScreen = useMemo(
    () => devices.map((id) => (cameras ?? []).find((c) => c.id === id)).filter(isCamera),
    [devices, cameras],
  )
  const batteryIds = useMemo(
    () => new Set(onScreen.filter((c) => c.features.includes(FEATURE.battery)).map((c) => c.id)),
    [onScreen],
  )

  // What the wall boots paused, and is pushed on change. A battery camera added
  // to a view arrives HELD — the grid page's rule ("opening a grid must never
  // wake a battery camera") says nothing about how the wall was opened, and
  // adding one to a view woke it.
  // Walks `devices` — the PROP — not the resolved camera rows. A camera the
  // query has not answered for yet is treated as mains-powered, so the
  // operator's own press always lands and the battery HOLD arms as soon as the
  // list says the camera is on a battery. Deriving this from the resolved rows
  // instead made a pause a no-op until the query returned: an unanswered query
  // is not a decision, and it must never look like one.
  const pausedIds = useMemo(
    () =>
      heldTileIds(
        devices.map((id) => ({ id, batteryPowered: batteryIds.has(id) })),
        transport,
      ),
    [devices, batteryIds, transport],
  )

  const onPauseToggle = useCallback(
    (deviceId: number) => {
      setTransport((prev) => toggleTileTransport(prev, deviceId, batteryIds.has(deviceId)))
    },
    [batteryIds],
  )

  const onAudioToggle = useCallback((deviceId: number) => {
    setAudioOnIds((prev) =>
      prev.includes(deviceId) ? prev.filter((id) => id !== deviceId) : [...prev, deviceId],
    )
  }, [])

  const onResize = useCallback(
    (deviceId: number, cw: number, ch: number) => resize(deviceId, { cw, ch }),
    [resize],
  )

  // ── The bar ───────────────────────────────────────────────────────────
  const wall = useMemo(
    () => resolveWorkspaceWall(primary, wallOptions, liveOverlaysVisible),
    [primary, wallOptions, liveOverlaysVisible],
  )
  // The bar's open popover, owned here for the reason the grid page owns it
  // (`grid/panel-dismiss`): a tap on the wall must be able to close it, and
  // the bar cannot see that tap.
  const [barPanelKey, setBarPanelKey] = useState<string | null>(null)
  const audioOnSet = useMemo(() => new Set(audioOnIds), [audioOnIds])

  return (
    <WorkspaceGrid
      devices={devices}
      quality={wall.quality}
      highlight={wall.highlight}
      layers={wall.layers}
      layoutChoice={wall.layout}
      activeOnly={wall.activeOnly}
      onGoTo={onGoTo}
      onCellPanel={onCellPanel}
      onClose={clear}
      onRemove={remove}
      onResize={onResize}
      spans={spans}
      audioOnIds={audioOnIds}
      pausedIds={pausedIds}
      onAudioToggle={onAudioToggle}
      onPauseToggle={onPauseToggle}
      cellsOverlay={
        <GridTapDismiss
          active={barPanelKey !== null}
          onDismiss={() => setBarPanelKey(null)}
          accessibilityLabel={t('v2.cameraDetail.close')}
        />
      }
      footer={
        <GridControlBar
          docked
          anyPaused={transport.pausedIds.size > 0}
          onTogglePause={() =>
            setTransport((prev) => toggleWallTransport(prev, devices, batteryIds))
          }
          cameras={onScreen}
          audioOnIds={audioOnSet}
          onToggleAudio={onAudioToggle}
          anyAudioOn={audioOnIds.length > 0}
          onToggleMassAudio={() => setAudioOnIds((prev) => toggleWallAudio(prev, devices))}
          quality={wall.quality}
          onSelectQuality={(quality) => setWallOptions({ quality })}
          layout={wall.layout}
          onSelectLayout={(layout) => setWallOptions({ layout })}
          highlightOn={wall.highlightOn}
          onToggleHighlight={() => setWallOptions({ highlightOn: !wall.highlightOn })}
          highlightSettings={wall.highlightSettings}
          onSetHighlightSettings={(patch) =>
            setWallOptions({ highlight: { ...wallOptions.highlight, ...patch } })
          }
          layers={wall.layers}
          onToggleLayer={(layer) => setWallOptions({ layers: toggleWallLayer(wall.layers, layer) })}
          activeOnly={wall.activeOnly}
          onToggleActiveOnly={() => setWallOptions({ activeOnly: !wall.activeOnly })}
          panelKey={barPanelKey}
          onPanelKey={setBarPanelKey}
        />
      }
    />
  )
}
