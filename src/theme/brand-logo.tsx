import React from 'react'
import { SvgXml } from 'react-native-svg'
import { useTheme } from './theme-provider.js'

// CamStack brand mark — the same "Stacked Lens" + wordmark used by the server
// admin-ui (packages/addon-admin-ui/public/brand/logo-horizontal-*.svg), with
// the subtitle changed ADMIN → VIEWER. Embedded as XML (tiny) and rendered via
// react-native-svg's SvgXml (no svg-transformer needed). viewBox 240×56.

const LIGHT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 56" fill="none">
  <g transform="translate(4, 2) scale(0.8)">
    <rect x="8" y="28" width="48" height="28" rx="6" fill="#d6d3d1"/>
    <rect x="12" y="16" width="40" height="28" rx="6" fill="#a8a29e"/>
    <rect x="16" y="4" width="32" height="28" rx="6" fill="#e67e22"/>
    <circle cx="32" cy="18" r="8" fill="#fafaf9" opacity="0.3"/>
    <circle cx="32" cy="18" r="5" fill="#fafaf9" opacity="0.2"/>
    <circle cx="32" cy="18" r="2.5" fill="#1c1917" opacity="0.7"/>
  </g>
  <text x="62" y="30" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" letter-spacing="-0.5" fill="#1c1917">
    Cam<tspan fill="#e67e22">Stack</tspan>
  </text>
  <text x="63" y="44" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" letter-spacing="3" fill="#78716c">
    VIEWER
  </text>
</svg>`

const DARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 56" fill="none">
  <g transform="translate(4, 2) scale(0.8)">
    <rect x="8" y="28" width="48" height="28" rx="6" fill="#292524"/>
    <rect x="12" y="16" width="40" height="28" rx="6" fill="#44403c"/>
    <rect x="16" y="4" width="32" height="28" rx="6" fill="#f59e42"/>
    <circle cx="32" cy="18" r="8" fill="#0c0a09" opacity="0.3"/>
    <circle cx="32" cy="18" r="5" fill="#0c0a09" opacity="0.2"/>
    <circle cx="32" cy="18" r="2.5" fill="#fafaf9" opacity="0.8"/>
  </g>
  <text x="62" y="30" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" letter-spacing="-0.5" fill="#fafaf9">
    Cam<tspan fill="#f59e42">Stack</tspan>
  </text>
  <text x="63" y="44" font-family="system-ui, -apple-system, sans-serif" font-size="10" font-weight="600" letter-spacing="3" fill="#78716c">
    VIEWER
  </text>
</svg>`

const ASPECT = 240 / 56

interface BrandLogoProps {
  /** Rendered width in px; height keeps the 240×56 aspect ratio. */
  readonly width?: number
}

/** The CamStack Viewer brand mark, theme-aware (light/dark variants). */
export function BrandLogo({ width = 200 }: BrandLogoProps) {
  const { mode } = useTheme()
  return <SvgXml xml={mode === 'light' ? LIGHT : DARK} width={width} height={width / ASPECT} />
}
