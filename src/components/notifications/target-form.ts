/**
 * target-form — pure, RN-free form helpers for the Notification Center target
 * editor (B3). A {@link TargetKind} carries a `configSchema` (a `ConfigUISchema`
 * tree, typed `unknown` at the viewer bridge boundary — the server owns the
 * shape). These helpers narrow that tree structurally into a flat list of
 * renderable fields, derive the form's initial values, validate required
 * fields, and serialize the edited values back into a `Target.config` blob.
 *
 * Kept out of the React component so the parse / validate / serialize logic is
 * unit-testable in the repo's node test environment (there is no RTL render
 * infra — the same split B2 used for `nc-tabs.ts`).
 *
 * Ownership discipline (spec §5): these helpers NEVER write `ownerUserId` into
 * the config — target ownership is server-derived and lives in the open
 * `config` blob, stamped server-side. `serializeConfig` emits only declared
 * schema fields, so a client-supplied owner key can never ride along. Secrets
 * follow the redaction contract: a stored secret is blanked on read
 * ({@link configFromTarget}) and only re-sent when the user actually re-types it
 * ({@link serializeConfig}) — the server merges untouched secrets.
 */
import type { Target, TargetKind } from '../../data/notification-center.js'

/** The field-input flavours the viewer renders. Every richer `ConfigField`
 *  type collapses onto one of these (or is dropped as structural chrome). */
export type NcFormFieldType = 'text' | 'password' | 'textarea' | 'number' | 'boolean' | 'select'

/** One choice in a `select` field. Values are normalized to strings. */
export interface NcSelectOption {
  readonly value: string
  readonly label: string
}

/** A normalized, renderable field extracted from a kind's `configSchema`. */
export interface NcFormField {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly type: NcFormFieldType
  readonly required: boolean
  /** True for `password` fields — masked, redacted on read, merge-on-write. */
  readonly secret: boolean
  /** Populated for `select` only; empty otherwise. */
  readonly options: readonly NcSelectOption[]
  /** The schema-declared default (raw), consulted for initial values. */
  readonly default: unknown
  readonly placeholder?: string
}

/** The live form-state map (keyed by field `key`). */
export type NcConfigValues = Record<string, unknown>

/** The outcome of {@link validateConfig}. */
export interface NcValidationResult {
  readonly ok: boolean
  readonly missing: readonly string[]
}

// ── structural narrowing helpers (no casts) ────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function mapType(type: string | undefined): NcFormFieldType | null {
  switch (type) {
    case 'text':
    case 'password':
    case 'textarea':
    case 'number':
    case 'boolean':
    case 'select':
      return type
    // A slider is a bounded number — render it as a numeric input.
    case 'slider':
      return 'number'
    default:
      return null
  }
}

function parseOptions(options: unknown): NcSelectOption[] {
  if (!Array.isArray(options)) return []
  const out: NcSelectOption[] = []
  for (const option of options) {
    if (!isRecord(option)) continue
    const raw = option.value
    if (typeof raw !== 'string' && typeof raw !== 'number') continue
    const value = String(raw)
    out.push({ value, label: asString(option.label) ?? value })
  }
  return out
}

function toFormField(raw: Record<string, unknown>): NcFormField | null {
  const key = asString(raw.key)
  if (!key) return null
  const rawType = asString(raw.type)
  const type = mapType(rawType)
  if (!type) return null
  return {
    key,
    label: asString(raw.label) ?? key,
    description: asString(raw.description),
    type,
    required: raw.required === true,
    secret: rawType === 'password',
    options: type === 'select' ? parseOptions(raw.options) : [],
    default: raw.default,
    placeholder: asString(raw.placeholder),
  }
}

function walkFields(fields: unknown, out: NcFormField[]): void {
  if (!Array.isArray(fields)) return
  for (const raw of fields) {
    if (!isRecord(raw)) continue
    const type = asString(raw.type)
    // Layout containers hold nested fields — flatten them (values are flat).
    if (type === 'group') {
      walkFields(raw.fields, out)
      continue
    }
    if (type === 'sub-tabs') {
      if (Array.isArray(raw.tabs)) {
        for (const tab of raw.tabs) if (isRecord(tab)) walkFields(tab.fields, out)
      }
      continue
    }
    const field = toFormField(raw)
    if (field) out.push(field)
  }
}

/**
 * Structurally narrow a kind's `configSchema` into a flat, ordered list of
 * renderable fields. `group` / `sub-tabs` containers are flattened; structural
 * chrome (`separator`, `info`, …) and unsupported field types are dropped. A
 * malformed schema yields `[]` (never throws — the server owns the shape).
 */
export function parseConfigSchema(schema: unknown): NcFormField[] {
  if (!isRecord(schema)) return []
  const sections = schema.sections
  if (!Array.isArray(sections)) return []
  const out: NcFormField[] = []
  for (const section of sections) {
    if (!isRecord(section)) continue
    walkFields(section.fields, out)
  }
  return out
}

// ── value helpers ──────────────────────────────────────────────────────────

/** The form-state initial value for a freshly-created target's field. */
export function initialFieldValue(field: NcFormField): unknown {
  switch (field.type) {
    case 'boolean':
      return typeof field.default === 'boolean' ? field.default : false
    case 'select':
      if (typeof field.default === 'string') return field.default
      return field.options[0]?.value ?? ''
    case 'number':
      return typeof field.default === 'number' ? String(field.default) : ''
    default:
      return typeof field.default === 'string' ? field.default : ''
  }
}

/**
 * Build the initial form-state for creating a target of the given kind — a
 * default value for every declared field.
 */
export function buildInitialConfig(kind: TargetKind): NcConfigValues {
  const out: NcConfigValues = {}
  for (const field of parseConfigSchema(kind.configSchema)) {
    out[field.key] = initialFieldValue(field)
  }
  return out
}

function toFormValue(field: NcFormField, stored: unknown): unknown {
  if (stored === undefined || stored === null) return initialFieldValue(field)
  switch (field.type) {
    case 'boolean':
      return stored === true
    case 'number':
      return typeof stored === 'number' || typeof stored === 'string' ? String(stored) : ''
    default:
      return typeof stored === 'string' ? stored : String(stored)
  }
}

/**
 * Seed the edit form from a loaded target's stored config, blanking every
 * secret field so the input renders empty (its presence is implied server-side
 * but the value never round-trips through the client — the T5 redaction half).
 */
export function configFromTarget(kind: TargetKind, target: Target): NcConfigValues {
  const out: NcConfigValues = {}
  for (const field of parseConfigSchema(kind.configSchema)) {
    out[field.key] = field.secret ? '' : toFormValue(field, target.config[field.key])
  }
  return out
}

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (typeof value === 'number' && Number.isNaN(value))
  )
}

/** Options for {@link validateConfig}. */
export interface ValidateConfigOptions {
  /**
   * Secret field keys whose stored value is kept server-side (edit flow). A
   * required secret listed here is NOT flagged when left blank — leaving it
   * empty means "keep the saved secret".
   */
  readonly keepSecretKeys?: readonly string[]
}

/**
 * Validate the form against the kind's required fields. Booleans are never
 * "missing" (`false` is a valid value). The server remains the validation
 * authority — this only gates the local submit so we do not fire an obviously
 * incomplete request; any server rejection is surfaced verbatim by the form.
 */
export function validateConfig(
  kind: TargetKind,
  values: NcConfigValues,
  options: ValidateConfigOptions = {},
): NcValidationResult {
  const keep = new Set(options.keepSecretKeys ?? [])
  const missing: string[] = []
  for (const field of parseConfigSchema(kind.configSchema)) {
    if (!field.required || field.type === 'boolean') continue
    if (field.secret && keep.has(field.key)) continue
    if (isEmpty(values[field.key])) missing.push(field.key)
  }
  return { ok: missing.length === 0, missing }
}

/**
 * Serialize the form-state into the `config` blob to persist. Booleans are
 * coerced, numbers parsed, untouched secrets omitted (blank secret ⇒ server
 * keeps the stored value). Only declared schema fields are emitted — so no
 * client-supplied `ownerUserId` (or any other stray key) can leak in.
 */
export function serializeConfig(kind: TargetKind, values: NcConfigValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of parseConfigSchema(kind.configSchema)) {
    const value = values[field.key]
    if (field.type === 'boolean') {
      out[field.key] = value === true
      continue
    }
    if (field.secret) {
      // Secret-merge: send only when re-typed to a non-empty value.
      if (!isEmpty(value)) out[field.key] = value
      continue
    }
    if (field.type === 'number') {
      if (isEmpty(value)) continue
      const parsed = typeof value === 'number' ? value : Number(value)
      out[field.key] = Number.isNaN(parsed) ? value : parsed
      continue
    }
    out[field.key] = value
  }
  return out
}

/** Arguments for {@link buildTargetPayload}. */
export interface BuildTargetArgs {
  readonly kind: TargetKind
  /** The target being edited, or `null` when creating. */
  readonly existing: Target | null
  readonly name: string
  readonly values: NcConfigValues
}

/**
 * Assemble the {@link Target} to send to `upsertMyTarget`. On edit, the id and
 * enabled flag are carried from the existing row; the config is the freshly
 * serialized form (NOT merged with the stored blob) so redacted secrets and the
 * server-owned `ownerUserId` are never echoed back — the server merges untouched
 * secrets and re-stamps ownership.
 */
export function buildTargetPayload({ kind, existing, name, values }: BuildTargetArgs): Target {
  return {
    id: existing?.id ?? `${kind.kind}-${Date.now()}`,
    name,
    kind: kind.kind,
    addonId: kind.addonId,
    enabled: existing?.enabled ?? true,
    config: serializeConfig(kind, values),
  }
}
