/**
 * A `RecordControlBinding` for specs that mount the playback bar: idle, with a
 * recorded-mode menu, every callback a spy-able no-op. Override what the case
 * is about.
 */
import { vi } from 'vitest'

import type { RecordControlBinding } from '../recording/record-control.js'

export function recordBinding(over: Partial<RecordControlBinding> = {}): RecordControlBinding {
  return {
    kind: 'export',
    menu: ['selectExport', 'snapshot'],
    onMenuAction: vi.fn(),
    active: false,
    durationLabel: '0:00',
    spanLabel: '0s',
    canAccept: false,
    warn: false,
    busy: false,
    onAccept: vi.fn(),
    onDiscard: vi.fn(),
    ...over,
  }
}
