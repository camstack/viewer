/**
 * What the Enter / return key does in each login field.
 *
 * Web: Enter SUBMITS from every field, as any browser form does — the hosted
 * PWA's login ignored Enter entirely because no field had a submit handler
 * (operator report 2026-10-06). Native: the keyboard's return key walks the
 * fields (`next`) and the last one signs in (`go`).
 *
 * Every login surface — the auth gate, "Add server", `/connect` — is the one
 * `LoginScreen`, so this is the only place the rule lives.
 */
export type LoginField = 'serverUrl' | 'username' | 'password' | 'totp'

export type LoginEnterAction =
  | { readonly kind: 'submit' }
  | { readonly kind: 'focus'; readonly field: LoginField }

export type LoginReturnKey = 'next' | 'go'

const NEXT_FIELD: Readonly<Partial<Record<LoginField, LoginField>>> = {
  serverUrl: 'username',
  username: 'password',
}

export function loginEnterAction(field: LoginField, os: string): LoginEnterAction {
  const next = NEXT_FIELD[field]
  if (os === 'web' || next === undefined) return { kind: 'submit' }
  return { kind: 'focus', field: next }
}

export function loginReturnKey(field: LoginField): LoginReturnKey {
  return NEXT_FIELD[field] === undefined ? 'go' : 'next'
}
