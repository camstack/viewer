/**
 * EVERY key this app persists, and the level it lives at — the one registry
 * (operator decision 2026-10-21: two levels, each setting in exactly one).
 *
 *   device   never leaves this install: servers and tokens, the device
 *            certificate's bookkeeping, per-camera and per-grid quality / audio /
 *            layout, debug mode, overlay size, favourites, the last camera,
 *            what's-new, caches — and the screen-, network- and
 *            hardware-dependent half of the settings document
 *   account  per user, per hub: the local CACHE of the account copy the hub
 *            keeps (`account/account-settings-sync.ts`), one per hub
 *   retired  removed by a migration and never written again
 *
 * `per-hub` keys are stored as `<key>@<serverId>` (`server-scope.ts`);
 * `prefix` keys are a family whose tail is an id or a URL.
 *
 * `__tests__/storage-levels.spec.ts` scans the source for storage-key literals
 * and fails on one that is not declared here — a new persisted key cannot ship
 * without somebody deciding its level.
 */

export type StorageLevel = 'device' | 'account' | 'retired'

export type StorageKeyMatch = 'exact' | 'per-hub' | 'prefix'

export interface StorageKeyLevel {
  readonly key: string
  readonly match: StorageKeyMatch
  readonly level: StorageLevel
  /** What lives there, in a few words. */
  readonly what: string
}

export const STORAGE_KEY_LEVELS: readonly StorageKeyLevel[] = [
  // ── account: the per-hub caches of the account namespaces ──────────────────
  { key: '@camstack/v2/settings-account', match: 'per-hub', level: 'account', what: 'settings, account half (viewer.app)' },
  { key: 'v2.language', match: 'per-hub', level: 'account', what: 'app language (viewer.app)' },
  { key: 'camstack.v2.reel-filter', match: 'per-hub', level: 'account', what: 'Recent reel filter (viewer.app)' },
  { key: 'camstack.v2.reel-highlight', match: 'per-hub', level: 'account', what: 'reel highlight (viewer.app)' },
  { key: 'camstack.v2.device-picker.group-by', match: 'per-hub', level: 'account', what: 'device picker grouping (viewer.app)' },
  { key: 'camstack.v2.events-filter', match: 'per-hub', level: 'account', what: 'events parked rows (viewer.app)' },
  { key: '@camstack/v2/camera-prefs', match: 'per-hub', level: 'account', what: 'camera names, order, overlays (viewer.cameras)' },
  // One list; every grid carries its hub (`Grid.serverId`).
  { key: '@camstack/v2/grids', match: 'exact', level: 'account', what: 'grid definitions (viewer.grids)' },

  // ── device ─────────────────────────────────────────────────────────────────
  { key: '@camstack/v2/settings', match: 'exact', level: 'device', what: 'settings, device half' },
  { key: '@camstack/v2/device-settings', match: 'exact', level: 'device', what: 'debug mode, overlay size' },
  { key: '@camstack/v2/install-id', match: 'exact', level: 'device', what: 'this install\'s id on account writes' },
  { key: '@camstack/v2/grid-local', match: 'exact', level: 'device', what: 'per-grid layout, audio, tier' },
  { key: '@camstack/v2/camera-local', match: 'per-hub', level: 'device', what: 'per-camera tier, audio memory' },
  { key: 'camstack.camera-favourites.v1', match: 'per-hub', level: 'device', what: 'favourite cameras' },
  { key: '@camstack/v2/last-camera', match: 'per-hub', level: 'device', what: 'the camera last watched' },
  { key: '@camstack/v2/account-sync', match: 'per-hub', level: 'device', what: 'account sync bookkeeping' },
  // The Library pages' filter bars, one per section (`library-filters.ts`,
  // `events-filter-store.ts`); per hub because camera ids are.
  { key: 'camstack.v2.library-filter.events', match: 'per-hub', level: 'device', what: 'Events filter bar (cameras, classes, marks)' },
  { key: 'camstack.v2.library-filter.artifacts', match: 'per-hub', level: 'device', what: 'Media filter bar (cameras, kinds)' },
  { key: 'camstack.v2.library-filter.faces', match: 'per-hub', level: 'device', what: 'People filter bar and sort' },
  { key: 'camstack.v2.library-filter.plates', match: 'per-hub', level: 'device', what: 'Plates filter bar and sort' },
  { key: 'camstack.v2.library-filter.retrain', match: 'per-hub', level: 'device', what: 'Retrain camera and collection' },
  { key: 'camstack.v2.ondemand-player', match: 'exact', level: 'device', what: 'on-demand player box' },
  { key: 'camstack.v2.whats-new.seen', match: 'exact', level: 'device', what: "what's-new seen" },
  { key: 'camstack.v2.native-release.prompted', match: 'exact', level: 'device', what: 'native release prompt seen' },
  { key: 'camstack.v2.debug-status', match: 'exact', level: 'device', what: 'debug status read-outs' },
  { key: '@camstack/v2/face-suggestion-dismissed', match: 'exact', level: 'device', what: 'dismissed face suggestions' },
  { key: 'v2.theme', match: 'exact', level: 'device', what: 'theme' },
  { key: 'v2.servers', match: 'exact', level: 'device', what: 'saved servers' },
  { key: 'v2.activeServerId', match: 'exact', level: 'device', what: 'active server' },
  { key: 'v2.lastServerUrl', match: 'exact', level: 'device', what: 'last attempted server URL' },
  { key: 'v2.endpoints.', match: 'prefix', level: 'device', what: 'per-server endpoint cache' },
  { key: 'v2.pinnedRoute.', match: 'prefix', level: 'device', what: 'per-server pinned route' },
  { key: 'v2.token.', match: 'prefix', level: 'device', what: 'per-server session token (secure store)' },
  { key: 'v2.refresh.', match: 'prefix', level: 'device', what: 'per-server refresh token (secure store)' },
  { key: 'v2.hubLoginBounced', match: 'exact', level: 'device', what: 'hub login bounce flag (web session)' },
  { key: 'camstack.runtime.exit-marker.v1', match: 'exact', level: 'device', what: 'last runtime exit' },
  { key: 'camstack.activity.v1.', match: 'prefix', level: 'device', what: 'per-server activity list' },
  { key: 'v2.cache.cameras.', match: 'prefix', level: 'device', what: 'camera list cache' },
  { key: '@camstack/v2/cache/', match: 'prefix', level: 'device', what: 'data cache' },
  { key: '@camstack/v2/snapshot/', match: 'prefix', level: 'device', what: 'snapshot cache' },

  // ── retired ────────────────────────────────────────────────────────────────
  { key: 'v2.token', match: 'exact', level: 'retired', what: 'the pre-switcher single token (read once, deleted)' },
  { key: 'v2.settingsTemplateLink', match: 'exact', level: 'retired', what: 'settings-template link (mechanism deleted)' },
  { key: 'camstack.v2.nc-rules-strip', match: 'exact', level: 'retired', what: 'Rules strip tab (ephemeral now)' },
]

/** The declared level of a stored key (scoped, prefixed or exact); `undefined` = undeclared. */
export function storageLevelOf(key: string): StorageKeyLevel | undefined {
  return STORAGE_KEY_LEVELS.find((entry) => {
    switch (entry.match) {
      case 'exact':
        return key === entry.key
      case 'per-hub':
        return key === entry.key || key.startsWith(`${entry.key}@`)
      case 'prefix':
        return key.startsWith(entry.key)
    }
  })
}
