import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../../locales/en.json'
import itLocale from '../../../../../locales/it.json'

const read = (name: string): string =>
  readFileSync(join(process.cwd(), 'src/components/camera/accessory-controls', name), 'utf8')

/** The body of one exported component, so a guard about THAT row cannot be
 *  satisfied by a string that belongs to a neighbouring control. */
function componentSource(file: string, name: string): string {
  const source = read(file)
  const start = source.indexOf(`export function ${name}(`)
  expect(start, `${name} not found in ${file}`).toBeGreaterThan(-1)
  const next = source.indexOf('\nexport function ', start + 1)
  return next === -1 ? source.slice(start) : source.slice(start, next)
}

describe('advanced accessory capability wiring', () => {
  /**
   * The climate row is intentionally THREE controls — mode select, setpoint
   * readout, ▲▼ — because the devices panel gives it a strip it shares with the
   * device name. It previously rendered up to eight affordances (mode + fan
   * mode + preset + humidity readout + humidity stepper + two swing pills +
   * setpoint stepper) and was unusable. Anything re-added here must go to a
   * wider surface, not to this row.
   */
  it('the compact climate row writes mode + setpoint and renders nothing else', () => {
    const row = componentSource('controls.tsx', 'ClimateControl')
    expect(row).toContain("'climateControl', 'setMode'")
    expect(row).toContain('options={modeOptions}')
    expect(row).toContain('<StepperArrows')
    // Exactly one dropdown (the mode), one stepper, and no pills.
    expect(row.match(/<OptionPicker/g)).toHaveLength(1)
    expect(row.match(/<StepperArrows/g)).toHaveLength(1)
    expect(row).not.toContain('<PillButton')
    expect(row).not.toContain('<IconButton')
    for (const retired of ['fanMode', 'preset', 'Preset', 'swing', 'Swing', 'Humidity']) {
      expect(row, `climate row must not render ${retired}`).not.toContain(retired)
    }
  })

  it('derives the setpoint write from the capability methods', () => {
    const logic = read('climate-logic.ts')
    expect(logic).toContain("method: 'setTarget'")
    expect(logic).toContain("method: 'setTargetRange'")
  })

  it('exposes fan presets and direction', () => {
    const source = read('controls.tsx')
    expect(source).toContain("'fanControl', 'setPreset'")
    expect(source).toContain("'fanControl', 'setDirection'")
    expect(source).toContain("value: 'forward'")
    expect(source).toContain("value: 'reverse'")
  })

  it('exposes humidifier mode and water-heater mode/away', () => {
    const source = read('controls-climate-family.tsx')
    expect(source).toContain("'humidifier', 'setMode'")
    expect(source).toContain("'waterHeater', 'setOperationMode'")
    expect(source).toContain("'waterHeater', 'setAway'")
  })

  it('ships labels in both locales', () => {
    for (const locale of [enLocale, itLocale]) {
      const accessories = locale.v2.accessories
      expect(accessories.mode).toBeTruthy()
      expect(accessories.fanMode).toBeTruthy()
      expect(accessories.direction).toBeTruthy()
      expect(accessories.away).toBeTruthy()
      expect(accessories.swingVertical).toBeTruthy()
      expect(accessories.swingHorizontal).toBeTruthy()
      expect(accessories.setTemperature).toBeTruthy()
      expect(accessories.currentTemperature).toBeTruthy()
      expect(accessories.warmer).toBeTruthy()
      expect(accessories.cooler).toBeTruthy()
    }
  })
})
