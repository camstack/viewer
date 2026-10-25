/**
 * family-row — the pure row model shared by the TIMELAPSE and DIGEST cards.
 *
 * One module for both because the two rows answer the same three questions
 * (may I edit this, how many cameras is it about, has it ever produced
 * anything) over two stores that have nothing else in common. Split out of the
 * React card so it is unit-tested in the node env like every other `*-row` /
 * `*-form` module here.
 *
 * The title layout and the action row are the DETECTION card's
 * ({@link ruleHeaderFor}, {@link ruleActionsFor}): the Rules tab mixes the two
 * kinds of card, and a second idiom for who-gets-which would drift.
 */
import {
  ruleActionsFor,
  ruleHeaderFor,
  type RuleHeaderModel,
  type RuleRowActions,
} from './rule-row.js'

/** What either list row needs to know about its rule. */
export interface FamilyRowSubject {
  /**
   * THE SERVER'S VERDICT, and the only input to editability.
   *
   * Every `nc.list*` stamps it per row from the resolved caller. Re-deriving it
   * here from `ownerUserId` would be a second opinion able to disagree with the
   * one the upsert enforces — and the disagreement that matters is the one that
   * offers Edit on a rule the hub then refuses.
   */
  readonly readOnly: boolean
  readonly deviceCount: number
  /** Absent reads as ON — the schema's own default and what old rows meant. */
  readonly enabled?: boolean
  /** The family's word for the kind chip (`sectionLabelKey(family)`). */
  readonly kindLabelKey: string
}

export interface FamilyRowModel {
  readonly editable: boolean
  readonly deviceCount: number
  readonly enabled: boolean
  /** The shared title layout — the name alone on its line. */
  readonly header: RuleHeaderModel
  /** The shared action row: all three for an editable rule, none otherwise. */
  readonly actions: RuleRowActions
}

export function buildFamilyRowModel(subject: FamilyRowSubject): FamilyRowModel {
  const editable = !subject.readOnly
  const enabled = subject.enabled !== false
  return {
    editable,
    deviceCount: subject.deviceCount,
    enabled,
    header: ruleHeaderFor(subject.kindLabelKey, editable, enabled),
    // A timelapse or digest is never `mixed`: its kind is its family. No
    // rule-scoped snooze silences it, so it has no Snooze switch.
    actions: ruleActionsFor(editable, false),
  }
}

/**
 * Which sentence goes under the name.
 *
 * A timelapse and a digest both deliver HOURS after the window they are about,
 * so "has this ever produced anything?" is the question the row exists to
 * answer — and a blank where the stamp goes reads as a bug rather than as "not
 * yet". `0` is treated as never for the same reason the stores do: it is the
 * value `readTimelapseGeneratedAt` returns for a rule with no generation state.
 */
export function familyStatusKey(generatedAt: number | undefined): string {
  return generatedAt === undefined || generatedAt === 0
    ? 'v2.nc.family.never'
    : 'v2.nc.family.last'
}
