/**
 * Event-kind VISUALS (viewer side) — the RN half of the unified taxonomy: the
 * `iconId → lucide-react-native component` map and the `labelKey → t()` resolver.
 *
 * Mirrors the server ui-library `composites/event-kind-visuals.tsx` (which uses
 * `lucide-react` for web). Every viewer surface that renders an event kind
 * resolves its glyph + translated label here — no per-component hardcoded icon.
 * Colors come inline from the descriptor's `color`; see `detection-colors.ts`
 * for the fallback color table.
 */
import {
  Activity,
  TriangleAlert,
  Baby,
  BellRing,
  Bike,
  Bird,
  Bus,
  Car,
  Cat,
  CircleDot,
  Cog,
  Crosshair,
  Dog,
  DoorOpen,
  Droplet,
  Droplets,
  Flame,
  Footprints,
  Hammer,
  Laugh,
  Lock,
  Megaphone,
  MessageSquare,
  Music,
  Package,
  PawPrint,
  Phone,
  Plane,
  Radar,
  Radio,
  Sailboat,
  ShieldAlert,
  Siren,
  SlidersHorizontal,
  Tag,
  ToggleRight,
  TrainFront,
  Truck,
  User,
  UserCheck,
  Users,
  Vibrate,
  Volume2,
  VolumeX,
  Wind,
  type LucideIcon,
} from '../../lib/icons.js'
import type { EventKindDescriptor } from '../../data/event-kinds.js'

/** Minimal translation function shape — single-key lookup returning a string.
 *  Compatible with react-i18next's `t` (called with one key). */
export type TranslationFn = (key: string) => string

/**
 * `iconId` → lucide-react-native component. Built ONLY from statically-imported
 * icons (bundle-safe). Unknown ids resolve to the neutral `Tag` fallback.
 */
export const EVENT_KIND_ICONS: Readonly<Record<string, LucideIcon>> = {
  // Macros.
  motion: Activity,
  audio: Volume2,
  person: User,
  vehicle: Car,
  animal: PawPrint,
  package: Package,
  sensor: Radio,
  control: SlidersHorizontal,
  // Detection subs.
  car: Car,
  truck: Truck,
  bus: Bus,
  motorcycle: Bike,
  bicycle: Bike,
  airplane: Plane,
  boat: Sailboat,
  train: TrainFront,
  bird: Bird,
  cat: Cat,
  dog: Dog,
  horse: PawPrint,
  sheep: PawPrint,
  cow: PawPrint,
  elephant: PawPrint,
  bear: PawPrint,
  zebra: PawPrint,
  giraffe: PawPrint,
  // Sensor / control subs.
  door: DoorOpen,
  pir: Radar,
  smoke: Flame,
  water: Droplet,
  gas: Wind,
  vibration: Vibrate,
  tamper: ShieldAlert,
  presence: UserCheck,
  generic: Tag,
  lock: Lock,
  siren: Siren,
  switch: ToggleRight,
  doorbell: BellRing,
  button: CircleDot,
  // Audio subs — one glyph per audio macro class (`AUDIO_MACRO_LABELS`); the
  // generic `audio` macro + any unmapped id fall back to the `Volume2` glyph.
  'audio-speech': MessageSquare,
  'audio-scream': Megaphone,
  'audio-crying': Baby,
  'audio-laughter': Laugh,
  'audio-music': Music,
  'audio-dog': Dog,
  'audio-cat': Cat,
  'audio-bird': Bird,
  'audio-animal': PawPrint,
  'audio-alarm': BellRing,
  'audio-doorbell': BellRing,
  'audio-glass_breaking': TriangleAlert,
  'audio-gunshot': Crosshair,
  'audio-vehicle': Car,
  'audio-siren': Siren,
  'audio-fire': Flame,
  'audio-water': Droplets,
  'audio-wind': Wind,
  'audio-door': DoorOpen,
  'audio-footsteps': Footprints,
  'audio-crowd': Users,
  'audio-telephone': Phone,
  'audio-engine': Cog,
  'audio-tools': Hammer,
  'audio-silence': VolumeX,
}

/** Resolve an `iconId` to a lucide component (falls back to `Tag`). */
export function resolveEventKindIcon(iconId: string): LucideIcon {
  if (Object.hasOwn(EVENT_KIND_ICONS, iconId)) return EVENT_KIND_ICONS[iconId]!
  if (iconId.startsWith('audio-')) return Volume2
  return Tag
}

/**
 * Namespace a BARE audio-macro id to its taxonomy/glyph key (`dog` → `audio-dog`).
 * Audio events persist the macro id un-namespaced; the taxonomy + this glyph
 * dict key audio subs under `audio-<id>`, so the prefix routes a bare audio
 * label to the curated audio glyph and never collides with the video sub of the
 * same bare id (`water` video Droplet vs `audio-water` Droplets).
 */
// MOVED to `src/data/event-kinds.ts` — it is pure string work, and this module
// pulls the icon set (and therefore react-native) in with it, which put it out
// of reach of the pure data layer that needs it for filtering.
export { audioKindId } from '../../data/event-kinds.js'

/**
 * Translated label for an event kind — `t(labelKey)` when a translation exists,
 * else the English `label` fallback. Robust to a missing key: react-i18next
 * echoes the key unchanged when absent, which we treat as "no translation".
 */
export function eventKindLabel(
  descriptor: Pick<EventKindDescriptor, 'labelKey' | 'label'>,
  t?: TranslationFn,
): string {
  if (t === undefined) return descriptor.label
  const translated = t(descriptor.labelKey)
  return translated === descriptor.labelKey || translated.length === 0
    ? descriptor.label
    : translated
}
