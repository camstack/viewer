/**
 * FeatureRouteGate — mounts `children` only for a session holding `feature`.
 * See `feature-route-gate.ts` for the rule.
 */
import React, { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useHasFeature, useMe } from '../data/use-me.js'
import type { ViewerFeatureId } from '../hooks/viewer-features.js'
import { NOT_FOR_YOUR_ACCOUNT_KEY } from '../auth/forbidden.js'
import { useNotice } from '../components/ui/confirm.js'
import { useTheme } from '../theme/theme-provider.js'
import { FEATURE_ROUTE_FALLBACK, featureRouteDecision } from './feature-route-gate.js'

export interface FeatureRouteGateProps {
  readonly feature: ViewerFeatureId
  readonly children: React.ReactNode
}

export function FeatureRouteGate({ feature, children }: FeatureRouteGateProps): React.JSX.Element {
  const held = useHasFeature(feature)
  const { isPending } = useMe()
  const decision = featureRouteDecision({ pending: isPending, held })
  const router = useRouter()
  const notice = useNotice()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const redirected = useRef(false)

  useEffect(() => {
    if (decision !== 'redirect' || redirected.current) return
    redirected.current = true
    router.replace(FEATURE_ROUTE_FALLBACK)
    notice({ title: t(NOT_FOR_YOUR_ACCOUNT_KEY) })
  }, [decision, notice, router, t])

  if (decision === 'render') return <>{children}</>
  return <View style={{ flex: 1, backgroundColor: colors.background }} />
}
