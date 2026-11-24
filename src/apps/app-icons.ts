/**
 * app-icons — the icon NAMES the hub sends (a lucide name) mapped to this app's
 * own icon set. A name nobody mapped is the neutral glyph.
 */
import {
  Archive,
  Bell,
  Calendar,
  Camera,
  ChartLine,
  Cpu,
  Database,
  GitBranch,
  Globe,
  Hammer,
  Home,
  Layers,
  Library,
  Lock,
  MapPin,
  Monitor,
  Network,
  Plug,
  Puzzle,
  ScrollText,
  Settings,
  Sparkles,
  Terminal,
  Video,
  type LucideIcon,
} from '../lib/icons.js'

const ICONS: Readonly<Record<string, LucideIcon>> = {
  archive: Archive,
  bell: Bell,
  calendar: Calendar,
  camera: Camera,
  'chart-line': ChartLine,
  'line-chart': ChartLine,
  cpu: Cpu,
  database: Database,
  'git-branch': GitBranch,
  globe: Globe,
  hammer: Hammer,
  home: Home,
  house: Home,
  library: Library,
  lock: Lock,
  'map-pin': MapPin,
  monitor: Monitor,
  network: Network,
  plug: Plug,
  puzzle: Puzzle,
  'scroll-text': ScrollText,
  settings: Settings,
  sparkles: Sparkles,
  terminal: Terminal,
  video: Video,
}

export function appIconFor(name: string): LucideIcon {
  return ICONS[name.trim().toLowerCase()] ?? Layers
}
