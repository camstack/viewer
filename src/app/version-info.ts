/**
 * What is actually running — the version surface the Settings screen renders.
 *
 * Written after the 2026-07-30 report "iOS still shows 1.0.199 while the repo
 * is at 1.0.203". It was not a stale app: the OTA had arrived and the app was
 * running current code. The Settings screen showed `expoConfig.version`, which
 * comes from `app.config.ts`, and four consecutive OTA bumps had written only
 * `package.json` — so the LABEL froze while the CODE moved.
 *
 * A single version string cannot distinguish "the update never arrived" from
 * "the update arrived and the label is wrong", and that ambiguity is what made
 * the report undiagnosable. So this reports the independent facts instead:
 *
 *  - `app`      — the bundle's declared version (moves with every publish)
 *  - `build`    — the NATIVE binary's build number; never changes for a given
 *                 binary, so it only moves with a store release
 *  - `runtime`  — the OTA compatibility pin; an update only reaches installs
 *                 whose runtimeVersion matches
 *  - `update`   — WHICH bundle is live: `embedded` (the one shipped inside the
 *                 binary) or a downloaded update, with its publish time
 *
 * `update` is the one that answers the operator's actual question, and it is
 * derived from `isEmbeddedLaunch` rather than from any version string.
 *
 * Deliberately free of `expo-application`: reading the native version string
 * would add a NATIVE dependency, and a native dependency cannot ship over the
 * air — diagnosing an OTA problem would then require a store release. Build
 * number comes from `Constants.platform`, which is already present.
 */

/** Raw values read from `expo-constants` / `expo-updates` at the call site. */
export interface VersionInputs {
  /** `Constants.expoConfig?.version` — the bundle's declared version. */
  readonly configVersion?: string | null
  /** iOS `buildNumber` / Android `versionCode`, as a string. */
  readonly nativeBuildNumber?: string | null
  /** `Updates.runtimeVersion`. */
  readonly runtimeVersion?: string | null
  /** `Updates.updateId` — null when running the embedded bundle. */
  readonly updateId?: string | null
  /** `Updates.createdAt` — when the running bundle was published. */
  readonly updateCreatedAt?: Date | null
  /** `Updates.isEmbeddedLaunch` — true ⇒ the bundle inside the binary. */
  readonly isEmbeddedLaunch?: boolean
  /** `Updates.isEnabled` — false on a dev client or with updates disabled. */
  readonly updatesEnabled?: boolean
  /**
   * Is there a native binary under this bundle at all?
   *
   * `false` for the Electron shell and the browser PWA, which load the web
   * build: no native binary, no OTA channel, no updater. The three facts below
   * `app` are then not UNKNOWN, they do not exist — and an em dash claims the
   * first when the truth is the second, which is the absent-vs-not-yet-known
   * defect wearing a settings row.
   *
   * Absent defaults to `true`: a caller that forgets the flag shows a phone
   * one row instead of four, which is the 2026-07-30 incident this module
   * exists to prevent, reintroduced from the other side.
   */
  readonly nativeBinary?: boolean
}

export type VersionRowId = 'app' | 'build' | 'runtime' | 'update'

export interface VersionRow {
  readonly id: VersionRowId
  /** Rendered value; never empty — an unknown value reads as `'—'`. */
  readonly value: string
}

/** What an unknown value renders as, rather than an empty row. */
const UNKNOWN = '—'

const text = (v: string | null | undefined): string => (v !== null && v !== undefined && v !== '' ? v : UNKNOWN)

/**
 * Describe the running bundle. `embedded` and `updated` are distinguished by
 * `isEmbeddedLaunch`, NOT by comparing version strings — the incident above is
 * exactly the case where the strings agree and the truth differs.
 */
export function describeRunningBundle(inputs: VersionInputs): string {
  if (inputs.updatesEnabled === false) return 'dev'
  if (inputs.isEmbeddedLaunch === true) return 'embedded'
  if (inputs.updateId === null || inputs.updateId === undefined || inputs.updateId === '') return UNKNOWN

  const shortId = inputs.updateId.slice(0, 8)
  const at = inputs.updateCreatedAt
  if (!at || Number.isNaN(at.getTime())) return shortId
  return `${shortId} · ${formatPublishedAt(at)}`
}

/** `YYYY-MM-DD HH:mm` in local time — a publish instant, not a duration, so it
 *  stays true whenever the operator reads it. */
function formatPublishedAt(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * The rows the Settings screen renders, in display order.
 *
 * Only `app` survives off a native binary — see {@link
 * VersionInputs.nativeBinary}. Decided HERE rather than in the screen: which
 * facts EXIST is a property of the platform, and a screen that filtered them
 * would be a second place for the answer to be wrong.
 */
export function buildVersionRows(inputs: VersionInputs): readonly VersionRow[] {
  const app: VersionRow = { id: 'app', value: text(inputs.configVersion) }
  if (inputs.nativeBinary === false) return [app]
  return [
    app,
    { id: 'build', value: text(inputs.nativeBuildNumber) },
    { id: 'runtime', value: text(inputs.runtimeVersion) },
    { id: 'update', value: describeRunningBundle(inputs) },
  ]
}
