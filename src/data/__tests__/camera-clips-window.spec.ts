/**
 * @vitest-environment jsdom
 *
 * What the clip surface SHOWS while its window widens (D574).
 *
 * `clips-status.ts` has claimed since the day it was written that `clipCount`
 * includes *"a previous window's rows, which the hook deliberately keeps while
 * a wider one loads"*. The hook did no such thing: a widened window is a new
 * react-query key, a new key has no data, and `clips.clips` fell to the
 * module-level empty list. Every back-scroll extension therefore emptied the
 * body and `resolveClipsStatus` said `loading` over a list the operator had
 * just been reading — a leftover that described the right design, which is the
 * worst kind this repo has (CLAUDE.md, "working style").
 *
 * It is also half of what the operator saw: the blanked list is what put the
 * scroll offset back at the oldest end and let the walk ask again. The other
 * half is `lookback-walk.ts`; neither alone is the fix.
 *
 * The sequence, not a render: read a window, widen it, and ask what the body
 * says BEFORE the wider read answers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'

import { useCameraClips } from '../use-camera-clips.js'
import { resolveClipsStatus } from '../../clips/clips-status.js'

// Hoisted by vitest above the imports — `system` is read lazily, on the call.
vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({ controller: { getSystem: () => system }, state: 'connected' }),
}))

const FIXTURES = join(process.cwd(), 'src', 'clips', '__tests__', 'fixtures')

/** The bytes the hub sent on 2026-09-20 — 592's source list and its onboard
 *  catalog. A hand-written fixture here would be written to the reading this
 *  author already has; `live-wire.spec.ts` has caught three defects that way. */
function wire(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
}

const SOURCES: unknown = wire('live-592-sources.json')
const CLIPS: unknown = wire('live-592-native-clips.json')
const CLIP_ROWS = Array.isArray(CLIPS) ? CLIPS.length : 0

const DAY_MS = 24 * 60 * 60 * 1000
const UNTIL = 1_789_936_000_000
const SINCE = UNTIL - DAY_MS

let listClipsCalls: readonly unknown[][] = []
let deferListClips: (() => void) | null = null
/** The camera really has nothing in this window — not a load in flight. */
let answerEmpty = false

const system = {
  trpcClient: {
    videoclips: {
      listSources: { query: async () => SOURCES },
      listClips: {
        query: async (input: unknown) => {
          listClipsCalls = [...listClipsCalls, [input]]
          if (deferListClips !== null) {
            await new Promise<void>((resolve) => {
              deferListClips = resolve
            })
          }
          return answerEmpty ? [] : CLIPS
        },
      },
    },
  },
}

interface WrapperProps {
  readonly children: React.ReactNode
}

function wrapper(client: QueryClient): (props: WrapperProps) => React.ReactElement {
  function QueryHost({ children }: WrapperProps): React.ReactElement {
    return React.createElement(QueryClientProvider, { client }, children)
  }
  return QueryHost
}

describe('widening the window does not empty the body', () => {
  beforeEach(() => {
    listClipsCalls = []
    deferListClips = null
    answerEmpty = false
  })

  it('keeps the rows it already had, and never says "loading" over them', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const { result, rerender, unmount } = renderHook(
      (props: { readonly sinceMs: number }) =>
        useCameraClips({
          deviceId: 107,
          sinceMs: props.sinceMs,
          untilMs: UNTIL,
          chosenSourceId: 'native:reolink:onboard',
          enabled: true,
        }),
      { wrapper: wrapper(client), initialProps: { sinceMs: SINCE } },
    )

    await waitFor(() => expect(result.current.clips).toHaveLength(CLIP_ROWS))
    expect(listClipsCalls).toHaveLength(1)

    // The back-scroll extension: one more day, and the answer held open.
    deferListClips = () => {}
    await act(async () => {
      rerender({ sinceMs: SINCE - DAY_MS })
    })

    // The wider read IS in flight…
    await waitFor(() => expect(listClipsCalls).toHaveLength(2))
    // …and the body still has the rows the operator was looking at.
    expect(result.current.clips).toHaveLength(CLIP_ROWS)
    expect(result.current.loading).toBe(false)
    expect(
      resolveClipsStatus({
        active: true,
        connected: true,
        loading: result.current.loading,
        failed: result.current.failed,
        clipCount: result.current.clips.length,
        sourceState: result.current.choice.state,
        chosenMissing: result.current.choice.chosenMissing,
      }),
    ).toBe('hidden')

    // Settle the held read INSIDE the test, then unmount: a promise released
    // after teardown lands a react render on a torn-down environment.
    await act(async () => {
      deferListClips?.()
    })
    unmount()
  })

  it.each([
    ['toward the FUTURE — untilMs moves', { sinceMs: SINCE, untilMs: UNTIL + DAY_MS }],
    ['SLIDING forward — both ends move', { sinceMs: SINCE + DAY_MS, untilMs: UNTIL + DAY_MS }],
    ['SLIDING back — both ends move', { sinceMs: SINCE - DAY_MS, untilMs: UNTIL - DAY_MS }],
  ])('keeps the rows when the window moves %s', async (_label, next) => {
    // The operator's report, in three shapes: *"quando scrollo verso il futuro
    // la lista scompare e appare loading, anche quando scendo abbastanza da
    // finire le Clips visibili"*. The back-scroll case was already covered and
    // passed; these are the ends it did not reach, and a window that SLIDES is
    // not a window that widens — nothing in the scope rule distinguishes them,
    // so if one holds they all must.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const { result, rerender, unmount } = renderHook(
      (props: { readonly sinceMs: number; readonly untilMs: number }) =>
        useCameraClips({
          deviceId: 107,
          sinceMs: props.sinceMs,
          untilMs: props.untilMs,
          chosenSourceId: 'native:reolink:onboard',
          enabled: true,
        }),
      { wrapper: wrapper(client), initialProps: { sinceMs: SINCE, untilMs: UNTIL } },
    )

    await waitFor(() => expect(result.current.clips).toHaveLength(CLIP_ROWS))

    deferListClips = () => {}
    await act(async () => {
      rerender(next)
    })
    await waitFor(() => expect(listClipsCalls).toHaveLength(2))

    expect(result.current.clips).toHaveLength(CLIP_ROWS)
    expect(result.current.loading).toBe(false)

    await act(async () => {
      deferListClips?.()
    })
    unmount()
  })

  it('keeps the rows when the surface stops ASKING mid-load, and never says loading over them', async () => {
    // *"mai nascondere la lista corrente quando abbiamo dati da caricare"* —
    // the operator's rule, and the reason this is a latch rather than a
    // placeholder. `placeholderData` only reaches a NEW key on the same
    // observer; it does nothing when `askCap` goes false, because the body
    // short-circuits to the empty constant before the query is consulted at
    // all. Any upstream flicker — the source list refetching, the provider
    // preference rehydrating, the surface toggling — emptied the list under
    // the finger.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const { result, rerender, unmount } = renderHook(
      (props: { readonly enabled: boolean }) =>
        useCameraClips({
          deviceId: 107,
          sinceMs: SINCE,
          untilMs: UNTIL,
          chosenSourceId: 'native:reolink:onboard',
          enabled: props.enabled,
        }),
      { wrapper: wrapper(client), initialProps: { enabled: true } },
    )

    await waitFor(() => expect(result.current.clips).toHaveLength(CLIP_ROWS))

    await act(async () => {
      rerender({ enabled: false })
    })

    expect(result.current.clips).toHaveLength(CLIP_ROWS)
    expect(result.current.loading).toBe(false)
    unmount()
  })

  it('BLANKS when the provider changes — one source never paints under another', async () => {
    // The one thing the latch may not survive. A held list from another source
    // is the two-derivations defect D569 forbids, one frame at a time.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const { result, rerender, unmount } = renderHook(
      (props: { readonly chosenSourceId: string }) =>
        useCameraClips({
          deviceId: 107,
          sinceMs: SINCE,
          untilMs: UNTIL,
          chosenSourceId: props.chosenSourceId,
          enabled: true,
        }),
      {
        wrapper: wrapper(client),
        initialProps: { chosenSourceId: 'native:reolink:onboard' },
      },
    )

    await waitFor(() => expect(result.current.clips).toHaveLength(CLIP_ROWS))

    deferListClips = () => {}
    await act(async () => {
      rerender({ chosenSourceId: 'camstack:recorder' })
    })

    expect(result.current.clips).toHaveLength(0)

    await act(async () => {
      deferListClips?.()
    })
    unmount()
  })

  it('EMPTIES when the answer really is empty — the latch holds a window, not a memory', async () => {
    // The other half of the rule. "Never hide the list while loading" must not
    // become "never admit the camera has nothing": a latch that kept only
    // NON-empty answers would show yesterday's rows over a window that is
    // genuinely bare, for ever, with no way for the operator to tell.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const { result, rerender, unmount } = renderHook(
      (props: { readonly sinceMs: number }) =>
        useCameraClips({
          deviceId: 107,
          sinceMs: props.sinceMs,
          untilMs: UNTIL,
          chosenSourceId: 'native:reolink:onboard',
          enabled: true,
        }),
      { wrapper: wrapper(client), initialProps: { sinceMs: SINCE } },
    )

    await waitFor(() => expect(result.current.clips).toHaveLength(CLIP_ROWS))

    answerEmpty = true
    await act(async () => {
      rerender({ sinceMs: SINCE - DAY_MS })
    })

    await waitFor(() => expect(result.current.clips).toHaveLength(0))
    unmount()
  })

  it('holds the EMPTY answer too, so a flicker after it cannot resurrect old rows', async () => {
    // The discriminating case, and the reason the latch keeps whatever the
    // query last SETTLED with rather than the last non-empty list. An empty
    // answer wins on its own while it is present; it is when `askCap` goes
    // false AFTER it — the source list refetching, the surface toggling — that
    // a latch of non-empty-only hands back rows from a window the operator
    // left, with nothing on screen to say they are stale.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const { result, rerender, unmount } = renderHook(
      (props: { readonly sinceMs: number; readonly enabled: boolean }) =>
        useCameraClips({
          deviceId: 107,
          sinceMs: props.sinceMs,
          untilMs: UNTIL,
          chosenSourceId: 'native:reolink:onboard',
          enabled: props.enabled,
        }),
      { wrapper: wrapper(client), initialProps: { sinceMs: SINCE, enabled: true } },
    )

    await waitFor(() => expect(result.current.clips).toHaveLength(CLIP_ROWS))

    answerEmpty = true
    await act(async () => {
      rerender({ sinceMs: SINCE - DAY_MS, enabled: true })
    })
    await waitFor(() => expect(result.current.clips).toHaveLength(0))

    // …and now the surface stops asking. The body must stay empty.
    await act(async () => {
      rerender({ sinceMs: SINCE - DAY_MS, enabled: false })
    })
    expect(result.current.clips).toHaveLength(0)
    unmount()
  })

  it('still says loading on the FIRST window, where there is nothing to keep', async () => {
    // The kept-rows rule must not turn a cold first paint into `empty` — that
    // is the blank the whole clips-status line of work exists to remove.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    deferListClips = () => {}
    const { result, unmount } = renderHook(
      () =>
        useCameraClips({
          deviceId: 107,
          sinceMs: SINCE,
          untilMs: UNTIL,
          chosenSourceId: 'native:reolink:onboard',
          enabled: true,
        }),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(listClipsCalls).toHaveLength(1))
    expect(result.current.clips).toHaveLength(0)
    expect(result.current.loading).toBe(true)
    await act(async () => {
      deferListClips?.()
    })
    unmount()
  })
})
