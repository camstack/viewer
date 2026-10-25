import React from 'react'
import { makeStubView, type StubViewProps } from './passthrough.js'

// `lucide-react-native` reaches for the NAMED `Svg` (`NativeSvg.Svg`) and for
// `NativeSvg[UpperCasedTag]` per path node, so both spellings must exist.
export const Svg = makeStubView('Svg')
export default Svg
export const Circle = makeStubView('Circle')
export const Ellipse = makeStubView('Ellipse')
export const G = makeStubView('G')
export const Line = makeStubView('Line')
export const Path = makeStubView('Path')
export const Polygon = makeStubView('Polygon')
export const Polyline = makeStubView('Polyline')
export const Rect = makeStubView('Rect')
export const Defs = makeStubView('Defs')
export const ClipPath = makeStubView('ClipPath')
export const LinearGradient = makeStubView('LinearGradient')
export const Stop = makeStubView('Stop')
export const Mask = makeStubView('Mask')
export const SvgUri = makeStubView('SvgUri')
export const SvgXml = makeStubView('SvgXml')
export const Text = ({ children }: StubViewProps): React.ReactElement =>
  React.createElement('span', null, children)
