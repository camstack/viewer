/**
 * events-client — binds the shared `EventsDataClient` (`shared/events/events-client`)
 * onto the generated tRPC client of an embed's SDK system.
 *
 * The generated procedure types live at exactly one call site, so a cap change
 * surfaces here as a compile error rather than rotting behind a hand-written
 * interface somewhere in the render tree.
 */
import type { System } from '@camstack/sdk'
import type { EventsDataClient } from '../../../shared/events/events-client.js'

export type {
  EventsDataClient,
  EventsDeviceRow,
  RecentTracksInput,
  SearchObjectEventsInput,
} from '../../../shared/events/events-client.js'

/** Bind the interface to a live SDK system. */
export function createEventsDataClient(system: System): EventsDataClient {
  return {
    listRecentTracks: (input) => system.trpcClient.pipelineAnalytics.listRecentTracks.query(input),
    // Filtered and projected SERVER-side, exactly like the app's `use-cameras`.
    // Measured on this deployment (2026-08-25): `listAll({})` is 988 devices /
    // 970 KB / 205 ms, of which `config` alone is 369 KB — and that config
    // carries camera credentials into a browser iframe. The same call as
    // `{ isCamera: true, projection: 'slim' }` is 30 rows / 10.5 KB / 21 ms.
    // This is the FIRST call the Events page makes and `deviceIds` — hence
    // `listRecentTracks` and `listEventKinds` — waits on it, so the 92x is
    // paid on every cold open of the feed.
    //
    // `resolveCameraIds` still filters client-side and MUST stay: a hub that
    // predates the `isCamera` input silently ignores it (Zod strips unknown
    // keys rather than rejecting them), so this is safe to ship in either
    // order. The three fields this surface reads — `id`, `name`, `isCamera` —
    // are all in the slim projection.
    listDevices: () =>
      system.trpcClient.deviceManager.listAll.query({ isCamera: true, projection: 'slim' }),
    searchObjectEvents: (input) =>
      system.trpcClient.pipelineAnalytics.searchObjectEvents.query(input),
    listEventKinds: (deviceIds) =>
      system.trpcClient.pipelineAnalytics.listEventKindsBatch.query({ deviceIds }),
  }
}
