/**
 * ConsumablesList — the device's consumables, one row each: name, level, and a
 * warning when the provider itself says the item is low, empty or due for
 * replacement. The viewer invents no threshold of its own.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from '../../lib/icons.js'
import { consumableNeedsAttention, useConsumables, type ConsumableRow } from '../../data/device-detail-status.js'
import { Section } from '../ui/Section.js'
import { Row } from '../ui/Row.js'

export interface ConsumablesListProps {
  readonly deviceId: number
  readonly online: boolean
}

function valueOf(row: ConsumableRow, t: (key: string) => string): string | undefined {
  const level = row.level === null ? null : `${Math.round(row.level)}%`
  if (row.status === 'replace') return level === null ? t('v2.deviceDetail.consumableReplace') : `${level} · ${t('v2.deviceDetail.consumableReplace')}`
  if (row.status === 'empty') return t('v2.deviceDetail.consumableEmpty')
  if (row.status === 'low' && level === null) return t('v2.deviceDetail.consumableLow')
  return level ?? undefined
}

export function ConsumablesList({ deviceId, online }: ConsumablesListProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const status = useConsumables(deviceId, online)
  const rows = status.data
  if (rows == null || rows.length === 0) return null
  return (
    <Section title={t('v2.deviceDetail.sections.consumables')} collapsible testID="device-consumables">
      {rows.map((row, index) => (
        <Row
          key={row.key}
          label={row.label}
          value={valueOf(row, t)}
          icon={consumableNeedsAttention(row) ? TriangleAlert : undefined}
          danger={consumableNeedsAttention(row)}
          last={index === rows.length - 1}
        />
      ))}
    </Section>
  )
}
