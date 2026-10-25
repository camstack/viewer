/**
 * The newest NATIVE build — the one an OTA cannot deliver.
 *
 * `scripts/release-ios.js` writes `public/native-release.json` on every
 * native release; the web build carries it and the hub serves it at
 * `/viewer/camstack/native-release.json`. The app compares that with the
 * binary it runs in and, when the file names a newer build, says so once per
 * build and offers the store. Pure here; the fetch is `use-native-release.ts`.
 */
export interface NativeRelease {
  readonly version: string
  readonly buildNumber: number
  readonly runtimeVersion: string
  /** Where the build was published. */
  readonly channel: 'testflight' | 'appstore' | 'play'
  readonly publishedAt: string
  /** App Store id, for the store link. */
  readonly storeAppId?: string
}

export type NativeReleaseState = 'unknown' | 'up-to-date' | 'newer-available'

export function isNativeRelease(raw: unknown): raw is NativeRelease {
  if (typeof raw !== 'object' || raw === null) return false
  const r = raw as Record<string, unknown>
  return (
    typeof r.version === 'string' &&
    typeof r.buildNumber === 'number' &&
    typeof r.runtimeVersion === 'string' &&
    (r.channel === 'testflight' || r.channel === 'appstore' || r.channel === 'play') &&
    typeof r.publishedAt === 'string'
  )
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

export interface RunningBinary {
  /** `Constants.expoConfig.version` */
  readonly version: string | null | undefined
  /** iOS `buildNumber` / Android `versionCode` */
  readonly buildNumber: number | null | undefined
}

/**
 * Newer when the published build number is higher, or the version is higher
 * — either alone is enough: a rebuilt binary of the same version has a higher
 * build number, and a version bump always comes with one.
 */
export function nativeReleaseState(running: RunningBinary, latest: NativeRelease | null | undefined): NativeReleaseState {
  if (!latest || !running.version || running.buildNumber === null || running.buildNumber === undefined) return 'unknown'
  if (latest.buildNumber > running.buildNumber) return 'newer-available'
  if (compareVersions(latest.version, running.version) > 0) return 'newer-available'
  return 'up-to-date'
}

/** The url that opens the build: TestFlight's own scheme, else the store page. */
export function storeUrlFor(release: NativeRelease, platform: 'ios' | 'android' | 'web', bundleId: string): string | null {
  if (platform === 'ios') {
    if (release.channel === 'testflight') return 'itms-beta://'
    return release.storeAppId ? `itms-apps://apps.apple.com/app/id${release.storeAppId}` : null
  }
  if (platform === 'android') return `market://details?id=${bundleId}`
  return null
}

export function nativeReleasePath(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/viewer/camstack/native-release.json`
}
