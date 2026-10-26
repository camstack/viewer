/**
 * notification-center — the viewer's typed client onto the Notification Center
 * server surface. The viewer NEVER adds a cap method: every read/write rides the
 * `addons.custom` bridge (`{ addonId, action, input }` → `unknown`) with a
 * per-action `nc.*` name, and each addon enforces its own auth + ownership
 * server-side (spec C1/C2). Two addons back the surface:
 *
 *   • rules    → `addonId: 'pipeline-analytics'` (nc.listRules, nc.createRule, …)
 *   • targets  → `addonId: 'notifiers'` (nc.listMyTargets, nc.upsertMyTarget, …)
 *
 * The Zod schemas below are viewer-LOCAL mirrors of the server contracts
 * (`@camstack/types` `notification-rules.cap.ts` / `notification-output.cap.ts`
 * plus the A1 additive fields: `ownerUserId`, `disabledTargetIds`, inline
 * `customZones` polygons, and the `polygonDraw` catalog widget). They validate
 * every bridge response at the boundary — Zod strips unknown keys, so a server
 * that grows additive fields never throws here. `makeNcClient` takes the
 * `addons.custom` mutate delegate as its single dependency, which keeps it a
 * pure, unit-testable seam (the transport is wired in `use-notification-center`).
 */
import { z } from 'zod'
import { type NcListPrunesResult, NcListPrunesResultSchema } from './nc-prunes.js'
import {
  type AlarmArmMode,
  type NcAlarmArmOutcome,
  NcAlarmArmOutcomeSchema,
  type NcAlarmConfig,
  NcAlarmConfigSchema,
  type NcAlarmSensors,
  NcAlarmSensorsSchema,
  type NcAlarmSettingsPatch,
  type NcAlarmStatus,
  NcAlarmStatusSchema,
} from './nc-alarm.js'
import {
  NC_CONSUMABLE_LOW_PERCENT_MAX,
  NC_GROUPING_MAX_SEC,
  NC_GROUPING_MIN_SEC,
  TimelapseRuleSchema,
  isSystemRuleKind,
  systemEventKindsOfFamily,
  systemFamilyOfKind,
} from '@camstack/types/client'
import type { TimelapseRuleInput, TimelapseRulePatch } from '@camstack/types'

// ── Geometry (mirrors @camstack/types mask-shape.ts) ───────────────────────

/** A normalized 0..1 point (top-left origin). */
export const NcMaskPointSchema = z.object({ x: z.number(), y: z.number() })
export type NcMaskPoint = z.infer<typeof NcMaskPointSchema>

/** Free polygon — an ordered list of normalized vertices. Personal-rule zones. */
export const NcMaskPolygonShapeSchema = z.object({
  kind: z.literal('polygon'),
  points: z.array(NcMaskPointSchema),
})
export type NcMaskPolygonShape = z.infer<typeof NcMaskPolygonShapeSchema>

// ── Rule domain (mirrors notification-rules.cap.ts + A1 additive fields) ────

/** The trigger/urgency of a rule — which persistence moment evaluates it. */
export const NcDeliverySchema = z.enum([
  'immediate',
  'track-end',
  'device-event',
  'package-event',
  'system-event',
])
export type NcDelivery = z.infer<typeof NcDeliverySchema>

/**
 * The stable NC vocabulary over infrastructure/liveness events (mirrors the
 * cap's `NcSystemEventKindSchema` MEMBER FOR MEMBER, legacy tail included).
 *
 * A rule is parsed PER RULE: a kind this build cannot decode does not cost the
 * condition one field, it costs the operator the WHOLE rule — `safeParse` fails
 * and the rule disappears from the list. So the enum carries everything the hub
 * can serve, and the AUTHORABLE subset (what the editor offers) is a separate
 * list in `rule-editor.ts`.
 */
export const NcSystemEventKindSchema = z.enum([
  // Liveness is a DEVICE fact, not a camera fact — the hub emits these for
  // every device type it knows (a camera, a plug, a sensor, a container), and
  // "which of them do I care about" is `deviceTypes` on the rule.
  'device-online',
  'device-offline',
  // The operator's SWITCH, which is not liveness and is never worded as if it
  // were (D62): a device someone turned off is reported OFF, never offline and
  // never broken.
  'device-disabled',
  'device-enabled',
  // Sustained STATES, not moments — driven by a durable episode rather than a
  // bus event, with a cluster-wide re-notify interval. They land in the viewer
  // BEFORE the hub serves them: an option this list does not recognise is
  // dropped, so learning them second would hide a condition just created.
  'device-battery-low',
  'device-battery-normal',
  // The same pair for a CONSUMABLE (a filter, a brush, a mop pad) — the
  // subject carries the item, so one device can raise several.
  'device-consumable-low',
  'device-consumable-normal',
  'stream-online',
  'stream-offline',
  'node-online',
  'node-offline',
  // A node announcing its OWN restart (hub D722): a plain restart, and the
  // restart an update drives (node, package, from → to). Missing here, a rule
  // carrying one would fail safeParse and vanish from the phone.
  'node-restarting',
  'node-updating',
  // ── THE TWO SILENT FAILURES ─────────────────────────────────────────────
  // Both report a component that is UP and PRODUCING NOTHING, the one shape
  // ordinary liveness cannot express: the node answers, the camera decodes,
  // the session is open — and no work comes out.
  //
  // `node-inference-unavailable`: every accelerator the operator enabled on a
  // node reads unavailable to the live probe, so the node keeps looking
  // healthy and fails every inference it is handed. The orchestrator also
  // drops it from placement, so this is the only notice that the cluster just
  // got smaller.
  //
  // `detection-blind`: a camera with an OPEN detection session that has
  // produced no detection for the blind threshold. A blind camera and a quiet
  // camera are byte-identical in every other signal.
  //
  // Neither has a paired "recovered" kind — that is deliberate on the hub.
  'node-inference-unavailable',
  'detection-blind',
  // D907: constant motion with no subject (weather, foliage, IR noise) — its
  // own paired class, never reported as `detection-blind`.
  'motion-noisy',
  'motion-calm',
  // D931: a packages rule's LLM confirm failed closed three times, then
  // answered again. One open notice per camera.
  'package-llm-silent',
  'package-llm-answered',
  // D911: a critical alert whose source is a DEVICE (a camera without its
  // PIN) — raised and resolved, in the devices family.
  'device-attention-required',
  'device-attention-resolved',
  // Recording that should be writing and is not (stall / restart storm), plus
  // recovery. Split kinds so a "stall only" rule does not announce cameras
  // that came back. Missing here, a rule carrying one vanishes on the phone.
  'recording-stalled',
  'recording-healthy',
  'recording-degraded',
  // Storage location free-space bands (or an unreadable capacity probe).
  'storage-location-low',
  'storage-location-critical',
  'storage-location-ok',
  // `addon-crash-loop`: the D6 crash circuit-breaker having given up — NODE
  // scoped, carries no device, terminal until an operator acts. Missing from
  // this mirror until 2026-08-19: a rule authored with it in the admin UI
  // failed safeParse here and vanished from the phone entirely.
  'addon-crash-loop',
  'addon-update-available',
  'server-update-available',
  // The node's container IMAGE is behind — purely informative (D437).
  // Published since types 1.2.247 and missing here until D3: a rule carrying
  // it failed safeParse and vanished from the phone.
  'wrapper-update-available',
  'addon-updated',
  'server-updated',
  'export-completed',
  // A whole backup RUN, not one destination (same history as above).
  'backup-completed',
  // The alarm panel's own lifecycle — ordinary system events, no branch. In
  // LIFECYCLE order, which is the order the editor lists them and the order a
  // person experiences them.
  'alarm-arm-refused',
  // The arm went ahead because the openings could not be read (D49: an
  // unreadable state never blocks, and never goes unreported).
  'alarm-check-failed',
  'alarm-arming',
  'alarm-armed',
  // The entry delay started: a covered sensor tripped and the siren follows
  // unless someone disarms first.
  'alarm-pending',
  'alarm-triggered',
  // The panel re-armed itself after a bounded siren.
  'alarm-rearmed',
  // A covered sensor was bypassed or restored.
  'alarm-sensor-bypass',
  'alarm-disarmed',
  // The alert centre's episodes: a critical or error alert reaches the
  // operator only through a rule on these. Published since types 1.2.387.
  'alert-critical',
  'alert-error',
  'alert-critical-resolved',
  // A notification rule that cannot work (it no longer loads, or still names a
  // deleted device / destination) and its repair — hub D905.
  'rule-broken',
  'rule-repaired',
  // ── LEGACY TAIL — parsed, never produced, never OFFERED ─────────────────
  // Pre-generic names frozen onto history rows and onto rules authored before
  // the rename. They stay so those still parse; no editor offers them (the
  // hub's `NC_AUTHORABLE_SYSTEM_EVENT_KINDS` excludes them), and a rule still
  // carrying one has no family — it classifies `mixed` and is shown read-only.
  'camera-online',
  'camera-offline',
  'camera-disabled',
  'camera-enabled',
])
export type NcSystemEventKind = z.infer<typeof NcSystemEventKindSchema>

export const NcSystemEventConditionSchema = z.object({
  kinds: z.array(NcSystemEventKindSchema).min(1),
  deviceIds: z.array(z.number().int()).min(1).optional(),
  /**
   * Narrow a `device-*` kind to these device TYPES (`camera`, `switch`,
   * `sensor`, …). Absent = every type.
   *
   * Mirrored the moment the cap gained it: this schema is what a rule is parsed
   * INTO and written back OUT, and `formToInput` re-emits `conditions` as a
   * FULL replacement — so an unmirrored field is STRIPPED the first time the
   * rule is saved from the phone.
   */
  deviceTypes: z.array(z.string().min(1)).min(1).optional(),
  /**
   * Devices the rule NEVER speaks about — include first, then exclude (D636).
   * Same family as `deviceIds`; a consumable subject is excluded by its device.
   * Mirrored for the reason above: an unmirrored key is stripped on a phone
   * save (`scripts/check-nc-mirrors-in-sync.ts` compares the keys).
   */
  excludeDeviceIds: z.array(z.number().int()).min(1).optional(),
  nodeIds: z.array(z.string().min(1)).min(1).optional(),
  packageNames: z.array(z.string().min(1)).min(1).optional(),
  /**
   * The rule's own consumable threshold (D642): an item at or below this
   * percentage is low FOR THIS RULE. Absent = the hub's default (15). Speaks
   * only about the consumable kinds, on a device-events rule. Capped at
   * `NC_CONSUMABLE_LOW_PERCENT_MAX` (95): above it the +5 recovery passes
   * 100 % and an episode could never clear. Unmirrored, a phone save
   * stripped it and the rule silently fell back to 15 %.
   */
  consumableLowPercent: z.number().int().min(1).max(NC_CONSUMABLE_LOW_PERCENT_MAX).optional(),
})
export type NcSystemEventCondition = z.infer<typeof NcSystemEventConditionSchema>

/** One weekly activation window. */
export const NcScheduleWindowSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
})
export type NcScheduleWindow = z.infer<typeof NcScheduleWindowSchema>

/** Weekly schedule — OR of windows; absence on the rule = always active. */
export const NcScheduleSchema = z.object({
  windows: z.array(NcScheduleWindowSchema).min(1),
  timezone: z.string().optional(),
  invert: z.boolean().optional(),
})
export type NcSchedule = z.infer<typeof NcScheduleSchema>

/**
 * How a `device-events` / `system` rule speaks (D647): a notification per
 * event (`instant`, the only behaviour before D647), or a STATE SUMMARY sent
 * when each window of `schedule` CLOSES — the current state of its kinds, and
 * nothing at all when there is nothing to report. The alarm stays instant.
 */
export const NcSystemEventDeliveryModeSchema = z.enum(['instant', 'summary'])
export type NcSystemEventDeliveryMode = z.infer<typeof NcSystemEventDeliveryModeSchema>

/**
 * How a summary window is SENT (D698): `rule` (absent) = one message with every
 * category; `section` = one notification per category with something to say.
 */
export const NcStateSummarySplitSchema = z.enum(['rule', 'section'])
export type NcStateSummarySplit = z.infer<typeof NcStateSummarySplitSchema>

export const NcSystemEventDeliverySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('instant') }),
  z.object({ mode: z.literal('summary'), schedule: NcScheduleSchema, split: NcStateSummarySplitSchema.optional() }),
])
export type NcSystemEventDelivery = z.infer<typeof NcSystemEventDeliverySchema>

/**
 * Fuzzy plate matcher (OCR noise makes exact match useless).
 *
 * `values` HAS NO `.min(1)`, and that absence is the contract: an EMPTY list
 * means **any plate the pipeline could read** — the switch that says the rule is
 * about vehicles that were IDENTIFIED rather than merely seen. A subject
 * carrying no plate still fails.
 *
 * The `.min(1)` this mirror used to carry did not merely make that state
 * unauthorable from the phone — `safeParse` FAILED on such a rule, and a rule
 * that fails to parse is dropped from the list entirely (see
 * {@link NcListRulesResultSchema}). A rule the admin UI authored as "any
 * readable plate" was invisible on the phone, not merely uneditable.
 */
export const NcPlateMatcherSchema = z.object({
  /** Plate texts (or gallery vehicle names). EMPTY = any readable plate. */
  values: z.array(z.string().min(1)),
  /** Max Levenshtein distance after normalization (uppercase alphanumeric). */
  maxDistance: z.number().int().min(0).max(3).default(1),
})
export type NcPlateMatcher = z.infer<typeof NcPlateMatcherSchema>

/**
 * Admin-zone membership condition (zone IDs as stamped by the ZoneEngine).
 *
 * `match` is READ, never written: the any/all quantifier left both editors on
 * 2026-10-01 (a zone is simply included or excluded), and the hub reads an
 * absent one as any. It stays optional here so a stored rule still parses —
 * no `.default()`, which would make every re-save WRITE the key.
 */
export const NcZoneConditionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  match: z.enum(['any', 'all']).optional(),
})
export type NcZoneCondition = z.infer<typeof NcZoneConditionSchema>

/**
 * Gate on ANOTHER device's current state — the alarm armed, a switch on.
 * Mirrored the moment the cap gained it: an unmirrored field is STRIPPED when
 * the rule is saved from the phone, which is how this rule set once lost its
 * media policy.
 */
export const NcDeviceStateConditionSchema = z.object({
  deviceId: z.number().int(),
  states: z.array(z.string().min(1)).min(1),
})
export type NcDeviceStateCondition = z.infer<typeof NcDeviceStateConditionSchema>

/**
 * Gate on a SCENE's state — "only while the bin is still out".
 *
 * A GATE, not a trigger: it narrows a rule that already has one, exactly like
 * `deviceState` above and unlike `occupancy` / `audio`, which discriminate what
 * their rule fires on.
 *
 * `sceneId` is the scene monitor's uuid; `latched` ABSENT means "follow the
 * scene's own `emit` setting", which is a third, authorable state and not a
 * missing boolean — so it must round-trip as absent rather than being
 * normalised to `false`.
 *
 * Mirrored the moment the cap gained it: an unmirrored field is STRIPPED when
 * the rule is saved from the phone, which is how this rule set once lost its
 * media policy and then every occupancy condition after it.
 */
export const NcSceneConditionSchema = z.object({
  sceneId: z.string().min(1),
  deviceId: z.number().int().optional(),
  requiredState: z.enum(['matched', 'diverged']),
  latched: z.boolean().optional(),
})
export type NcSceneCondition = z.infer<typeof NcSceneConditionSchema>

/**
 * A ZoneAnalytics count edge — "the driveway became occupied by 2 people and
 * stayed that way for 15 seconds". Rides the existing `device-event` delivery.
 *
 * The five fields only mean anything as a SET (a threshold without its op is
 * not a condition), which is why the widget edits them together. Defaults
 * mirror `NcOccupancyConditionSchema` verbatim — an untouched sub-field must
 * author exactly what the hub would have applied.
 */
export const NcOccupancyConditionSchema = z.object({
  /** Admin zone id to scope the count to; absent = whole-frame occupancy. */
  zoneId: z.string().optional(),
  /** Object class to count; absent = any class. */
  className: z.string().optional(),
  op: z.enum(['became-occupied', 'became-free', '>=', '<=']).default('became-occupied'),
  count: z.number().int().min(0).default(1),
  sustainSeconds: z.number().int().min(0).max(3600).default(15),
})
export type NcOccupancyCondition = z.infer<typeof NcOccupancyConditionSchema>

/**
 * The dBFS floor the analyzer reports on digital silence (mirrors the cap's
 * `NC_AUDIO_DBFS_FLOOR`).
 *
 * The scale is dBFS and it is NEGATIVE-GOING: `0` is full scale and silence
 * reads as a large negative number. A control that let an operator author `60`
 * meaning "quite loud" would write a threshold no sample can ever reach, and
 * the rule would look broken rather than mis-configured — so the bound is here,
 * on the schema, and the widget clamps to it.
 */
export const NC_AUDIO_DBFS_FLOOR = -96

/**
 * A sustained-sound matcher (IMMEDIATE trigger) — a rule on SOUND, not on a
 * picture. Over a window of `samplingSeconds`, at least `hitPercent`% of the
 * audio samples must be HITS; a sample is a hit when it satisfies BOTH present
 * filters (`dbThreshold` level floor, `labels` classifier match).
 *
 * Both filters are optional and independent — a loudness rule needs no model
 * and a label rule needs no threshold — but the engine FAILS CLOSED when
 * neither is given (every sample would trivially be a hit and the rule would
 * fire on silence).
 *
 * Mirrored the moment the cap gained it, before any audio rule exists: this
 * schema is what a rule is parsed INTO and written back OUT, so an unmirrored
 * field is STRIPPED the first time the rule is saved from the phone. That is
 * how this rule set once lost its media policy, and how every occupancy
 * condition was lost after it.
 */
export const NcAudioConditionSchema = z.object({
  /** Audio macro labels (`dog` or `audio-dog` — both spellings are accepted by
   *  the matcher); absent = any sound, i.e. a level-only rule. */
  labels: z.array(z.string().min(1)).min(1).optional(),
  /** Level floor in dBFS (negative-going, `0` = full scale); absent = any level. */
  dbThreshold: z.number().min(NC_AUDIO_DBFS_FLOOR).max(0).optional(),
  /** Percentage of the window's samples that must be hits (1–100). */
  hitPercent: z.number().int().min(1).max(100).default(60),
  /** Length of the sampling window in seconds. */
  samplingSeconds: z.number().int().min(1).max(300).default(10),
  /** LABEL MODE: labelled frames that must land inside confirmWindowSec. */
  confirmHits: z.number().int().min(1).max(20).optional(),
  /** LABEL MODE: the window those frames must share, in seconds. */
  confirmWindowSec: z.number().int().min(1).max(60).optional(),
})
export type NcAudioCondition = z.infer<typeof NcAudioConditionSchema>

/** The P1 condition set — a flat AND of groups; absent group = pass. */
export const NcConditionsSchema = z.object({
  deviceState: NcDeviceStateConditionSchema.optional(),
  /** Scene gate — see {@link NcSceneConditionSchema}. */
  scene: NcSceneConditionSchema.optional(),
  devices: z.array(z.number()).optional(),
  /**
   * D641: "every device except these". Mirrored because a phone save re-emits
   * `conditions` whole: an unmirrored `devicesExclude` was STRIPPED, and the
   * rule WIDENED to the very devices the operator had excluded. `.min(1)` as
   * the cap: an empty exclusion is written as absence (`rule-scope-model.ts`).
   * A legacy rule may carry both lists; the engine reads "these, minus those".
   */
  devicesExclude: z.array(z.number()).min(1).optional(),
  classes: z.array(z.string().min(1)).optional(),
  classesExclude: z.array(z.string().min(1)).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  zones: NcZoneConditionSchema.optional(),
  zonesExclude: z.array(z.string().min(1)).optional(),
  labelEquals: z.array(z.string().min(1)).optional(),
  /**
   * KNOWN FACES — the rule's identity scope. THREE STATES, and the empty one is
   * the point:
   *
   * | value | meaning |
   * | --- | --- |
   * | absent | the rule does not care who it is; an unrecognised person matches |
   * | `[]` | **only known faces** — any identity in the gallery, nobody in particular |
   * | a list | only these identities |
   *
   * So `[]` is NOT "unset", and anything on the save path that compacts an empty
   * array back to absence (a `.length > 0` guard, a truthiness test) silently
   * turns "only people I know" into "anybody". The prune step therefore asks
   * `isAuthoredEmptyScope` before dropping this key — see `recognition-scope.ts`.
   *
   * MEMBERS ARE FACE-GALLERY `Identity.id`s (uuid), not display names: a name is
   * renameable and a rule authored on one went dark the moment it was corrected.
   * Rules written before that carry NAMES and the hub migrates them lazily at
   * load, so both spellings can arrive here and neither may be rejected.
   */
  identities: z.array(z.string().min(1)).optional(),
  /** KNOWN PLATES — the plate mirror of {@link NcConditions.identities},
   *  including the empty-list reading. See {@link NcPlateMatcherSchema}. */
  plates: NcPlateMatcherSchema.optional(),
  /** Identity EXCLUDE — same gallery-id members, `notIn` semantics. An EMPTY
   *  list excludes NOBODY (unlike `identities`, where empty means "the known
   *  ones"), so here empty and absent genuinely agree and the editor may prune
   *  it. A subject nobody recognised passes. */
  identitiesExclude: z.array(z.string().min(1)).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  minDwellSeconds: z.number().min(0).optional(),
  /**
   * Which detection substrate stamped the record. `audio` is a D62 audio
   * marker — mirrored because rules are parsed PER RULE and a member this
   * build cannot decode DROPS the whole rule from the list (an operator's own
   * configuration, invisible on the phone), not merely one field.
   */
  source: z.enum(['pipeline', 'onboard', 'sensor', 'audio', 'any']).optional(),
  minLabelConfidence: z.number().min(0).max(1).optional(),
  eventTypeTokens: z.array(z.string().min(1)).optional(),
  sensorKinds: z.array(z.string().min(1)).optional(),
  /**
   * D640 "Notify when": which EDGE of a boolean sensor fires the rule. ABSENT
   * is both edges — there is no `'both'` member, and picking "both" deletes
   * the key. DEVICE-EVENT sensor rules only, and only while every
   * {@link sensorKinds} member raises and clears (`sensorTransitionOffered`
   * from `@camstack/types`); the editor prunes it on save otherwise.
   */
  sensorTransition: z.enum(['raised', 'cleared']).optional(),
  packagePhase: z.enum(['delivered', 'picked-up', 'both']).optional(),
  systemEvent: NcSystemEventConditionSchema.optional(),
  /**
   * Zone-crossing direction. ABSENT is not the same as `'enter'` to the rule
   * engine's author intent, but matches identically today — so the field is
   * optional and an untouched rule round-trips byte-identically.
   *
   * It MUST be mirrored here even though the app had no widget for it: this
   * schema is what the app parses a rule INTO and writes back OUT, so an
   * unmirrored field is silently stripped on save. That is exactly how editing
   * a rule from the phone once wiped the media policy the admin UI had set.
   */
  crossing: z.enum(['enter', 'exit', 'any']).optional(),
  /** A1: PERSONAL-RULE viewer-drawn inline polygons (MaskShape vocabulary). */
  customZones: z.array(NcMaskPolygonShapeSchema).optional(),
  /**
   * ZoneAnalytics occupancy edge (device-event delivery only).
   *
   * Mirrored LATE, and that was the bug: the app carried the catalog `group`
   * and `valueType` so the descriptor would parse, but not the condition — so
   * every rule with an occupancy condition lost it the first time it was saved
   * from the phone, exactly like the media policy before it.
   */
  occupancy: NcOccupancyConditionSchema.optional(),
  /**
   * IMMEDIATE only. Sustained-sound matcher — presence of this key is what
   * makes a rule an AUDIO rule (it then fires only on a confirmed audio
   * window, never on a detection, a track or a device event).
   *
   * Mirrored AHEAD of the hub's condition descriptor, deliberately: the
   * descriptor is what makes an audio rule authorable, and it must not exist
   * before the app can round-trip the field it writes. See
   * {@link NcAudioCondition}.
   */
  audio: NcAudioConditionSchema.optional(),
})
export type NcConditions = z.infer<typeof NcConditionsSchema>

/** One delivery target: a `notification-output` Target ref + passthrough params. */
export const NcRuleTargetSchema = z.object({
  targetId: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
})
export type NcRuleTarget = z.infer<typeof NcRuleTargetSchema>

/**
 * The notification's PICTURE (mirrors `NcMediaImageSchema`, D897): one mode,
 * rendered by the hub at send time from the clean frame of the moment.
 *  - `scene-boxes` — the whole scene, the subject outlined and every other
 *                    tracked object outlined thin
 *  - `crop`        — the subject cut out of the frame
 *  - `clean`       — the whole scene with nothing drawn on it
 *  - `none`        — no picture
 * It replaces the `attach` × `frame` × `zoneCrop` triple; the editor reads a
 * legacy rule through `rule-media-image.ts` and never writes the triple.
 */
export const NcMediaImageSchema = z.enum(['scene-boxes', 'crop', 'clean', 'none'])
export type NcMediaImage = z.infer<typeof NcMediaImageSchema>

/**
 * @deprecated D897 — READ only, through `legacyImageMode`. The hub still
 * accepts and serves it on a rule nobody saved since; this editor never writes it.
 */
export const NcMediaFrameSchema = z.enum(['cropped', 'full', 'boxed'])
export type NcMediaFrame = z.infer<typeof NcMediaFrameSchema>

/**
 * How a SENSOR notification shows the cameras linked to the sensor (mirrors
 * `NcLinkedCameraModeSchema`): `mosaic` = one composed image, `each` = one
 * image per camera. Absent = `mosaic`, applied by the hub — never a default here.
 */
export const NcLinkedCameraModeSchema = z.enum(['mosaic', 'each'])
export type NcLinkedCameraMode = z.infer<typeof NcLinkedCameraModeSchema>

/** Stream profile the footage is cut from (mirrors `CamProfileSchema`). */
export const NcCamProfileSchema = z.enum(['high', 'mid', 'low'])
export type NcCamProfile = z.infer<typeof NcCamProfileSchema>

/**
 * Media attachment policy. Mirrors the cap's `NcMediaPolicySchema` IN FULL —
 * it deliberately did not, and because Zod strips unknown keys the viewer used
 * to read a rule, drop `frame`/`zoneCrop`/`gif`/`clip`/`profile` on the way in,
 * and write them back missing on the way out. Every optional field here is
 * absent-means-default, so a rule the operator never touched round-trips byte
 * identical.
 */
export const NcMediaPolicySchema = z.object({
  /** The picture (D897). Absent on a rule nobody saved since: read through `resolveNcMediaImage`. */
  image: NcMediaImageSchema.optional(),
  /** Draw the zone that FIRED the rule on a scene picture — a zone-triggered rule only. */
  showTriggerZone: z.boolean().optional(),
  /** Draw the subject's path on the picture (D901) — any mode, a crop included; a tracked subject only. */
  showSubjectPath: z.boolean().optional(),
  /** @deprecated D897 — read only (`legacyImageMode`), never written. */
  attach: z.enum(['best', 'best-matching', 'keyFrame', 'none']).optional(),
  /** @deprecated D897 — read only (`legacyImageMode`), never written. */
  frame: NcMediaFrameSchema.optional(),
  /** @deprecated D897 — read only (`legacyImageMode`), never written. */
  zoneCrop: z.boolean().optional(),
  /** Also attach a short GIF cut from the clip ring around the event. */
  gif: z.boolean().optional(),
  /** Also attach a short MP4 of the same cut. */
  clip: z.boolean().optional(),
  /** Seconds of footage BEFORE / AFTER the event instant. Defaults 3 / 7. */
  clipPreRollSec: z.number().int().min(0).max(30).optional(),
  clipPostRollSec: z.number().int().min(0).max(30).optional(),
  /** Which stream profile the footage is cut from. Absent = the cheapest. */
  profile: NcCamProfileSchema.optional(),
  /**
   * Playback rate of the gif / clip. Absent = the 2x default.
   *
   * Mirrored the moment the cap gained it, not when the app grew a control for
   * it: this schema is what a rule is parsed INTO and written back OUT, so an
   * unmirrored field is STRIPPED on save. That is how editing a rule from the
   * phone once wiped the media policy the admin UI had configured.
   */
  clipSpeed: z.number().min(1).max(8).optional(),
  /** Sensor rules only — see {@link NcLinkedCameraModeSchema}. */
  linkedCameras: NcLinkedCameraModeSchema.optional(),
})
export type NcMediaPolicy = z.infer<typeof NcMediaPolicySchema>

/** Cooldown GRANULARITY over the subject's class (mirrors
 *  `NcThrottleGranularitySchema`). Absent = `per-class` since 2026-10-01 (the
 *  hub's operator default, D36's dated note) — it used to read as `shared`.
 *  The viewer authors no control for this field; it only preserves whatever a
 *  rule already carries (`rule-editor.ts`), so a rule created HERE stays
 *  absent and inherits the hub's default unchanged. */
export const NcThrottleGranularitySchema = z.enum(['shared', 'per-class'])
export type NcThrottleGranularity = z.infer<typeof NcThrottleGranularitySchema>

/** Throttle — cooldown survives restarts. */
export const NcThrottleSchema = z.object({
  cooldownSec: z.number().int().min(0).max(86_400).default(60),
  scope: z.enum(['rule', 'rule-device']).default('rule-device'),
  /**
   * Mirrored although the app authors no control for it: the editor PRESERVES
   * the whole throttle across an edit (`formToInput` re-emits it verbatim), so
   * an unmirrored sub-field is dropped on parse and written back missing — the
   * same silent wipe the media policy suffered.
   */
  granularity: NcThrottleGranularitySchema.optional(),
})
export type NcThrottle = z.infer<typeof NcThrottleSchema>

// ── Snooze bounds (mirrors the cap's own hoisted block) ────────────────────
//
// Declared HERE rather than in the snooze section below, exactly as the cap
// declares them: the rule schema bounds its `snoozeOptions` on the ceiling, and
// a Zod schema is built at module init — a const declared further down is in
// its temporal dead zone by then.

/** Hard ceiling on a window (24h). A snooze that could not expire would be an
 *  outage the operator asked for once and forgot. */
export const NC_SNOOZE_MAX_MINUTES = 1440

/**
 * How many snooze buttons a rule may put on its notification (the cap's
 * `.max(4)`). The notifier's own action budget is small — ntfy allows three
 * buttons in total — so a rule that spent it all on snooze choices would push
 * its own tap-through actions off the notification.
 */
export const NC_SNOOZE_OPTIONS_MAX = 4

/** The durations a notification offers when its rule does not say otherwise.
 *  Mirrors the cap's `NC_DEFAULT_SNOOZE_MINUTES`. */
export const NC_DEFAULT_SNOOZE_MINUTES: readonly number[] = [10, 30, 60]

// ── Actions (mirrors notification-rules.cap.ts ~705-820) ──────────────────
//
// Copied field for field from `NcRuleActionSchema`, `NcSharedSequenceSchema`,
// `NcActionBindingSchema`, `NcHookBindingsSchema`,
// `NcRuleNotificationButtonSchema` and `NcRuleActionsSchema`. A rule BINDS to
// shared sequences by id (the hub's sequence store, authored on the admin's
// Notifications → Sequences) or authors a single step inline ("Do"); it never
// carries a sequence of its own. ADMIN-ONLY on the hub (a non-admin may echo
// them unchanged, never change or clear them), and mirrored for everyone all
// the same: an unmirrored field is stripped on parse, and the phone would then
// hold a rule without the siren an admin wired to it.

/** The button icon vocabulary — mirrors `NotificationActionIconSchema`
 *  (notification-output.cap.ts ~102), member for member. */
export const NcNotificationActionIconSchema = z.enum([
  'acknowledge',
  'dismiss',
  'silence',
  'snooze',
  'view',
  'play',
  'open',
  'close',
  'lock',
  'unlock',
  'arm',
  'arm-home',
  'arm-away',
  'arm-night',
  'disarm',
  'light',
  'alert',
  'camera',
])
export type NcNotificationActionIcon = z.infer<typeof NcNotificationActionIconSchema>

/** The hub's bounds on an actions block (same cap lines), shared by the
 *  schemas below and the editor's validator (`rule-action-form.ts`) so the two
 *  cannot disagree. */
export const NC_ACTION_WAIT_MAX_SEC = 300
export const NC_ACTION_SEQUENCE_NAME_MAX = 120
export const NC_ACTION_MIN_DELAY_MAX_SEC = 86_400
export const NC_ACTION_BUTTON_ID_MAX = 64
export const NC_ACTION_BUTTON_LABEL_MAX = 40
export const NC_ACTION_BUTTONS_MAX = 8

/** One step of a sequence: a pause, or one device-scoped cap method call. */
export const NcRuleActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('wait'), seconds: z.number().min(0).max(NC_ACTION_WAIT_MAX_SEC) }),
  z.object({
    kind: z.literal('cap'),
    deviceId: z.number().int(),
    cap: z.string().min(1),
    method: z.string().min(1),
    /** Method arguments, minus `deviceId` (the executor injects it). */
    args: z.record(z.string(), z.unknown()).optional(),
  }),
])
export type NcRuleAction = z.infer<typeof NcRuleActionSchema>

/**
 * A named, ordered run of steps SHARED across rules, with its own actuator
 * throttle (keyed on the id, so two rules sharing one share its budget).
 * Served by `notificationRules.listSequences` (admin-only).
 */
export const NcSharedSequenceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(NC_ACTION_SEQUENCE_NAME_MAX),
  minDelaySec: z.number().int().min(0).max(NC_ACTION_MIN_DELAY_MAX_SEC).optional(),
  actions: z.array(NcRuleActionSchema).min(1),
})
export type NcSharedSequence = z.infer<typeof NcSharedSequenceSchema>

/** What one hook slot runs: a shared sequence by id, or one inline step. */
export const NcActionBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sequence'), sequenceId: z.string().min(1) }),
  z.object({ kind: z.literal('do'), action: NcRuleActionSchema }),
])
export type NcActionBinding = z.infer<typeof NcActionBindingSchema>

/** The hub's cap on one hook edge's bindings. */
export const NC_HOOK_BINDINGS_MAX = 4

export const NcHookBindingsSchema = z.array(NcActionBindingSchema).max(NC_HOOK_BINDINGS_MAX)
export type NcHookBindings = z.infer<typeof NcHookBindingsSchema>

/** A notification button that runs one SHARED sequence, by id. */
export const NcRuleNotificationButtonSchema = z.object({
  id: z.string().min(1).max(NC_ACTION_BUTTON_ID_MAX),
  label: z.string().min(1).max(NC_ACTION_BUTTON_LABEL_MAX),
  sequenceId: z.string().min(1),
  icon: NcNotificationActionIconSchema.optional(),
  destructive: z.boolean().optional(),
})
export type NcRuleNotificationButton = z.infer<typeof NcRuleNotificationButtonSchema>

/**
 * What a rule runs, by hook edge, plus its notification buttons:
 * `onActivation` / `onDeactivation` (the rule switched on / off), `onTrigger`
 * (a positive / raised match), `onTriggerOff` (a clear / leave match).
 */
export const NcRuleActionsSchema = z.object({
  onActivation: NcHookBindingsSchema.optional(),
  onDeactivation: NcHookBindingsSchema.optional(),
  onTrigger: NcHookBindingsSchema.optional(),
  onTriggerOff: NcHookBindingsSchema.optional(),
  buttons: z.array(NcRuleNotificationButtonSchema).max(NC_ACTION_BUTTONS_MAX).optional(),
})
export type NcRuleActions = z.infer<typeof NcRuleActionsSchema>

// ── AI confirm gate (mirrors notification-rules.cap.ts ~1046-1107) ─────────
//
// `NcConfirmExpectSchema` / `NcConfirmSchema` and their constants, copied field
// for field INCLUDING the `.default()`s: a parsed confirm always carries
// `enabled`, `timeoutMs`, `onTimeout` and `maxImagePx`, exactly as the hub's
// parse does, so an edit re-emits what the hub stored.

export const NC_CONFIRM_MIN_TIMEOUT_MS = 1_000
export const NC_CONFIRM_MAX_TIMEOUT_MS = 20_000
export const NC_CONFIRM_DEFAULT_TIMEOUT_MS = 8_000
export const NC_CONFIRM_DEFAULT_MAX_IMAGE_PX = 448

/** Comparison the model's COUNT must satisfy for the notification to fire. */
export const NcConfirmExpectSchema = z.object({
  op: z.enum(['>=', '>', '<=', '<', '==']),
  count: z.number().int().min(0).max(1_000),
})
export type NcConfirmExpect = z.infer<typeof NcConfirmExpectSchema>

/** A vision model judges the picture about to ship. Fail-open by default. */
export const NcConfirmSchema = z.object({
  enabled: z.boolean().default(false),
  profileId: z.string().optional(),
  prompt: z.string().max(1_000).optional(),
  expect: NcConfirmExpectSchema.optional(),
  timeoutMs: z
    .number()
    .int()
    .min(NC_CONFIRM_MIN_TIMEOUT_MS)
    .max(NC_CONFIRM_MAX_TIMEOUT_MS)
    .default(NC_CONFIRM_DEFAULT_TIMEOUT_MS),
  onTimeout: z.enum(['fire', 'suppress']).default('fire'),
  maxImagePx: z.number().int().min(64).max(2_048).default(NC_CONFIRM_DEFAULT_MAX_IMAGE_PX),
})
export type NcConfirm = z.infer<typeof NcConfirmSchema>

/** `{{var}}` templating over camera/class/label/zones/confidence/time. */
export const NcRuleTemplateSchema = z.object({
  title: z.string().max(500).optional(),
  body: z.string().max(2000).optional(),
})
export type NcRuleTemplate = z.infer<typeof NcRuleTemplateSchema>

/** Client-supplied rule fields (server stamps id/createdBy/createdAt/updatedAt). */
export const NcRuleInputSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean().default(true),
  delivery: NcDeliverySchema,
  conditions: NcConditionsSchema.default({}),
  schedule: NcScheduleSchema.optional(),
  /**
   * A `device-events` / `system` rule's delivery (D647). Absent and
   * `{ mode: 'instant' }` both mean a notification per event; never defaulted,
   * so a rule authored before D647 round-trips WITHOUT the key. Unmirrored, a
   * summary rule opened on the phone showed as instant and could not be
   * authored here; the hub's patch merge kept it only because the phone never
   * sent the key at all.
   */
  systemEventDelivery: NcSystemEventDeliverySchema.optional(),
  /**
   * NO `.min(1)`, as on the hub: a rule addressed only to USERS (`targetUsers`)
   * has no targets, and the "at least one addressee" invariant is the
   * provider's. The `.min(1)` this mirror carried made such a rule fail its
   * parse and vanish from the phone.
   */
  targets: z.array(NcRuleTargetSchema),
  /** USERS this rule addresses besides `targets`. ADMIN-ONLY on the hub. */
  targetUsers: z.array(z.string()).optional(),
  media: NcMediaPolicySchema.default({}),
  throttle: NcThrottleSchema.default({ cooldownSec: 60, scope: 'rule-device' }),
  template: NcRuleTemplateSchema.optional(),
  priority: z.number().int().min(1).max(5).default(3),
  /** A1: ownership/visibility key. Server-stamped; never trusted from a client. */
  ownerUserId: z.string().optional(),
  /**
   * Whether a non-admin may snooze this rule for EVERYONE (the hub's
   * `snoozeAllowGlobal`). Mirrored the moment it shipped, not when a control
   * for it appears: a top-level field survives the hub's patch merge, but the
   * app cannot decide whether to OFFER a global window without knowing it, and
   * an unmirrored field is one nested-object refactor away from being wiped by
   * an edit from the phone — which is how this rule set lost its media policy.
   */
  snoozeAllowGlobal: z.boolean().optional(),
  /**
   * The snooze durations THIS rule's notification offers as buttons, in
   * minutes. THREE distinct states, which is why it is `.optional()` and never
   * `.default()`:
   *
   * | value | meaning |
   * | --- | --- |
   * | absent | the operator never said ⇒ `NC_DEFAULT_SNOOZE_MINUTES` |
   * | `[]` | **no snooze buttons on this rule** — the explicit override |
   * | a list | these choices, de-duplicated and sorted, at most four |
   *
   * Mirrored although the app authors no control for it, for the reason the
   * throttle's `granularity` is: an unmirrored top-level field is stripped on
   * parse and written back MISSING by an edit from the phone. And `[]` must
   * survive that round trip as `[]` — a preserve step that tests truthiness
   * instead of `!== undefined` silently promotes "no buttons" back to "the hub
   * decides", which is the one change nobody would notice until a notification
   * grew three buttons the operator had removed.
   */
  snoozeOptions: z
    .array(z.number().int().min(1).max(NC_SNOOZE_MAX_MINUTES))
    .max(NC_SNOOZE_OPTIONS_MAX)
    .optional(),
  /** Device actions and notification buttons. ADMIN-ONLY on the hub. */
  actions: NcRuleActionsSchema.optional(),
  /** AI confirm gate — absent = deliver exactly as before. */
  confirm: NcConfirmSchema.optional(),
  /**
   * "Immediate, grouped" (D692): the window, in seconds, the hub waits for the
   * subjects of one camera to be recognised before it sends ONE message with a
   * mosaic. Absent = plain Immediate. Replaces `waitForEnhancement` and
   * `groupIdleSec`, which the mirror no longer declares: Zod strips them from a
   * row an older hub still sends, and the hub keeps accepting them in `clear`.
   * The bounds are the cap's own.
   */
  groupingSec: z.number().int().min(NC_GROUPING_MIN_SEC).max(NC_GROUPING_MAX_SEC).optional(),
})
export type NcRuleInput = z.infer<typeof NcRuleInputSchema>

/**
 * Partial patch for `updateRule` — any subset of the input fields, with NO
 * defaults.
 *
 * **Hand-written, and NOT `NcRuleInputSchema.partial()`.** Zod 4 `.partial()`
 * KEEPS the inner `.default()`, so the derived schema parsed `{ name: 'x' }`
 * into six keys — `enabled`, `conditions`, `media`, `throttle` and `priority`
 * materialised out of nothing. That is commit `e0921ac6e`, found in production
 * on 2026-08-12, where the hub's merge (`{ ...existing, ...patch }`) wrote the
 * resurrected defaults over the rule and a camera- and zone-scoped rule
 * silently became one that matched everything.
 *
 * The hub's own `NcRulePatchSchema` was fixed then and parses `{ name }` to one
 * key. THIS mirror was not, and had drifted into disagreeing with the thing it
 * mirrors: nothing parsed a patch through it here (the editor sends a full
 * input and the hub re-parses), so the bug was latent rather than live — which
 * is exactly how it would have been rediscovered, by the first call site that
 * started using it as a patch schema. `notification-center.spec.ts` now pins
 * the one-key round trip for this schema and for the digest one beside it.
 */
export const NcRulePatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  delivery: NcDeliverySchema.optional(),
  conditions: NcConditionsSchema.optional(),
  schedule: NcScheduleSchema.optional(),
  systemEventDelivery: NcSystemEventDeliverySchema.optional(),
  targets: z.array(NcRuleTargetSchema).optional(),
  targetUsers: z.array(z.string()).optional(),
  media: NcMediaPolicySchema.optional(),
  throttle: NcThrottleSchema.optional(),
  template: NcRuleTemplateSchema.optional(),
  priority: z.number().int().min(1).max(5).optional(),
  ownerUserId: z.string().optional(),
  snoozeAllowGlobal: z.boolean().optional(),
  snoozeOptions: z
    .array(z.number().int().min(1).max(NC_SNOOZE_MAX_MINUTES))
    .max(NC_SNOOZE_OPTIONS_MAX)
    .optional(),
  actions: NcRuleActionsSchema.optional(),
  confirm: NcConfirmSchema.optional(),
  groupingSec: z.number().int().min(NC_GROUPING_MIN_SEC).max(NC_GROUPING_MAX_SEC).optional(),
})
export type NcRulePatch = z.infer<typeof NcRulePatchSchema>

/**
 * Mirror of the hub's `NcRuleClearableKeySchema` — keys `nc.updateRule` may empty.
 * `waitForEnhancement` and `groupIdleSec` are RETIRED (D692) but the hub still
 * accepts them, and the server's mirror guard compares sets, so they stay.
 */
export const NcRuleClearableKeySchema = z.enum([
  'template',
  'schedule',
  'targetUsers',
  'snoozeOptions',
  'snoozeAllowGlobal',
  'waitForEnhancement',
  'actions',
  'confirm',
  'groupIdleSec',
  'groupingSec',
])
export type NcRuleClearableKey = z.infer<typeof NcRuleClearableKeySchema>

/** A persisted rule. */
export const NcRuleSchema = NcRuleInputSchema.extend({
  id: z.string(),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** A1: per-target opt-out set (only a target's OWNER may edit it). */
  disabledTargetIds: z.array(z.string()).default([]),
})
export type NcRule = z.infer<typeof NcRuleSchema>

/** A rule as served to the viewer — carries the server's `readOnly` verdict
 *  (admin/global rules are read-only in the viewer; personal rules editable). */
export const NcViewerRuleSchema = NcRuleSchema.extend({ readOnly: z.boolean() })
export type NcViewerRule = z.infer<typeof NcViewerRuleSchema>

// ── The rule's AI section (mirrors the addon's `rule-ai.ts`) ────────────────
//
// A SIDE TABLE on the hub, keyed by rule id, read and written through its own
// pair of bridge actions — NOT a field on `NcRule`. The addon's reason is worth
// repeating here because it decides how this app has to save: `NcRule` lives in
// `@camstack/types`, which the addon resolves from the `@camstack/server`
// closure at runtime, so a new key on `NcRuleInputSchema` is silently STRIPPED
// at save until a framework train lands. The AI block lives in the addon
// instead, which is why `nc.setRuleAi` is a second call after the rule save and
// not part of it.
//
// A viewer-local mirror for the same reason every schema in this file is one:
// this app ships on a THIRD train (EAS OTA) and must tolerate a hub that is
// ahead of it. Zod strips unknown keys, so a field a newer hub grew is invisible
// here — and `nc.setRuleAi` takes the WHOLE section rather than a diff, so a
// field this build cannot see would be dropped on save. That is the one place
// this mirror is not free, and it is why every field the hub declares today is
// mirrored below even where this app does not author it (`maxImagePx`,
// `timeoutMs` ride through an edit untouched).

/** The answer's language. The hub's `NC_LANGUAGES`, member for member. */
export const NcRuleAiLanguageSchema = z.enum(['en', 'it'])
export type NcRuleAiLanguage = z.infer<typeof NcRuleAiLanguageSchema>

/** The bounds the hub enforces on the word cap (`NC_RULE_AI_WORDS_MIN/MAX`). */
export const NC_RULE_AI_WORDS_MIN = 12
export const NC_RULE_AI_WORDS_MAX = 120

/**
 * The AI section of one ordinary rule.
 *
 * No `.default()` anywhere, exactly as the hub declares it: the block is frozen
 * onto a durable outbox row at enqueue, and a default materialised at parse
 * time would be a number the operator never chose pinned onto a row for days.
 * Absence means "the hub's own fallback, whatever it is on the day the row
 * drains" — which is what keeps this app correct against a hub it is older than.
 */
export const NcRuleAiSchema = z.object({
  enabled: z.boolean(),
  profileId: z.string().optional(),
  /** The operator's own QUESTION. It replaces the question and never the
   *  contract: the answer schema and the anti-injection clauses live in the
   *  system turn the hub builds, where nothing authorable reaches them. */
  prompt: z.string().max(2_000).optional(),
  language: NcRuleAiLanguageSchema.optional(),
  /** Absent = derived from the delivery TARGET's declared body budget. */
  maxWords: z.number().int().min(NC_RULE_AI_WORDS_MIN).max(NC_RULE_AI_WORDS_MAX).optional(),
  maxImagePx: z.number().int().min(64).max(2_048).optional(),
  timeoutMs: z.number().int().min(1_000).max(30_000).optional(),
})
export type NcRuleAi = z.infer<typeof NcRuleAiSchema>

/** `nc.getRuleAi` — the sections of the rules the caller may see. A rule with
 *  no section is simply ABSENT from the list, never a disabled row. */
export const NcRuleAiSectionSchema = z.object({ ruleId: z.string(), ai: NcRuleAiSchema })
export type NcRuleAiSection = z.infer<typeof NcRuleAiSectionSchema>

export const NcGetRuleAiResultSchema = z.object({ sections: z.array(NcRuleAiSectionSchema) })
export type NcGetRuleAiResult = z.infer<typeof NcGetRuleAiResultSchema>

/** One vision profile a section may be pinned to (`nc.listAiProfiles`). The hub
 *  narrows the list to the ENABLED, VISION-CAPABLE rows — a vision call against
 *  a text profile is refused there, never degraded. */
export const NcAiProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  model: z.string(),
})
export type NcAiProfile = z.infer<typeof NcAiProfileSchema>

export const NcListAiProfilesResultSchema = z.object({ profiles: z.array(NcAiProfileSchema) })
export type NcListAiProfilesResult = z.infer<typeof NcListAiProfilesResultSchema>

// ── Condition catalog (mirrors NcConditionDescriptorSchema + A1 polygonDraw) ─

export const NcConditionDescriptorSchema = z.object({
  id: z.string(),
  group: z.enum([
    'scope',
    'class',
    'zones',
    'quality',
    'label',
    'schedule',
    'device',
    'package',
    /**
     * DEVICE-EVENT occupancy edge — rendered by `OccupancyField` under the
     * `occupancy` heading in `ConditionForm.GROUP_ORDER`.
     *
     * It had to parse long before it could render: this is a `z.array().parse()`
     * boundary, so the single unknown member threw and took the ENTIRE condition
     * catalog with it, leaving the rule editor with no conditions at all once
     * the hub started serving the occupancy descriptor.
     */
    'occupancy',
    /**
     * IMMEDIATE sustained-sound conditions — rendered by `AudioField` under the
     * `audio` heading in `ConditionForm.GROUP_ORDER`.
     *
     * Present BEFORE the hub serves it: this is a per-descriptor parse that
     * DROPS what it cannot decode, so an unmirrored group costs the condition
     * its widget, and the unmirrored `conditions.audio` beside it would cost
     * the operator the condition itself on the next save.
     */
    'audio',
    'system',
  ]),
  label: z.string(),
  valueType: z.enum([
    'deviceIdList',
    /**
     * D641: `devicesExclude`. A member of its own so it can never fall into
     * the `deviceIdList` widget, which is hard-bound to `conditions.devices`.
     * Drawn together with `devices` as ONE scope field (`RuleScopeField`).
     */
    'deviceIdExcludeList',
    'stringList',
    'number01',
    'number',
    'sourceSelect',
    'zoneSelection',
    'zoneIdList',
    'schedule',
    'plateMatcher',
    'packagePhase',
    /** A1: personal-rule polygon draw (MaskPolygonShape[]). */
    'polygonDraw',
    /** Occupancy-edge editor: zone + class + op + count + hold, edited as a set. */
    'occupancy',
    /** Sustained-sound editor: labels + dBFS floor + hit % + window, as a set. */
    'audio',
    /** Zone-crossing direction (enter / exit / any). */
    'crossingSelect',
    /** D640: a boolean sensor's edge — both (absent) / raised / cleared. */
    'sensorTransition',
    /** Device picker + multi-select over THAT device's state vocabulary. */
    'deviceState',
    /**
     * SCENE GATE editor: pick a scene, the state it must be in, and which of
     * its two booleans to read.
     *
     * Mirrored the moment the cap gained it, for the reason every member above
     * carries: an undecodable descriptor is DROPPED by this app's per-descriptor
     * parse, so the operator loses the widget — and the unmirrored
     * `conditions.scene` beside it would cost them the condition itself the
     * first time they saved the rule from the phone.
     */
    'scene',
    'systemEvent',
  ]),
  operator: z.enum(['in', 'notIn', 'anyOf', 'allOf', 'gte', 'fuzzyIn', 'withinSchedule']),
  /**
   * Choices for a single-choice widget, served WITH the descriptor.
   *
   * The app mirrors the cap by hand, so it is only ever as current as its last
   * build — which is how the rule editor came to render nothing at all. With
   * the options on the wire, a condition of an existing `valueType` needs no
   * new app build. Absent means an older hub: fall back to the local list, and
   * never to an empty control.
   */
  options: z
    .array(z.object({ value: z.string(), label: z.string(), hint: z.string().optional() }))
    .optional(),
  appliesTo: z.array(NcDeliverySchema),
  phase: z.string(),
  description: z.string().optional(),
})
export type NcConditionDescriptor = z.infer<typeof NcConditionDescriptorSchema>

// ── Picker taxonomy (mirrors @camstack/types catalogs/nc-taxonomy.ts) ───────
//
// The fixed class/label vocabulary the rule editor renders as pickers instead
// of free text. Served ADDITIVELY on the getConditionCatalog response, so it is
// `.optional()` here — a stale hub that predates the field still validates and
// the editor falls back to free-text tag inputs.

export const NcTaxonomyEntrySchema = z.object({
  kind: z.string(),
  label: z.string(),
  parentKind: z.string().nullable(),
})
export type NcTaxonomyEntry = z.infer<typeof NcTaxonomyEntrySchema>

export const NcTaxonomySchema = z.object({
  videoClasses: z.array(NcTaxonomyEntrySchema),
  audioKinds: z.array(NcTaxonomyEntrySchema),
  labels: z.array(NcTaxonomyEntrySchema),
})
export type NcTaxonomy = z.infer<typeof NcTaxonomySchema>

// ── Target domain (mirrors notification-output.cap.ts) ─────────────────────

/** A persisted target. `config` holds redacted secrets + the ownership key. */
export const TargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  addonId: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
})
export type Target = z.infer<typeof TargetSchema>

export const TargetKindLevelSchema = z.object({
  id: z.string(),
  label: z.string(),
  ordinal: z.number().int().min(1).max(5).nullable(),
  flags: z
    .object({
      critical: z.boolean().optional(),
      silent: z.boolean().optional(),
      noPush: z.boolean().optional(),
    })
    .optional(),
  requires: z.array(z.string()).optional(),
  description: z.string().optional(),
})
export type TargetKindLevel = z.infer<typeof TargetKindLevelSchema>

export const TargetKindAttachmentsCapsSchema = z.object({
  mediaTypes: z.array(z.enum(['image', 'video', 'gif', 'audio', 'icon'])),
  mode: z.enum(['url', 'bytes', 'both']),
  max: z.number().int().nonnegative(),
  maxBytes: z.number().int().positive().optional(),
})
export type TargetKindAttachmentsCaps = z.infer<typeof TargetKindAttachmentsCapsSchema>

export const TargetKindCapsSchema = z.object({
  attachments: TargetKindAttachmentsCapsSchema,
  actions: z.number().int().nonnegative(),
  levels: z.array(TargetKindLevelSchema),
  format: z.array(z.enum(['text', 'markdown', 'html'])),
  clickUrl: z.boolean(),
  sound: z.boolean(),
  ttl: z.boolean(),
  bodyMaxLen: z.number().int().positive(),
})
export type TargetKindCaps = z.infer<typeof TargetKindCapsSchema>

/** A per-kind capability descriptor. `configSchema` is a passthrough tree the
 *  admin FormBuilder consumes; validated as `unknown` at this boundary. */
export const TargetKindSchema = z.object({
  kind: z.string(),
  label: z.string(),
  icon: z.string(),
  /** Root-relative brand-icon URL the notifiers addon stamps onto each kind
   *  (`/addon/notifiers/icons/<kind>`). Declared on the cap's own
   *  `TargetKindSchema`; mirrored here because this file is the viewer's
   *  independent parse boundary. Absent when the kind bundles no brand icon
   *  (→ the UI falls back to a glyph). */
  iconUrl: z.string().optional(),
  /** Media type of `iconUrl`. Decides WHICH renderer draws it: React Native
   *  needs `react-native-svg` for `image/svg+xml` and `expo-image` for raster,
   *  and expo-image silently fails on SVG — which is exactly why every vector
   *  icon used to fall back to a placeholder glyph on mobile while the web
   *  build looked correct. Absent → treat as raster (the safe default). */
  iconMediaType: z.string().optional(),
  addonId: z.string(),
  configSchema: z.unknown(),
  supportsDiscovery: z.boolean(),
  caps: TargetKindCapsSchema,
})
export type TargetKind = z.infer<typeof TargetKindSchema>

// ── Bridge response envelopes ──────────────────────────────────────────────

/**
 * Rules are parsed PER RULE, and one this build cannot decode is DROPPED rather
 * than fatal.
 *
 * Same boundary, same hazard as the condition catalog below — and worse here,
 * because the loss is the operator's own configuration. `z.array(Rule).parse()`
 * rejects the WHOLE list on one unknown member, and the rule schema mirrors
 * several of the cap's enums by hand (`delivery`, the media policy, the
 * conditions). So the day the hub gains a delivery kind or a media field this
 * build has never heard of, ONE rule using it would empty the entire rules
 * list on the phone.
 *
 * Nothing had hit it yet. It is fixed before something does, because the
 * catalog hit exactly this twice and each time it looked like an empty screen
 * rather than a parse error.
 */
/**
 * THE PER-ELEMENT PARSE, written once.
 *
 * Four list boundaries need it (rules, the condition catalog, snooze windows,
 * and — since the timelapse and digest families reached this app — two more), so
 * a fifth hand-rolled copy of the loop is a fifth place to forget the warning.
 * The behaviour is the contract:
 *
 *  - one undecodable element costs THAT element, never the response;
 *  - the loss is NAMED. A branch that drops work silently reads as "the hub
 *    served nothing", which is exactly how the catalog failure looked twice.
 */
function parsePerItem<T>(items: readonly unknown[], schema: z.ZodType<T>, label: string): T[] {
  const parsed: T[] = []
  const skipped: string[] = []
  for (const item of items) {
    const result = schema.safeParse(item)
    if (result.success) {
      parsed.push(result.data)
      continue
    }
    const id =
      typeof item === 'object' && item !== null && 'id' in item
        ? String((item as { id: unknown }).id)
        : '<unidentified>'
    skipped.push(id)
  }
  if (skipped.length > 0) {
    console.warn(
      `[nc] ${label}: ${skipped.length} item(s) this build cannot decode were skipped: ${skipped.join(', ')}`,
    )
  }
  return parsed
}

export const NcListRulesResultSchema = z.object({
  rules: z
    .array(z.unknown())
    .transform((items) => parsePerItem(items, NcViewerRuleSchema, 'rules')),
})
export type NcListRulesResult = z.infer<typeof NcListRulesResultSchema>

/**
 * The catalog is parsed PER DESCRIPTOR, and one the app does not understand is
 * DROPPED rather than fatal.
 *
 * This boundary has now failed twice the same way. `z.array(Schema).parse()`
 * rejects the whole array on a single unknown member, so when the hub began
 * serving `occupancy` the rule editor lost all of its conditions, and when it
 * began serving `crossingSelect` it lost them again — the app mirrors the cap's
 * schemas locally, so ANY condition the hub adds before the app is rebuilt is
 * an unknown member.
 *
 * Adding the missing name fixes one instance. Dropping the unknown descriptor
 * fixes the class: a condition the app cannot render costs that one condition,
 * and `ConditionField` already returns null for a `valueType` it has no widget
 * for. The count is surfaced so the gap is visible rather than merely survived.
 */
export const NcConditionCatalogResultSchema = z.object({
  catalog: z
    .array(z.unknown())
    .transform((items) => parsePerItem(items, NcConditionDescriptorSchema, 'condition catalog')),
  taxonomy: NcTaxonomySchema.optional(),
})
export type NcConditionCatalogResult = z.infer<typeof NcConditionCatalogResultSchema>

export const NcRuleResultSchema = z.object({ rule: NcRuleSchema })
export type NcRuleResult = z.infer<typeof NcRuleResultSchema>

// ── Template-variable catalog (mirrors notification-rules.cap.ts) ─────────
//
// `NcTemplateVarDescriptorSchema` below is a field-for-field mirror of
// `NcTemplateVarDescriptorSchema` in `@camstack/types` (the source of
// `NC_TEMPLATE_VARS`) — pinned by the spec that parses the shared catalog
// through it. Resolved from PUBLISHED `node_modules`, per this file's header;
// never imported here directly. A field this mirror does not accept is a
// template variable the picker and the preview silently lose.

/**
 * The rule kinds, as data. Mirrors the cap's `NcRuleKindSchema` (guarded by
 * `scripts/check-nc-mirrors-in-sync.ts`). A `system-event` rule is one of the
 * three families (D637) — `device-events`, `system`, `alarm` — or `mixed`, a
 * stored rule whose kinds span families: derived, read-only, never authored.
 */
export const NcRuleKindSchema = z.enum([
  'detection',
  'sensor',
  'occupancy',
  'sound',
  'device-events',
  'system',
  'alarm',
  'mixed',
])
export type NcRuleKind = z.infer<typeof NcRuleKindSchema>

/**
 * The kinds a SERVED template-var descriptor may name — the frozen pre-D637
 * five, the cap's `NcTemplateVarKindSchema`. Deliberately NOT
 * {@link NcRuleKindSchema}: the hub serves `system` for every system rule kind
 * and the match widens it (`templateVarKindApplies`). A descriptor enum that
 * lacked a served kind would fail the WHOLE catalog parse; this one accepting
 * exactly the wire's five is what the mirrors guard checks.
 */
export const NcTemplateVarKindSchema = z.enum(['detection', 'sensor', 'occupancy', 'sound', 'system'])
export type NcTemplateVarKind = z.infer<typeof NcTemplateVarKindSchema>

/** Which producer renders a template: an ordinary rule, a timelapse, a digest. */
export const NcTemplateFamilySchema = z.enum(['rule', 'timelapse', 'summary'])
export type NcTemplateFamily = z.infer<typeof NcTemplateFamilySchema>

/** Which text field of that producer. `previewText` is the timelapse frame
 *  caption, `captionText` the digest mosaic caption — both see fewer vars. */
export const NcTemplateFieldSchema = z.enum(['title', 'body', 'previewText', 'captionText'])
export type NcTemplateField = z.infer<typeof NcTemplateFieldSchema>

export const NcTemplateVarGroupSchema = z.enum([
  'subject',
  'place',
  'time',
  'rule',
  'occupancy',
  'sound',
  'sensor',
  'system',
  'digest',
  'ai',
])
export type NcTemplateVarGroup = z.infer<typeof NcTemplateVarGroupSchema>

/**
 * Mirror of `NcTemplateVarDescriptorSchema` in `@camstack/types` — pinned by
 * the spec that parses the shared catalog through it.
 *
 * `families` / `fields` / `kinds` / `deliveries` / `systemEventKinds` say
 * WHERE the variable has a value; absent = no restriction on that axis.
 * `dynamic` declares a FAMILY of names (`count_<class>`): the descriptor's
 * `name` is the example member.
 */
export const NcTemplateVarDescriptorSchema = z.object({
  name: z.string().regex(/^\w+$/),
  label: z.string(),
  description: z.string().optional(),
  example: z.string(),
  group: NcTemplateVarGroupSchema,
  families: z.array(NcTemplateFamilySchema).min(1),
  fields: z.array(NcTemplateFieldSchema).optional(),
  kinds: z.array(NcTemplateVarKindSchema).optional(),
  deliveries: z.array(NcDeliverySchema).optional(),
  systemEventKinds: z.array(NcSystemEventKindSchema).optional(),
  /**
   * Which system-event DELIVERY has a value for it (D647). Absent = instant
   * only for a descriptor naming `systemEventKinds`, both otherwise;
   * `['summary']` is the state-summary vocabulary (`{{summaryText}}`, …).
   */
  systemEventDeliveries: z.array(NcSystemEventDeliveryModeSchema).optional(),
  dynamic: z.object({ prefix: z.literal('count_'), from: z.literal('classes') }).optional(),
})
export type NcTemplateVarDescriptor = z.infer<typeof NcTemplateVarDescriptorSchema>

/** What an editor knows about the field being edited — the picker/preview
 *  context sent to `previewTemplate` and used to filter the catalog. */
export const NcTemplateVarContextSchema = z.object({
  family: NcTemplateFamilySchema,
  field: NcTemplateFieldSchema,
  kind: NcRuleKindSchema.optional(),
  delivery: NcDeliverySchema.optional(),
  systemEventKinds: z.array(NcSystemEventKindSchema).optional(),
  /** The rule's system-event delivery (D647); absent = instant. */
  systemEventDelivery: NcSystemEventDeliveryModeSchema.optional(),
})
export type NcTemplateVarContext = z.infer<typeof NcTemplateVarContextSchema>

/**
 * The draft title/body text sent to `previewTemplate`. Outbound only — this
 * app composes it and the hub never sends it back — so it is a plain named
 * type rather than a parsed schema.
 */
export interface NcTemplatePreviewInput {
  readonly title?: string
  readonly body?: string
}

/** The declared `{{var}}` vocabulary; editors filter it with `templateVarsFor`
 *  semantics client-side (family/field/kind/delivery/systemEventKinds). */
export const NcTemplateCatalogResultSchema = z.object({
  vars: z.array(NcTemplateVarDescriptorSchema),
})
export type NcTemplateCatalogResult = z.infer<typeof NcTemplateCatalogResultSchema>

/** Render a template with example values, through the hub's text catalog. */
export const NcTemplatePreviewResultSchema = z.object({
  title: z.string().nullable(),
  body: z.string().nullable(),
  /** Names the template uses that this context never fills — they render empty. */
  unknown: z.array(z.string()),
})
export type NcTemplatePreviewResult = z.infer<typeof NcTemplatePreviewResultSchema>

// ── Scheduled timelapse (the SHARED schema, not a mirror) ─────────────────
//
// The one rule family whose schema this file does NOT mirror, and deliberately:
// `TimelapseRule` lives in `@camstack/types` (`notification/timelapse-rule.ts`)
// and the viewer already depends on the package, so mirroring it would be a
// second copy of a shape the server and this app can simply share. It is not the
// exception to the mirroring rule so much as the reason the rule exists — the
// mirrors below exist because those shapes live in a CAP or in an ADDON, on
// trains this app does not ride.
//
// What the app still owns is the TOLERANCE. `z.array(Schema).parse()` rejects
// the whole list on one unknown member, so the list is parsed PER RULE exactly
// like `NcListRulesResultSchema` — a rule this build cannot decode costs that
// one rule, never the screen.

/** A timelapse rule as served to the viewer — carries the server's verdict. */
export const NcViewerTimelapseRuleSchema = TimelapseRuleSchema.extend({
  readOnly: z.boolean(),
})
export type NcViewerTimelapseRule = z.infer<typeof NcViewerTimelapseRuleSchema>

/** Parsed PER RULE — see the note above. */
export const NcListTimelapseRulesResultSchema = z.object({
  rules: z.array(z.unknown()).transform((items) => parsePerItem(items, NcViewerTimelapseRuleSchema, 'timelapse rules')),
})
export type NcListTimelapseRulesResult = z.infer<typeof NcListTimelapseRulesResultSchema>

/**
 * Mirror of the addon's `TimelapseRuleClearableKeySchema`
 * (`packages/addon-post-analysis/src/notification-center/timelapse/timelapse-rule-clear.ts`)
 * — the optional fields `nc.upsertTimelapseRule` may REMOVE on an edit. The
 * list is addon-local (a timelapse rides no cap), so it is mirrored here like
 * every other bridge shape, not imported.
 */
export const NcTimelapseRuleClearableKeySchema = z.enum([
  'template',
  'previewText',
  'reportClasses',
  'denseCadenceSec',
  'minDwellSec',
])
export type NcTimelapseRuleClearableKey = z.infer<typeof NcTimelapseRuleClearableKeySchema>

export const NcTimelapseRuleResultSchema = z.object({ rule: TimelapseRuleSchema })
export type NcTimelapseRuleResult = z.infer<typeof NcTimelapseRuleResultSchema>

// ── Multi-camera digest (mirrors the ADDON's summary-rule.ts) ─────────────
//
// A mirror, unlike the timelapse above, because that schema deliberately lives
// in `addon-post-analysis` and NOT in `@camstack/types` — so a field added to it
// is live on the next `camstack deploy` rather than on the next framework train
// (see `summary/summary-rule.ts`). This app therefore cannot import it and would
// not want to: it ships on a THIRD train (EAS OTA) and has to tolerate a hub
// that is ahead of it.
//
// Consequence, and the reason it is safe: Zod STRIPS unknown keys, so a field a
// newer hub grew is invisible here — and the patch this app sends is a DIFF, so
// a field it cannot see is a field it never sends and the stored value survives
// the edit untouched. The same argument the admin's timelapse editor makes.
// One limit, shared with the admin editor: `filters`, `template` and `ai` are
// replaced WHOLE when the operator changes them, so a key a newer hub grew
// INSIDE one of them does not survive an edit of that section.

/** How the digest window is defined — schedule bands, or rolling motion. */
export const NcSummaryWindowSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schedule'), schedule: NcScheduleSchema }),
  z.object({
    kind: z.literal('motion'),
    quietSeconds: z.number().int(),
    maxWindowSeconds: z.number().int(),
  }),
])
export type NcSummaryWindow = z.infer<typeof NcSummaryWindowSchema>

// ── The rule's sections — `summary-rule.ts:46-290` in addon-post-analysis ──
//
// FULL PARITY with the admin editor, the operator's 2026-09-24 decision: the
// phone now authors every field a digest rule has. The mirror therefore carries
// every one of them — a field it forgot would be read as absent and written
// back wrong. Bounds are the addon's own, copied verbatim; `.default()` appears
// NOWHERE here, because a defaulted key would be materialised on parse and a
// patch built from it would retune a rule the operator never touched (the
// `.partial()` trap the addon's docblock describes). Every defaulted field of
// the addon's Input is `.optional()` here: an older hub may not store it, and
// an untouched field is ABSENT on a create so the hub applies its own default.

/** `{{var}}` templating for the notification's title and body. */
export const NcSummaryTemplateSchema = z.object({
  title: z.string().max(500).optional(),
  body: z.string().max(2000).optional(),
})
export type NcSummaryTemplate = z.infer<typeof NcSummaryTemplateSchema>

/** What enters the window — evaluated on TRACKS. `zones` is flat and scoped
 *  per camera by the hub. `includeStationary` absent = off. */
export const NcSummaryFiltersSchema = z.object({
  classes: z.array(z.string().min(1).max(40)).max(20).optional(),
  classesExclude: z.array(z.string().min(1).max(40)).max(20).optional(),
  zones: z.array(z.string()).max(40).optional(),
  minImportance: z.number().min(0).max(1).optional(),
  minDwellSeconds: z.number().min(0).max(3600).optional(),
  includeStationary: z.boolean().optional(),
})
export type NcSummaryFilters = z.infer<typeof NcSummaryFiltersSchema>

/** How tiles are chosen when the window holds more tracks than the budget. */
export const NcSummaryRankSchema = z.enum(['importance', 'recency', 'dwell'])
export type NcSummaryRank = z.infer<typeof NcSummaryRankSchema>

/** How much TEXT is burnt into the mosaic; `none` (absent) is the default. */
export const NcSummaryCaptionsSchema = z.enum(['none', 'tiles', 'all'])
export type NcSummaryCaptions = z.infer<typeof NcSummaryCaptionsSchema>

export const NcSummaryAiLanguageSchema = z.enum(['en', 'it'])
export type NcSummaryAiLanguage = z.infer<typeof NcSummaryAiLanguageSchema>
export const NcSummaryAiOnFailureSchema = z.enum(['deliver-without-text', 'skip'])
export type NcSummaryAiOnFailure = z.infer<typeof NcSummaryAiOnFailureSchema>

/** The joint AI pass over the window's frames. Absent = the rule has none. */
export const NcSummaryAiSchema = z.object({
  enabled: z.boolean(),
  profileId: z.string().optional(),
  prompt: z.string().max(2_000).optional(),
  language: NcSummaryAiLanguageSchema.optional(),
  maxImagePx: z.number().int().min(64).max(2_048).optional(),
  timeoutMs: z.number().int().min(10_000).max(600_000).optional(),
  onFailure: NcSummaryAiOnFailureSchema.optional(),
})
export type NcSummaryAi = z.infer<typeof NcSummaryAiSchema>

/** The fields every shape below shares — declared once. */
const NcSummaryAuthoredShape = {
  filters: NcSummaryFiltersSchema.optional(),
  maxTiles: z.number().int().min(1).max(24).optional(),
  maxAiImages: z.number().int().min(1).max(8).optional(),
  rank: NcSummaryRankSchema.optional(),
  barrierSeconds: z.number().int().min(0).max(3600).optional(),
  template: NcSummaryTemplateSchema.optional(),
  captions: NcSummaryCaptionsSchema.optional(),
  /** `''` is reachable and means "no caption at all"; absent = the default. */
  captionText: z.string().max(200).optional(),
  deliverEmpty: z.boolean().optional(),
  ai: NcSummaryAiSchema.optional(),
}

/** A digest rule as the hub stores it — every field (see above). */
export const NcSummaryRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  deviceIds: z.array(z.number()),
  window: NcSummaryWindowSchema,
  targets: z.array(NcRuleTargetSchema),
  priority: z.number().int().min(1).max(5),
  ...NcSummaryAuthoredShape,
  /** Epoch-ms of the END of the last window delivered. Absent = never. */
  generatedAt: z.number().optional(),
  /** Absent = an admin/global rule; present = personal, owned by this user. */
  ownerUserId: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})
export type NcSummaryRule = z.infer<typeof NcSummaryRuleSchema>

/** What a create sends. Server-stamped fields are absent by construction; an
 *  absent optional field takes the hub's own default. */
export const NcSummaryRuleInputSchema = z.object({
  name: z.string().min(1).max(200),
  enabled: z.boolean(),
  deviceIds: z.array(z.number()).min(1).max(64),
  window: NcSummaryWindowSchema,
  targets: z.array(NcRuleTargetSchema).min(1),
  priority: z.number().int().min(1).max(5),
  ...NcSummaryAuthoredShape,
})
export type NcSummaryRuleInput = z.infer<typeof NcSummaryRuleInputSchema>

/**
 * What an edit sends — a DIFF. An absent key means "leave it alone".
 *
 * Hand-written like the addon's, because three keys take a value `.partial()`
 * cannot express: `template`, `filters` and `ai` are CLEARABLE with `null`.
 * The one optional field `null` cannot remove, `captionText`, travels as
 * `clear` beside the patch ({@link NcSummaryRuleClearableKeySchema}).
 */
export const NcSummaryRulePatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  deviceIds: z.array(z.number()).min(1).max(64).optional(),
  window: NcSummaryWindowSchema.optional(),
  targets: z.array(NcRuleTargetSchema).min(1).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  ...NcSummaryAuthoredShape,
  filters: NcSummaryFiltersSchema.nullable().optional(),
  template: NcSummaryTemplateSchema.nullable().optional(),
  ai: NcSummaryAiSchema.nullable().optional(),
})
export type NcSummaryRulePatch = z.infer<typeof NcSummaryRulePatchSchema>

/**
 * Mirror of the addon's `SummaryRuleClearableKeySchema`
 * (`addon-post-analysis/src/notification-center/summary/summary-rule-clear.ts`)
 * — the optional fields `nc.upsertSummaryRule` may REMOVE on an edit.
 */
export const NcSummaryRuleClearableKeySchema = z.enum(['captionText'])
export type NcSummaryRuleClearableKey = z.infer<typeof NcSummaryRuleClearableKeySchema>

/** A digest rule as served to the viewer — carries the server's verdict. */
export const NcViewerSummaryRuleSchema = NcSummaryRuleSchema.extend({ readOnly: z.boolean() })
export type NcViewerSummaryRule = z.infer<typeof NcViewerSummaryRuleSchema>

/**
 * The digest list, plus THE CAPABILITY PROBE.
 *
 * `canAuthor` is `.optional()` and that is the whole degrade path: an older hub
 * still has `nc.upsertSummaryRule` as `auth: 'admin'` and says nothing, so
 * `undefined` means "this hub refuses your write". The app then shows the list
 * READ-ONLY with a note rather than offering a form whose only feedback would be
 * a 403 taken after the operator filled it in.
 */
export const NcListSummaryRulesResultSchema = z.object({
  rules: z.array(z.unknown()).transform((items) => parsePerItem(items, NcViewerSummaryRuleSchema, 'summary rules')),
  canAuthor: z.boolean().optional(),
})
export type NcListSummaryRulesResult = z.infer<typeof NcListSummaryRulesResultSchema>

export const NcSummaryRuleResultSchema = z.object({ rule: NcSummaryRuleSchema })
export type NcSummaryRuleResult = z.infer<typeof NcSummaryRuleResultSchema>

// ── Snooze (mirrors NcSnoozeSchema / NcSnoozeInputSchema) ──────────────────

export const NcSnoozeScopeSchema = z.enum(['rule', 'device', 'all'])
export type NcSnoozeScope = z.infer<typeof NcSnoozeScopeSchema>

// `NC_SNOOZE_MAX_MINUTES` and the `snoozeOptions` bounds are declared up with
// the rule schema — see the note there.

/** What the app sends. A DURATION, never an instant: a phone with a skewed
 *  clock must not be able to author a window that never ends. */
export const NcSnoozeInputSchema = z.object({
  scope: NcSnoozeScopeSchema,
  ruleId: z.string().optional(),
  deviceId: z.number().int().optional(),
  /**
   * Narrow the window to these subject classes — "the cat, not the person".
   *
   * ORTHOGONAL to `scope`, and **absent means EVERY class**: that is what every
   * window authored before this field meant, so no persisted row changes
   * meaning. `.min(1)` is load-bearing rather than tidy — the hub REFUSES an
   * empty list, so "silence nothing" and "silence everything" cannot share a
   * wire shape, and the panel must omit the field rather than send `[]`.
   */
  classes: z.array(z.string().min(1)).min(1).optional(),
  durationMinutes: z.number().int().min(1).max(NC_SNOOZE_MAX_MINUTES),
  /** Silence it for everyone. Permission is the hub's decision — asking for one
   *  the caller may not have is REFUSED, not downgraded. */
  global: z.boolean().optional(),
  /** Summary of what was hidden when the window ends. Absent = ON. */
  summary: z.boolean().optional(),
})
export type NcSnoozeInput = z.infer<typeof NcSnoozeInputSchema>

export const NcSnoozeSchema = z.object({
  id: z.string(),
  userId: z.string(),
  scope: NcSnoozeScopeSchema,
  ruleId: z.string().optional(),
  deviceId: z.number().int().optional(),
  /** Subject classes this window covers. ABSENT = every class. */
  classes: z.array(z.string().min(1)).min(1).optional(),
  startedAt: z.number(),
  /** Exclusive — at this instant the silence is over, with nothing having run. */
  expiresAt: z.number(),
  global: z.boolean(),
  summary: z.boolean(),
  digestSentAt: z.number().optional(),
})
export type NcSnooze = z.infer<typeof NcSnoozeSchema>

/**
 * Parsed PER ELEMENT. `z.array(Schema).parse()` rejects the WHOLE array for one
 * unknown member, which is how the rule editor twice rendered nothing at all
 * against a current hub. A window this app cannot decode is one it will not
 * show — never a screen it cannot open.
 */
export const NcListSnoozesResultSchema = z.object({
  snoozes: z
    .array(z.unknown())
    .transform((rows) => parsePerItem(rows, NcSnoozeSchema, 'snooze windows')),
})
export type NcListSnoozesResult = z.infer<typeof NcListSnoozesResultSchema>

export const NcSnoozeResultSchema = z.object({ snooze: NcSnoozeSchema })
export type NcSnoozeResult = z.infer<typeof NcSnoozeResultSchema>

export const NcSuccessResultSchema = z.object({ success: z.literal(true) })
export type NcSuccessResult = z.infer<typeof NcSuccessResultSchema>

export const NcTargetsResultSchema = z.object({ targets: z.array(TargetSchema) })
export type NcTargetsResult = z.infer<typeof NcTargetsResultSchema>

export const NcTargetKindsResultSchema = z.object({ kinds: z.array(TargetKindSchema) })
export type NcTargetKindsResult = z.infer<typeof NcTargetKindsResultSchema>

export const NcTargetResultSchema = z.object({ target: TargetSchema })
export type NcTargetResult = z.infer<typeof NcTargetResultSchema>

export const NcTestTargetResultSchema = z.object({ success: z.boolean(), error: z.string().optional() })
export type NcTestTargetResult = z.infer<typeof NcTestTargetResultSchema>

// ── Testing a rule (admin only on the hub) ─────────────────────────────────
//
// Two different questions, two different surfaces — never one mirror for both:
//
//  - `nc.testRule` (bridge) FIRES a SAVED rule for real: the hub plans a
//    synthetic event from the rule's own conditions, runs the real evaluation
//    and delivery, and the notification arrives marked [TEST]. Mirrors the
//    ADDON's `NcTestEventResultSchema` (`test-event.ts`) extended with
//    `trigger` + `planNotes`, exactly as `nc-actions.ts` declares it.
//  - `notificationRules.testRule` (cap) DRY-RUNS the unsaved draft against
//    recently persisted records and sends nothing. Mirrors `NcTestResultSchema`
//    in `notification-rules.cap.ts`.

/** Per-rule verdict of a real test (mirrors `NcTestEventRuleOutcomeSchema`). */
export const NcRuleTestOutcomeSchema = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  matched: z.boolean(),
  failedCondition: z.string().optional(),
  matchedOn: z.array(z.string()).optional(),
  cooldown: z.enum(['n/a', 'clear', 'suppressed', 'bypassed']),
  enqueued: z.number().int(),
  targetIds: z.array(z.string()),
})
export type NcRuleTestOutcome = z.infer<typeof NcRuleTestOutcomeSchema>

/** What the plan could not reproduce (a device-state gate, a polygon). */
export const NcRuleTestPlanNoteSchema = z.object({ conditionId: z.string(), note: z.string() })
export type NcRuleTestPlanNote = z.infer<typeof NcRuleTestPlanNoteSchema>

/**
 * A STATE-SUMMARY rule's test (D698, mirrors the hub's `NcStateSummaryTestSchema`):
 * the summary built now and the rows it queued, or why nothing was.
 */
export const NcRuleTestSummarySchema = z.object({
  recordId: z.string(),
  split: NcStateSummarySplitSchema,
  nothingToReport: z.boolean(),
  sections: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['read', 'unavailable']),
      items: z.number().int().nonnegative(),
      reason: z.string().optional(),
    }),
  ),
  rows: z.array(
    z.object({
      recordId: z.string(),
      section: z.string().optional(),
      enqueued: z.number().int().nonnegative(),
      targetIds: z.array(z.string()),
    }),
  ),
})
export type NcRuleTestSummary = z.infer<typeof NcRuleTestSummarySchema>

/** The answer of `nc.testRule` — `NcTestEventResultSchema` + `trigger` + `planNotes`. */
export const NcRuleTestResultSchema = z.object({
  /** `synthetic:<uuid>` — what to grep for in the logs and the outbox. */
  recordId: z.string(),
  origin: z.literal('synthetic'),
  delivery: z.string(),
  candidates: z.number().int(),
  outcomes: z.array(NcRuleTestOutcomeSchema),
  still: z.enum(['live', 'none', 'unavailable', 'unattachable']),
  notes: z.array(z.string()),
  droppedBy: z.string().optional(),
  /** The subject kind the rule was tested with. */
  trigger: z.string(),
  planNotes: z.array(NcRuleTestPlanNoteSchema),
  /** A summary rule's test (D698) — absent on every other rule, and from an older hub. */
  stateSummary: NcRuleTestSummarySchema.optional(),
})
export type NcRuleTestResult = z.infer<typeof NcRuleTestResultSchema>

/**
 * One evaluated record of a dry-run (mirrors the cap's `NcTestResultSchema`).
 *
 * `recordKind` is a plain string here, not the cap's enum, ON PURPOSE: it is
 * display-only, and a kind a newer hub grew must not make this build drop the
 * record — a dry-run that silently loses rows reports a wrong "N of M".
 */
export const NcDryRunRecordSchema = z.object({
  recordId: z.string(),
  recordKind: z.string(),
  deviceId: z.number(),
  timestamp: z.number(),
  wouldFire: z.boolean(),
  /** Condition id that failed (first failing group), when `wouldFire` is false. */
  failedCondition: z.string().optional(),
  className: z.string().optional(),
  label: z.string().optional(),
})
export type NcDryRunRecord = z.infer<typeof NcDryRunRecordSchema>

export const NcDryRunResultSchema = z.object({ results: z.array(NcDryRunRecordSchema) })
export type NcDryRunResult = z.infer<typeof NcDryRunResultSchema>

/** How far back the dry-run looks — the admin editor's window, verbatim. */
export const NC_DRY_RUN_LOOKBACK_MINUTES = 60

// ── The typed client ───────────────────────────────────────────────────────

/** The `addons.custom` mutate delegate — the client's single dependency. */
export interface NcClientDeps {
  readonly addonsCustomMutate: (args: { addonId: string; action: string; input: unknown }) => Promise<unknown>
}

/** One typed method per `nc.*` bridge action, split across the two addons. */
export interface NcClient {
  readonly listRules: () => Promise<NcListRulesResult>
  readonly getConditionCatalog: () => Promise<NcConditionCatalogResult>
  /** The declared `{{var}}` vocabulary; editors filter it with `templateVarsFor`. */
  readonly getTemplateCatalog: () => Promise<NcTemplateCatalogResult>
  /**
   * Render a template with example values, through the hub's text catalog.
   * Pure: sends nothing durable — a MUTATION only for transport (a long draft
   * risks batched-GET URL length limits).
   */
  readonly previewTemplate: (
    context: NcTemplateVarContext,
    template: NcTemplatePreviewInput,
  ) => Promise<NcTemplatePreviewResult>
  readonly createRule: (rule: NcRuleInput) => Promise<NcRuleResult>
  readonly updateRule: (
    ruleId: string,
    patch: NcRulePatch,
    clear?: readonly NcRuleClearableKey[],
  ) => Promise<NcRuleResult>
  readonly deleteRule: (ruleId: string) => Promise<NcSuccessResult>
  readonly setRuleTargetEnabled: (ruleId: string, targetId: string, enabled: boolean) => Promise<NcSuccessResult>
  /**
   * Switch a whole rule on or off. Rides `nc.updateRule` with a patch of
   * `enabled` ALONE, not the cap router's `notificationRules.setRuleEnabled`:
   * that one is admin-only, while the bridge update is gated on ownership —
   * exactly who the row offers the switch to — and it lets a stored `mixed`
   * rule be toggled (D637: a patch that leaves the kinds alone passes). Answers
   * the rule as the hub now STORES it, so the caller can check it landed.
   */
  readonly setRuleEnabled: (ruleId: string, enabled: boolean) => Promise<NcRuleResult>
  /**
   * The rule's AI section — a SEPARATE pair from the rule CRUD above, because
   * the block is an addon-owned side table (see `NcRuleAiSchema`). `getRuleAi`
   * with no id answers every section the caller may see; `setRuleAi(id, null)`
   * CLEARS the row, which differs from `{ enabled: false }` only in what it
   * leaves on disk — both deliver identically.
   */
  readonly getRuleAi: (ruleId?: string) => Promise<NcGetRuleAiResult>
  readonly setRuleAi: (ruleId: string, ai: NcRuleAi | null) => Promise<NcSuccessResult>
  /** The vision profiles a section may pin. */
  readonly listAiProfiles: () => Promise<NcListAiProfilesResult>
  /**
   * What the hub's deleted-device / deleted-target prune did — the source of
   * "Disabled on <date>: its last device was deleted". ADMIN-only on the hub.
   */
  readonly listPrunes: () => Promise<NcListPrunesResult>
  /**
   * The timelapse and digest families. ONE upsert each, not a create/update
   * pair — the server takes `{ rule }` for a create and `{ ruleId, patch }` for
   * an edit through the same action, because the guards a create must pass are
   * the guards a patch that widens the rule must pass too (a camera added to a
   * timelapse still has to be recording). Two entry points would be two places
   * to forget one.
   */
  readonly listTimelapseRules: () => Promise<NcListTimelapseRulesResult>
  readonly createTimelapseRule: (rule: TimelapseRuleInput) => Promise<NcTimelapseRuleResult>
  readonly updateTimelapseRule: (
    ruleId: string,
    patch: TimelapseRulePatch,
    clear?: readonly NcTimelapseRuleClearableKey[],
  ) => Promise<NcTimelapseRuleResult>
  readonly deleteTimelapseRule: (ruleId: string) => Promise<NcSuccessResult>
  readonly listSummaryRules: () => Promise<NcListSummaryRulesResult>
  readonly createSummaryRule: (rule: NcSummaryRuleInput) => Promise<NcSummaryRuleResult>
  readonly updateSummaryRule: (
    ruleId: string,
    patch: NcSummaryRulePatch,
    clear?: readonly NcSummaryRuleClearableKey[],
  ) => Promise<NcSummaryRuleResult>
  readonly deleteSummaryRule: (ruleId: string) => Promise<NcSuccessResult>
  readonly listSnoozes: () => Promise<NcListSnoozesResult>
  readonly createSnooze: (snooze: NcSnoozeInput) => Promise<NcSnoozeResult>
  readonly cancelSnooze: (snoozeId: string) => Promise<NcSuccessResult>
  readonly listTargets: () => Promise<NcTargetsResult>
  readonly listTargetKinds: () => Promise<NcTargetKindsResult>
  readonly upsertTarget: (target: Target) => Promise<NcTargetResult>
  readonly deleteTarget: (targetId: string) => Promise<NcSuccessResult>
  readonly setTargetEnabled: (targetId: string, enabled: boolean) => Promise<NcSuccessResult>
  readonly testTarget: (targetId: string) => Promise<NcTestTargetResult>
  /**
   * FIRE a saved rule for real (admin only on the hub): the notification is
   * delivered, marked [TEST]. `deviceId` attributes the event when the rule
   * scopes no camera; omitted from the wire when absent.
   */
  readonly testRule: (ruleId: string, deviceId?: number) => Promise<NcRuleTestResult>
  /**
   * The ALARM (D630, `nc-alarm.ts`). ADMIN-ONLY on the hub, every one of them:
   * a non-admin arms through the device-scoped `alarm-panel` cap. No device id
   * travels — the hub has one panel and the centre holds it. A refused arm is
   * a RESULT (`outcome: 'refused'`) carrying the id Arm anyway must send back.
   */
  readonly getAlarmStatus: () => Promise<NcAlarmStatus>
  readonly armAlarm: (mode: AlarmArmMode) => Promise<NcAlarmArmOutcome>
  readonly armAlarmAnyway: (refusalId: string) => Promise<NcAlarmArmOutcome>
  readonly disarmAlarm: () => Promise<NcSuccessResult>
  readonly getAlarmConfig: () => Promise<NcAlarmConfig>
  readonly setAlarmConfig: (patch: NcAlarmSettingsPatch) => Promise<NcAlarmConfig>
  /** The states of the asked openings (admin-only; at most `NC_ALARM_SENSORS_MAX` ids per call). */
  readonly getAlarmSensors: (deviceIds: readonly number[]) => Promise<NcAlarmSensors>
}

const RULES = 'pipeline-analytics'
const TGT = 'notifiers'

/**
 * The template context as the hub's `previewTemplate` INPUT accepts it.
 *
 * A hub older than D637 validates `kind` against the strict pre-D637 five, so
 * `device-events` / `alarm` / `mixed` would be refused outright. `system` plus
 * the event kinds the rule watches asks the SAME question of every hub: the
 * rule's own kinds when it has some, else every kind its FAMILY watches.
 *
 * `mixed` with no kinds is sent as `system` ALONE, never expanded: the full
 * list names the four newer alarm kinds (`alarm-pending`, `alarm-rearmed`,
 * `alarm-sensor-bypass`, `alarm-check-failed`), which a hub published before
 * 2026-09-25 rejects in its input enum. That is the pre-D637 request, and a
 * stored mixed rule always carries kinds anyway.
 */
export function wireTemplateContext(context: NcTemplateVarContext): NcTemplateVarContext {
  const { kind } = context
  if (kind === undefined || !isSystemRuleKind(kind)) return context
  const asked = context.systemEventKinds ?? []
  if (asked.length > 0) return { ...context, kind: 'system', systemEventKinds: [...asked] }
  const family = systemFamilyOfKind(kind)
  if (family === undefined) {
    const { systemEventKinds: _dropped, ...rest } = context
    return { ...rest, kind: 'system' }
  }
  return { ...context, kind: 'system', systemEventKinds: [...systemEventKindsOfFamily(family)] }
}

/**
 * Build an {@link NcClient} over an `addons.custom` mutate delegate. Every
 * method routes to its addon + `nc.*` action and validates the response at the
 * boundary (throwing on a malformed payload). Pure — no transport, no React —
 * so it is unit-tested directly with a mock delegate.
 */
export function makeNcClient(deps: NcClientDeps): NcClient {
  const call = <T>(addonId: string, action: string, input: unknown, out: z.ZodType<T>): Promise<T> =>
    deps.addonsCustomMutate({ addonId, action, input }).then((r) => out.parse(r))
  return {
    listRules: () => call(RULES, 'nc.listRules', {}, NcListRulesResultSchema),
    getConditionCatalog: () => call(RULES, 'nc.getConditionCatalog', {}, NcConditionCatalogResultSchema),
    getTemplateCatalog: () => call(RULES, 'nc.getTemplateCatalog', {}, NcTemplateCatalogResultSchema),
    previewTemplate: (context, template) =>
      call(
        RULES,
        'nc.previewTemplate',
        { context: wireTemplateContext(context), template },
        NcTemplatePreviewResultSchema,
      ),
    createRule: (rule) => call(RULES, 'nc.createRule', { rule }, NcRuleResultSchema),
    // `clear` is sent only when non-empty so a save that clears nothing keeps
    // the old wire shape; an older hub strips the unknown key.
    updateRule: (ruleId, patch, clear) =>
      call(
        RULES,
        'nc.updateRule',
        { ruleId, patch, ...(clear && clear.length > 0 ? { clear: [...clear] } : {}) },
        NcRuleResultSchema,
      ),
    deleteRule: (ruleId) => call(RULES, 'nc.deleteRule', { ruleId }, NcSuccessResultSchema),
    setRuleTargetEnabled: (ruleId, targetId, enabled) =>
      call(RULES, 'nc.setRuleTargetEnabled', { ruleId, targetId, enabled }, NcSuccessResultSchema),
    setRuleEnabled: (ruleId, enabled) =>
      call(RULES, 'nc.updateRule', { ruleId, patch: { enabled } }, NcRuleResultSchema),
    // `ruleId` ABSENT means "every section I may see" on the wire, so it is
    // omitted rather than sent as `undefined` — the same discipline the
    // timelapse upsert states below.
    getRuleAi: (ruleId) =>
      call(RULES, 'nc.getRuleAi', ruleId === undefined ? {} : { ruleId }, NcGetRuleAiResultSchema),
    setRuleAi: (ruleId, ai) => call(RULES, 'nc.setRuleAi', { ruleId, ai }, NcSuccessResultSchema),
    listAiProfiles: () => call(RULES, 'nc.listAiProfiles', {}, NcListAiProfilesResultSchema),
    listPrunes: () => call(RULES, 'nc.listPrunes', {}, NcListPrunesResultSchema),
    listTimelapseRules: () =>
      call(RULES, 'nc.listTimelapseRules', {}, NcListTimelapseRulesResultSchema),
    // `ruleId` ABSENT is the create signal on the wire, so it is omitted rather
    // than sent as `undefined`: `JSON.stringify` drops the key either way, but
    // an explicit `undefined` here would read as "I meant to name a rule".
    createTimelapseRule: (rule) =>
      call(RULES, 'nc.upsertTimelapseRule', { rule }, NcTimelapseRuleResultSchema),
    // `clear` only when it names something — the same wire discipline as
    // `updateRule`, so an edit that empties nothing is the old request exactly.
    updateTimelapseRule: (ruleId, patch, clear) =>
      call(
        RULES,
        'nc.upsertTimelapseRule',
        { ruleId, patch, ...(clear && clear.length > 0 ? { clear: [...clear] } : {}) },
        NcTimelapseRuleResultSchema,
      ),
    deleteTimelapseRule: (ruleId) =>
      call(RULES, 'nc.deleteTimelapseRule', { ruleId }, NcSuccessResultSchema),
    listSummaryRules: () => call(RULES, 'nc.listSummaryRules', {}, NcListSummaryRulesResultSchema),
    createSummaryRule: (rule) =>
      call(RULES, 'nc.upsertSummaryRule', { rule }, NcSummaryRuleResultSchema),
    // `clear` only when it names something — the timelapse's wire discipline.
    updateSummaryRule: (ruleId, patch, clear) =>
      call(
        RULES,
        'nc.upsertSummaryRule',
        { ruleId, patch, ...(clear && clear.length > 0 ? { clear: [...clear] } : {}) },
        NcSummaryRuleResultSchema,
      ),
    deleteSummaryRule: (ruleId) =>
      call(RULES, 'nc.deleteSummaryRule', { ruleId }, NcSuccessResultSchema),
    listSnoozes: () => call(RULES, 'nc.listSnoozes', {}, NcListSnoozesResultSchema),
    createSnooze: (snooze) => call(RULES, 'nc.createSnooze', { snooze }, NcSnoozeResultSchema),
    cancelSnooze: (snoozeId) => call(RULES, 'nc.cancelSnooze', { snoozeId }, NcSuccessResultSchema),
    listTargets: () => call(TGT, 'nc.listMyTargets', {}, NcTargetsResultSchema),
    listTargetKinds: () => call(TGT, 'nc.listTargetKinds', {}, NcTargetKindsResultSchema),
    upsertTarget: (target) => call(TGT, 'nc.upsertMyTarget', { target }, NcTargetResultSchema),
    deleteTarget: (targetId) => call(TGT, 'nc.deleteMyTarget', { targetId }, NcSuccessResultSchema),
    setTargetEnabled: (targetId, enabled) =>
      call(TGT, 'nc.setMyTargetEnabled', { targetId, enabled }, NcSuccessResultSchema),
    testTarget: (targetId) => call(TGT, 'nc.testMyTarget', { targetId }, NcTestTargetResultSchema),
    testRule: (ruleId, deviceId) =>
      call(
        RULES,
        'nc.testRule',
        deviceId === undefined ? { ruleId } : { ruleId, deviceId },
        NcRuleTestResultSchema,
      ),
    getAlarmStatus: () => call(RULES, 'nc.getAlarmStatus', {}, NcAlarmStatusSchema),
    armAlarm: (mode) => call(RULES, 'nc.armAlarm', { mode }, NcAlarmArmOutcomeSchema),
    armAlarmAnyway: (refusalId) =>
      call(RULES, 'nc.armAlarmAnyway', { refusalId }, NcAlarmArmOutcomeSchema),
    disarmAlarm: () => call(RULES, 'nc.disarmAlarm', {}, NcSuccessResultSchema),
    getAlarmConfig: () => call(RULES, 'nc.getAlarmConfig', {}, NcAlarmConfigSchema),
    setAlarmConfig: (patch) => call(RULES, 'nc.setAlarmConfig', { patch }, NcAlarmConfigSchema),
    getAlarmSensors: (deviceIds) =>
      call(RULES, 'nc.getAlarmSensors', { deviceIds: [...deviceIds] }, NcAlarmSensorsSchema),
  }
}
