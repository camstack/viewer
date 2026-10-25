/**
 * app-links — the two files a Universal Link / App Link needs the DOMAIN to
 * vouch for: `/.well-known/apple-app-site-association` and
 * `/.well-known/assetlinks.json`.
 *
 * Ported from camstack-link (`src/app-links.mjs`), which this server
 * supersedes: the hosted viewer PWA at https://camstack.zentik.app IS the link
 * domain now (operator decision 2026-10-06). The team id and bundle ids are
 * REDECLARED from `app.config.ts` (`ios.bundleIdentifier`, `android.package`)
 * and the hub's `well-known-app-links.ts` — different deploy units, nothing to
 * import. When those change, they change here too.
 *
 * The claimed components are the viewer's OWN expo-router paths, unprefixed:
 * on this domain the app IS mounted at `/`. Neither `/` nor `/.well-known/*`
 * is claimed — opening the bare domain must stay in the browser.
 */

/**
 * Apple team + production bundle id, mirrored from app.config.ts. Only the
 * production app claims the domain: with the dev bundle listed too, iOS was
 * free to hand a notification tap to an old dev install instead.
 */
const APPLE_TEAM_ID = 'C3F24V5NS5'
const BUNDLE_ID = 'com.apocaliss92.camstack'

export interface AasaComponent {
  readonly '/': string
  readonly comment: string
}

export interface AppleAppSiteAssociation {
  readonly applinks: {
    readonly apps: readonly string[]
    readonly details: readonly [
      { readonly appIDs: readonly string[]; readonly components: readonly AasaComponent[] },
      { readonly appID: string; readonly paths: readonly string[] },
    ]
  }
  readonly webcredentials: { readonly apps: readonly string[] }
}

export interface AssetLinkStatement {
  readonly relation: readonly string[]
  readonly target: {
    readonly namespace: string
    readonly package_name: string
    readonly sha256_cert_fingerprints: readonly string[]
  }
}

export interface AppLinkFiles {
  readonly appleAppSiteAssociation: AppleAppSiteAssociation
  readonly assetLinks: readonly AssetLinkStatement[]
}

/**
 * The route families the app opens. `/camera/*`, `/grid/*` and the two
 * prefix families are the deep links a notification mints (the same set
 * `src/navigation/pending-deep-link.ts` carries across the login); `/connect`
 * is the "add this server" link. A test asserts each one is a route the app
 * actually has.
 */
export const AASA_COMPONENTS: readonly AasaComponent[] = [
  { '/': '/camera/*', comment: 'A camera, optionally at a timeline instant' },
  { '/': '/events*', comment: 'The events timeline' },
  { '/': '/grid/*', comment: 'A saved or ad-hoc grid' },
  { '/': '/notifications*', comment: 'The notification centre' },
  { '/': '/connect', comment: 'Add or open a hub (?hub=<https origin>)' },
]

export function buildAppLinkFiles(androidCertSha256: readonly string[]): AppLinkFiles {
  const primaryAppId = `${APPLE_TEAM_ID}.${BUNDLE_ID}`
  const appIds = [primaryAppId]
  return {
    appleAppSiteAssociation: {
      applinks: {
        apps: [],
        details: [
          { appIDs: appIds, components: AASA_COMPONENTS.map((c) => ({ ...c })) },
          // Legacy `paths` block for pre-iOS-13 parsers, as the hub ships.
          { appID: primaryAppId, paths: AASA_COMPONENTS.map((c) => c['/']) },
        ],
      },
      webcredentials: { apps: appIds },
    },
    assetLinks: [BUNDLE_ID].map((pkg) => ({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: [...androidCertSha256],
      },
    })),
  }
}

const FINGERPRINT = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/

/** `CAMSTACK_ANDROID_CERT_SHA256`: comma-separated SHA-256 fingerprints.
 *  Junk and empties are dropped; none at all is a VALID (if unverifiable) file. */
export function parseCertFingerprints(raw: string | undefined): readonly string[] {
  if (raw === undefined) return []
  return raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => FINGERPRINT.test(s))
}
