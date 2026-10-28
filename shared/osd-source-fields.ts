/**
 * OSD / overlay readout field allowlist — mirrors
 * `packages/addon-osd-manager/src/osd-source-fields.ts`.
 *
 * The viewer cannot import the addon; keep the cap names and paths in sync
 * when the admin OSD picker changes.
 */

/** Caps whose `getStatus` slices may appear in the stream readout catalogue. */
export const OSD_SOURCE_CAP_NAMES: ReadonlySet<string> = new Set([
  'temperature-sensor',
  'humidity-sensor',
  'climate-control',
  'numeric-sensor',
  'weather',
  'air-quality-sensor',
  'lock-control',
  'contact',
  'binary',
  'battery',
  // Viewer superset (still valid OSD-style readings):
  'pressure-sensor',
  'ambient-light-sensor',
  'enum-sensor',
])

export interface CapStatusLeaf {
  /** The field on the hub's status slice (its quantity name). */
  readonly path: string
  /**
   * The name an older hub still sends (the unit-named field the hub renamed to
   * `path`, planning issue #260). Read as a fallback, and kept as the stable id
   * of a stored readout: a phone's saved `fieldKey` must keep matching.
   */
  readonly legacyPath?: string
  readonly label: string
  readonly fallbackUnit?: string
}

export interface CapStatusCatalogEntry {
  /** tRPC router key (camelCase). */
  readonly router: string
  readonly leaves: readonly CapStatusLeaf[]
}

/**
 * Per-cap status mapping for overlay readouts. Multi-leaf caps expose one
 * catalogue row per leaf; single-leaf caps keep `fieldKey === capName` for
 * stored readout compatibility.
 */
export const CAP_STATUS_CATALOG: Readonly<Record<string, CapStatusCatalogEntry>> = {
  'temperature-sensor': {
    router: 'temperatureSensor',
    leaves: [{ path: 'temperature', legacyPath: 'celsius', label: 'Temperature', fallbackUnit: '°C' }],
  },
  'humidity-sensor': {
    router: 'humiditySensor',
    leaves: [{ path: 'humidity', legacyPath: 'percent', label: 'Humidity', fallbackUnit: '%' }],
  },
  'pressure-sensor': {
    router: 'pressureSensor',
    leaves: [{ path: 'pressure', legacyPath: 'hpa', label: 'Pressure', fallbackUnit: 'hPa' }],
  },
  'ambient-light-sensor': {
    router: 'ambientLightSensor',
    leaves: [{ path: 'illuminance', legacyPath: 'lux', label: 'Illuminance', fallbackUnit: 'lx' }],
  },
  'numeric-sensor': {
    router: 'numericSensor',
    leaves: [{ path: 'value', label: 'Value' }],
  },
  'enum-sensor': {
    router: 'enumSensor',
    leaves: [{ path: 'value', label: 'State' }],
  },
  battery: {
    router: 'battery',
    leaves: [{ path: 'level', legacyPath: 'percentage', label: 'Battery', fallbackUnit: '%' }],
  },
  'climate-control': {
    router: 'climateControl',
    leaves: [
      { path: 'currentTemp', label: 'Current temperature', fallbackUnit: '°C' },
      { path: 'currentHumidity', label: 'Current humidity', fallbackUnit: '%' },
      { path: 'target', label: 'Target temperature', fallbackUnit: '°C' },
      { path: 'targetHumidity', label: 'Target humidity', fallbackUnit: '%' },
      { path: 'mode', label: 'Mode' },
    ],
  },
  weather: {
    router: 'weather',
    leaves: [
      { path: 'condition', label: 'Condition' },
      { path: 'temperature', label: 'Temperature', fallbackUnit: '°C' },
      { path: 'humidity', label: 'Humidity', fallbackUnit: '%' },
      { path: 'pressure', label: 'Pressure', fallbackUnit: 'hPa' },
      { path: 'windSpeed', label: 'Wind speed' },
      { path: 'windBearing', label: 'Wind bearing', fallbackUnit: '°' },
    ],
  },
  'air-quality-sensor': {
    router: 'airQualitySensor',
    leaves: [
      { path: 'co2', legacyPath: 'co2Ppm', label: 'CO₂', fallbackUnit: 'ppm' },
      { path: 'voc', legacyPath: 'vocPpb', label: 'VOC', fallbackUnit: 'ppb' },
      { path: 'pm25', label: 'PM2.5', fallbackUnit: 'µg/m³' },
      { path: 'pm10', label: 'PM10', fallbackUnit: 'µg/m³' },
      { path: 'aqi', label: 'AQI' },
    ],
  },
  binary: {
    router: 'binary',
    leaves: [{ path: 'on', label: 'On' }],
  },
  contact: {
    router: 'contact',
    leaves: [{ path: 'entryOpen', label: 'Open' }],
  },
  'lock-control': {
    router: 'lockControl',
    leaves: [{ path: 'state', label: 'Lock state' }],
  },
}

export function isOsdSourceCap(capName: string): boolean {
  return OSD_SOURCE_CAP_NAMES.has(capName)
}

/** DeviceLiveField.key for a cap-status row (legacy single-leaf ⇒ cap name only). */
export function capStatusDeviceFieldKey(capName: string, path: string): string {
  const entry = CAP_STATUS_CATALOG[capName]
  if (entry !== undefined && entry.leaves.length === 1 && entry.leaves[0].path === path) {
    return capName
  }
  // The id of a multi-leaf readout is the leaf's OLD name where it has one: a
  // saved overlay carries it, and renaming the hub field must not orphan it.
  const leaf = entry?.leaves.find((l) => l.path === path)
  return `${capName}:${leaf?.legacyPath ?? path}`
}
