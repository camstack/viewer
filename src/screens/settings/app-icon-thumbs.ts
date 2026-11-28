import type { ImageProps } from 'expo-image'

import type { AppIconId } from '../../lib/app-icon.js'

import neonAmber from '../../../assets/alternate-icons/neon-amber.png'
import neonCyan from '../../../assets/alternate-icons/neon-cyan.png'
import synthwave from '../../../assets/alternate-icons/synthwave.png'
import midnight from '../../../assets/alternate-icons/midnight.png'
import mint from '../../../assets/alternate-icons/mint.png'
import lava from '../../../assets/alternate-icons/lava.png'
import gold from '../../../assets/alternate-icons/gold.png'
import owl from '../../../assets/alternate-icons/owl.png'
import home from '../../../assets/alternate-icons/home.png'
import constellation from '../../../assets/alternate-icons/constellation.png'
import defaultIcon from '../../../assets/images/icon.png'

type ImageSource = ImageProps['source']

/** The launcher icon art shown in the picker: the default plus one flat PNG per alternate. */
export const DEFAULT_ICON_THUMB: ImageSource = defaultIcon

export const APP_ICON_THUMBS: Record<AppIconId, ImageSource> = {
  NeonAmber: neonAmber,
  NeonCyan: neonCyan,
  Synthwave: synthwave,
  Midnight: midnight,
  Mint: mint,
  Lava: lava,
  Gold: gold,
  Owl: owl,
  Home: home,
  Constellation: constellation,
}
