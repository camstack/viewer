/**
 * rule-device-source — which devices a rule's device scope OFFERS, per kind.
 *
 * Operator, 2026-09-26: "for sensor rules we don't show the sensors but the
 * cameras". The Devices section opened the camera list for every kind, so a
 * device-event rule over flood sensors (created through the API) showed chips
 * the picker could never list, and no sensor could be added from the phone.
 *
 * A kind is offered the devices its rule can actually target:
 *  - `sensor` (a `device-event` rule) fires on a sensor / control event →
 *    the devices bound to an eventful sensor / control cap, narrowed to the
 *    caps of the rule's `sensorKinds` when it names any. The cap table is the
 *    shared one (`EVENT_KIND_BY_CAP`, `@camstack/types`) — the same map the hub
 *    turns a device's caps into event kinds with — so nothing is re-listed here.
 *    PLUS every CAMERA (fix round 1, 2026-10-01, `ruleDeviceCompatCapQueries`
 *    `@camstack/types` 1.2.281): the engine matches a sensor rule scoped to a
 *    CAMERA — a per-camera row carries the camera's id, and a linked set
 *    matches on `rowCameraIds` (D630 §6) — so a camera-scoped sensor rule is
 *    legitimate and the picker offers the union of the two cap queries
 *    (`extraCapNames` below), never just the sensor/control one.
 *  - every other kind reads `ruleDeviceCompatCapNames` (`@camstack/types`,
 *    operator ruling 2026-10-01): `detection` (`package-event` included) and
 *    `occupancy` need the `detection-pipeline` cap, `sound` needs
 *    `audio-metrics` — never a camera-TYPE guess. Before this change the
 *    picker offered every CAMERA for these kinds, which is narrower than the
 *    admin's old "every device" bug but still not the same claim: a camera
 *    with no detection-pipeline binding (an unsupported model, or one whose
 *    wrapper was switched off) was offered and could be picked for a rule
 *    that could never match it. `ruleDeviceCompatCapNames` returning `null`
 *    (the system families) never reaches here — none of them has a Devices
 *    section (`ruleEditorSectionsForKind`) — so the `'cameras'` fallback
 *    below is defensive, not a live path.
 *
 * The admin's Devices tab asks the SAME cap tables
 * (`ruleDeviceCompatCapQueries`, `EVENTFUL_CAP_NAMES`) — the two editors
 * cannot drift on which devices a kind can target. A stored id outside the
 * offered list is still named by the picker's targeted lookup and never
 * called removed unless that lookup ANSWERED without it (D315).
 *
 * Pure and RN-free.
 */
import {
  EVENT_KIND_BY_CAP,
  EVENTFUL_CAP_NAMES,
  NC_CAMERA_SCOPE_CAP_NAME,
  ruleDeviceCompatCapNames,
} from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'

/** Where a rule's device scope reads its list from. */
export type RuleDeviceSource =
  | { readonly kind: 'cameras' }
  | {
      readonly kind: 'caps'
      /** Devices bound to at least one of these caps (`listDeviceIdsByCaps`). */
      readonly capNames: readonly string[]
      /**
       * A SECOND `listDeviceIdsByCaps` query, unioned into the first
       * (`ruleDeviceCompatCapQueries`, `@camstack/types`) — a sensor rule's
       * camera-streams query, kept separate from `capNames` because
       * `listDeviceIdsByCaps` takes at most 16 names and `EVENTFUL_CAP_NAMES`
       * is already exactly 16 (fix round 1, 2026-10-01). Absent for every
       * other kind, which has one query.
       */
      readonly extraCapNames?: readonly string[]
      /**
       * Which noun the "every …" wording uses — independent of `capNames`.
       * `detection` / `occupancy` / `sound` fetch by capability now but are
       * still, to the operator, a CAMERA scope ("Every camera — no
       * restriction"); only a `sensor` rule's picker should ever say "every
       * sensor". Kept off the fetch mechanism on purpose: the wording and the
       * data source are two different questions, and conflating them is
       * exactly what made `source.kind === 'caps'` the wrong test the moment
       * a second kind of rule started fetching by caps too.
       */
      readonly subject: 'camera' | 'sensor'
    }

function normaliseKind(kind: string): string {
  return kind.trim().toLowerCase()
}

/**
 * The caps a sensor rule's devices are bound to: those of its `sensorKinds`
 * (a TAXONOMY id — `lock` is the `lock-control` cap, `motion-sensor` the
 * `motion` one), or every eventful cap when it names none or none this build
 * maps — never an empty list, which would offer nothing at all.
 */
export function sensorRuleCapNames(sensorKinds: readonly string[] | undefined): readonly string[] {
  const kinds = new Set((sensorKinds ?? []).map(normaliseKind))
  if (kinds.size === 0) return EVENTFUL_CAP_NAMES
  const narrowed = EVENTFUL_CAP_NAMES.filter((capName) => {
    const descriptor = EVENT_KIND_BY_CAP[capName]
    return descriptor !== undefined && kinds.has(descriptor.kind)
  })
  return narrowed.length > 0 ? narrowed : EVENTFUL_CAP_NAMES
}

/** The device list a rule of this kind offers — see the file header. */
export function ruleDeviceSource(
  kind: NcRuleKind,
  sensorKinds: readonly string[] | undefined,
): RuleDeviceSource {
  if (kind === 'sensor') {
    return {
      kind: 'caps',
      capNames: sensorRuleCapNames(sensorKinds),
      extraCapNames: [NC_CAMERA_SCOPE_CAP_NAME],
      subject: 'sensor',
    }
  }
  const capNames = ruleDeviceCompatCapNames(kind)
  return capNames === null ? { kind: 'cameras' } : { kind: 'caps', capNames, subject: 'camera' }
}
