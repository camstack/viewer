# srcV2 Login (admin-ui style) + ServerProvider + Settings — Plan

> RN glue + one TDD module. Gate: `npm run test:v2` + `npm run ts-check`. Dev server runs with watch → phone hot-reloads during iteration.

**Goal:** Replace srcV2's minimal "paste a token" form with the **same login experience as the admin-ui** (server URL + username/password, optional TOTP), persist the server **on first login**, and make it **editable in Settings**.

**Auth flow (verified):** `createSystem({ serverUrl })` (tokenless) → `system.login(username, password)` → `{ token, requiresTotp? }`. If `requiresTotp`, the returned `token` is a short-lived challenge → `system.loginVerifyTotp(challengeToken, code)` → `{ token }`. `auth.login`/`auth.loginVerifyTotp` are PUBLIC. Persist `{ serverUrl, token }`; the authenticated `ConnectionProvider` then mounts with that token. (Default password `changeme` → server expects a change; deferred — note only.)

**Admin-ui login design (to mirror):** centered card (~max-w-sm), brand logo on top, username + password (password reveal toggle), error alert, primary "Log in" button with loading state, optional second TOTP phase (6-digit). Tokens: `surface`/`background`/`border`/`foreground`/`foregroundMuted`/`primary`/`primaryForeground`/`danger`. Mobile ADDS a **server URL** field (admin-ui is same-origin; the viewer is not).

---

## Files

- `srcV2/auth/login.ts` (+ test) — pure auth orchestration over an injected `createAuthClient` (TDD).
- `srcV2/app/ServerProvider.tsx` — context over `ServerStore` (shared active-server state: `{ loading, server, token, save, signOut }`). Replaces per-screen `useActiveServer`.
- `srcV2/screens/LoginScreen.tsx` — admin-ui-style login (serverUrl + username + password + TOTP phase), camstack-themed.
- `srcV2/screens/SettingsScreen.tsx` — current server URL, **Change server / Sign out**.
- `app/settings.tsx` — Expo Router route rendering `SettingsScreen`.
- Edits: `RootProviders` mounts `ServerProvider`; `AppRoot` consumes `useServer()` and renders `LoginScreen` when no server/token; `CamerasScreen` gains a gear → `router.push('/settings')`.

---

### Task 1 — auth/login.ts (TDD)

`srcV2/auth/login.ts`:
```typescript
import { createSystem } from '@camstack/sdk'

/** Subset of the SDK System used for the public login procedures. */
export interface AuthClient {
  login(username: string, password: string): Promise<{ token: string; requiresTotp?: boolean }>
  loginVerifyTotp(challengeToken: string, code: string): Promise<{ token: string }>
}

export type CreateAuthClient = (serverUrl: string) => AuthClient

/** Default: a tokenless SDK System (login/verifyTotp are public procedures). */
export const sdkAuthClient: CreateAuthClient = (serverUrl) => createSystem({ serverUrl })

export interface LoginOutcome {
  /** 'success' → `token` is a session JWT; 'totp-required' → `token` is the challenge. */
  readonly status: 'success' | 'totp-required'
  readonly token: string
}

export async function login(
  serverUrl: string,
  username: string,
  password: string,
  create: CreateAuthClient = sdkAuthClient,
): Promise<LoginOutcome> {
  const { token, requiresTotp } = await create(serverUrl).login(username, password)
  return { status: requiresTotp ? 'totp-required' : 'success', token }
}

export async function verifyTotp(
  serverUrl: string,
  challengeToken: string,
  code: string,
  create: CreateAuthClient = sdkAuthClient,
): Promise<{ token: string }> {
  return create(serverUrl).loginVerifyTotp(challengeToken, code)
}
```

Test `srcV2/auth/__tests__/login.spec.ts` (hand-written fake `create`, no vi.mock):
```typescript
import { describe, it, expect, vi } from 'vitest'
import { login, verifyTotp, type AuthClient } from '../login.js'

function fakeCreate(client: Partial<AuthClient>): (url: string) => AuthClient {
  return () => ({
    login: vi.fn(async () => ({ token: 'sess' })),
    loginVerifyTotp: vi.fn(async () => ({ token: 'sess' })),
    ...client,
  }) as AuthClient
}

describe('login', () => {
  it('returns success + session token when TOTP not required', async () => {
    const out = await login('https://h:4443', 'u', 'p', fakeCreate({ login: async () => ({ token: 'jwt' }) }))
    expect(out).toEqual({ status: 'success', token: 'jwt' })
  })
  it('returns totp-required + challenge token when requiresTotp', async () => {
    const out = await login('https://h:4443', 'u', 'p', fakeCreate({ login: async () => ({ token: 'chal', requiresTotp: true }) }))
    expect(out).toEqual({ status: 'totp-required', token: 'chal' })
  })
})

describe('verifyTotp', () => {
  it('returns the session token from the second leg', async () => {
    const out = await verifyTotp('https://h:4443', 'chal', '123456', fakeCreate({ loginVerifyTotp: async () => ({ token: 'jwt2' }) }))
    expect(out).toEqual({ token: 'jwt2' })
  })
})
```
TDD: test fails (no module) → implement → pass (3) → commit.

### Task 2 — ServerProvider + AppRoot refactor + LoginScreen
- `ServerProvider`: lift the `useActiveServer` logic into a context (`useServer()`), mounted inside `RootProviders` (after ThemeProvider). Same API `{ loading, server, token, save, signOut }`.
- `AppRoot`: use `useServer()`; if `!server || !token` → `<LoginScreen/>`; else `<ConnectionProvider config={{serverUrl, token, candidates:[serverUrl]}}><CamerasScreen/></ConnectionProvider>`.
- `LoginScreen`: read the admin-ui `packages/addon-admin-ui/src/pages/Login.tsx` for design fidelity; build a centered card with the viewer logo (`assets/icons/logo.png`), a **server URL** field (default `https://`), username, password (with reveal toggle), error alert, "Accedi" primary button + loading; on submit call `login(serverUrl, user, pass)`; if `totp-required`, swap to a 6-digit code phase calling `verifyTotp(serverUrl, challenge, code)`; on success call `server.save({ id: serverUrl, label: serverUrl, serverUrl }, token)`. camstack-themed via `useTheme().colors` + SPACING/RADIUS.

### Task 3 — Settings + route + gear
- `SettingsScreen`: shows the active server URL + a "Cambia server" action (signOut → returns to LoginScreen, preserving nothing sensitive) and an explicit "Esci" (signOut). camstack-themed.
- `app/settings.tsx`: `export default` rendering `<SettingsScreen/>` (relative import `../srcV2/screens/SettingsScreen`).
- `CamerasScreen`: add a header row with a gear icon button → `useRouter().push('/settings')`.

### Gate
- `npm run test:v2` (existing + 3 new login tests).
- `npm run ts-check` — no new errors in `srcV2/`/`app/`.

## Out of scope / notes
- `changeme` forced-password-change flow, external auth providers ("Or continue with"), and LAN endpoint re-race after login (the `SystemController` already re-races) — later.
- Real navigation chrome (tab bar) comes with the grid/live screens; for now Settings is a pushed route reachable from the Cameras gear.

## Self-Review
- Login mirrors admin-ui (server URL added for mobile); persists on first login (`ServerProvider.save`); editable via Settings (shared `useServer()` context propagates changes). ✓
- One TDD module (auth/login) with injected client; rest is RN glue (ts-check). ✓
- Reuses `ServerStore`, `ConnectionProvider`, `ThemeProvider`. ✓
