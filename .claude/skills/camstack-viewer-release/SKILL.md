---
name: camstack-viewer-release
description: Use when shipping the CamStack viewer — an OTA (`npm run update:patch`), a native iOS/Android store release (`release:ios:*` / `release:android:*`), a version bump, the hub web bundle (`build:orchestrator`), or advancing the `camstack/` submodule pin in camstack-server. Also for red viewer CI, EAS build failures, rotted patch-package patches, and the what's-new release notes.
---

# Shipping the CamStack viewer

The viewer is github.com/camstack/viewer, consumed by camstack-server as the
`camstack/` git submodule. One bundle reaches the operator three ways: the phone
(EAS OTA or a store binary), the browser and desktop shell (the web bundle the
hub serves at `/viewer/camstack/`), and camstack-server's record of which viewer
is current (the submodule pin plus the committed web bundle). Ship all three.

## 0. `verify:push` GREEN, then check CI

**Before every commit that will ship (and before `update:patch`)** — in the
viewer checkout:

```bash
npm run verify:push          # GREEN — same gates as TypeScript Check + ui:check
```

It takes the changed set (merge-base with `origin/main` + working tree) and
runs `ts-check`, full `test:v2`, native-deps when lock/config moved, embed
build when `embed/` moved, and `ui:check` on touched UI files. A single green
vitest file is not enough — that is how wiring-spec drift reached OTA.

A red CI does not block `update:patch` — the OTA goes out regardless, and a
broken build rides along for days. Before shipping, still look at CI:

```bash
gh run list --repo camstack/viewer --limit 5
gh run view <id> --repo camstack/viewer --log-failed | tail -40
```

The job is called `TypeScript Check` (`.github/workflows/typecheck.yml`: Node 24,
`npm ci`, `npm run ts-check`, `npm run test:v2`, embed build) and it often dies
in **`npm ci`**, before `tsc` runs. Read the failing step, not the job name.
Nobody runs `npm ci` locally, so anything only a clean install exercises is
visible only in CI — the three known members of that class are below (patch
rot, `@types` upward resolution, lockfile desync). After pushing a fix, watch
the run to its end.

## 1. Write the what's-new entry FIRST

`src/app/whats-new.ts`, at the TOP of `WHATS_NEW`, for the version the ship
script is about to write (current `package.json` version + the bump):

- one line per change, naming WHAT is fixed or new — never why, how, the
  trade-off or the incident;
- **under 90 characters, never over 140**; English AND Italian, same brevity;
- `date` = ISO date of the ship.

```
✅ 'Live view no longer stops after two hours of watching.'
❌ 'Clips start faster. When a camera's list comes up, the hub now fetches its
    newest few clips in the background, so the first ones you open are …'
```

**Enforced:** `scripts/update.js`, `scripts/release-ios.js` and
`scripts/release-android.js` run `scripts/lib/check-whats-new.js` before any
bump, and abort with no file, git or EAS side effect when the entry is missing,
not first, lacks `en` or `it`, or has a line over 140 characters. Check it
yourself before shipping:

```bash
node scripts/lib/check-whats-new.js            # next patch (minor|major also accepted)
node scripts/lib/check-whats-new.js --version 1.2.3
```

`--skip-whats-new` on a ship script bypasses it (loudly) — for an emergency
only; the CI spec `src/app/__tests__/whats-new.spec.ts` will then go red on the
shipped version until the entry is added. Commit the entry before shipping:
`update.js` commits only the version/lockfile/embed files.

## 2. The ship chain (OTA)

```bash
# in the viewer checkout (clean, on main, up to date)
npm run update:patch            # gate → staleness check → bump → lockfile sync → sync:embed → eas update → commit + push
npm run build:orchestrator      # EXPO_PUBLIC_WEB_BASE_PATH=/viewer build:web + copy into the orchestrator
# in camstack-server
camstack deploy packages/addon-pipeline-orchestrator
git add camstack packages/addon-pipeline-orchestrator/assets/viewer   # pin + embedded web bundle
git commit -m "chore: viewer v<version>" && git push
```

- `update.js` refuses a checkout behind its upstream (an OTA bundles the working
  tree — a stale tree is a rollback for every device). `--allow-stale` is for a
  deliberate hotfix from an older tree.
- `build:orchestrator` writes `../packages/addon-pipeline-orchestrator/assets/viewer/`
  (relative to the viewer), so it only works from the submodule checkout inside
  camstack-server, and stamps `.viewer-version` there. There is no deployable
  `addon-viewer-ui` package.
- camstack-server has `node scripts/ship-viewer.mjs` (does the whole chain and
  verifies the hub serves the new version before pinning) and
  `node scripts/ship-viewer.mjs --check` (verifies OTA, bundle and pin agree).
  Use `--check` after any manual chain.
- An OTA from a standalone clone does NOT move the pin. Pull the submodule to
  the shipped commit before `build:orchestrator`, or the hub serves the old app.

## 3. runtimeVersion: OTA vs native release

`app.config.ts` derives `version` from `package.json`; `runtimeVersion` is a
literal on purpose — it is the OTA compatibility pin.

- **OTA** (`update:patch|minor|major`, JS/assets only): bumps `package.json`
  only; `runtimeVersion` stays FIXED. An OTA reaches only installs whose
  `runtimeVersion` matches.
- **Native release** (`release:ios:*`, `release:android:*`; native code, native
  deps, plugins or `app.config.ts`): bumps `package.json`, sets
  `runtimeVersion` to the new version, bumps `buildNumber` (iOS) / `versionCode`
  (Android), runs `npx eas build --profile production --auto-submit-with-profile
  production --no-wait`, commits and pushes. iOS also writes
  `public/native-release.json` (served by the hub after the next
  `build:orchestrator`). On failure `app.config.ts` is restored from `.backup`.
- Never bump `runtimeVersion` in an OTA; always in a native release. Usual
  cadence: one store build, then OTA patches until the next native change.

## 4. EAS gotchas

- **Node is pinned to 24.17.0** in all three `eas.json` profiles, `.nvmrc` = 24,
  and CI uses Node 24. npm 10 and npm 11 place some transitive deps differently,
  so a lockfile written by one fails `npm ci` under the other ("Missing: ws@…
  from lock file"). Change the Node pin only together: `eas.json`, `.nvmrc`,
  `typecheck.yml`, and a lockfile regenerated with the matching npm.
- **Lockfile sync on bump.** The lockfile's root `version` must follow
  `package.json` or EAS `npm ci` fails. All three ship scripts run
  `npm install --package-lock-only` after the bump and commit `package-lock.json`.
- **`eas-cli` is not a dependency.** `npx eas` fails with "could not determine
  executable to run" without it; install `npm i -g eas-cli` (bin: `eas`).
- **`EXPO_TOKEN` inline, never persisted:** `EXPO_TOKEN=<token> eas …`. Never
  write it to a file, env file or shell profile.
- **Diagnose a failed build:** `eas build:list --platform ios --limit 1`, then
  `eas build:view <id> --json` (the `error` field). For the phase logs, GraphQL:
  `POST https://api.expo.dev/graphql` with
  `{"query":"{builds{byId(buildId:\"<id>\"){logFiles error{message}}}}"}` and
  `Authorization: Bearer $EXPO_TOKEN`; fetch each `logFiles` URL
  (newline-delimited JSON, grep `msg`).
- Manual blocks: `npx eas build --platform ios --profile production`,
  `npx eas submit --platform ios --latest`,
  `npx eas update --environment production --channel production --auto`.

## 5. patch-package rot

`postinstall` runs `patch-package` on `patches/` (currently
`react-native-webrtc+124.0.7.patch`). A patch is pinned to the version it was
cut from; when the dependency moves, `patch-package` refuses it and `npm ci`
fails. Before deleting a rotted patch, prove the fix is upstream — from the
REGISTRY, not `node_modules` (which may itself be patched):

```bash
cd "$(mktemp -d)" && npm pack <pkg>@<installed-version> && tar -xzf *.tgz
grep -c "<a symbol from the patch body>" package/<file>
```

Present: `git rm` the patch. Absent: the behaviour has been silently missing
since the bump — re-cut the patch against the installed version and say so.

## 6. The `@types` upward-resolution trap

This checkout usually lives inside camstack-server, and TypeScript resolves an
explicit import's `@types/*` by walking `node_modules` upwards — no tsconfig
setting stops it (`typeRoots` governs ambient globals only). Local `ts-check`
can be green on a package the viewer does not declare; CI, which checks the
repo standalone, goes red. Every `@types/*` an import needs must be in THIS
`package.json`. (`@camstack/*` is already closed: `tsconfig.json` resolves the
published packages; `tsconfig.workspace.json` is the deliberate opt-in to the
server source.)

## 7. Web base path

`npm run build:web` exports a static SPA to `dist/`.
`EXPO_PUBLIC_WEB_BASE_PATH=/viewer` makes `app.config.ts` set
`experiments.baseUrl` to `/viewer/camstack`, so every asset URL matches the
hub mount; a build without it renders blank under the hub. Always ship the hub
bundle through `npm run build:orchestrator`, which sets it. (`build:ha-addon`
and `build:web:embedded` are legacy targets from the pre-hub app; they are not
part of the ship chain.)

## Before you call it shipped

- CI green on the commit you shipped (watched, not assumed).
- `node scripts/lib/check-whats-new.js --version <shipped>` passes.
- `eas update:list` shows the update on channel `production`.
- The hub serves the new `.viewer-version`; the submodule pin and the embedded
  bundle are committed in camstack-server (`node scripts/ship-viewer.mjs --check`).
