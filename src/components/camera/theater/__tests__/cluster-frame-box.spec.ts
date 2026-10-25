import { describe, expect, it } from 'vitest'

import {
  CLUSTER_PANEL_HEIGHT,
  CLUSTER_PANEL_ITEM_HEIGHT,
  CLUSTER_PANEL_THUMB_HEIGHT,
  clusterCardHeight,
  CLUSTER_CLIP_CAPTION_HEIGHT,
  clusterClipCardHeight,
  clusterClipItemHeight,
  clusterClipThumbWidth,
  clusterPanelItemWidth,
} from '../cluster-frame-box.js'

describe('the cluster gallery panel metrics', () => {
  it('thumbnails are the gallery overlay\'s 124x76 (102 with caption), 20 % larger', () => {
    expect(CLUSTER_PANEL_THUMB_HEIGHT).toBe(91)
    expect(CLUSTER_PANEL_ITEM_HEIGHT).toBe(122)
    expect(clusterPanelItemWidth(10_000)).toBe(149)
  })

  it('the width never goes under the floor and ~2.4 thumbnails fit a phone card', () => {
    expect(clusterPanelItemWidth(0)).toBe(106)
    expect(clusterPanelItemWidth(300)).toBeGreaterThanOrEqual(106)
    expect(clusterPanelItemWidth(300)).toBeLessThanOrEqual(149)
  })

  it('the card height is the panel height once the width is measured', () => {
    expect(clusterCardHeight(300)).toBe(CLUSTER_PANEL_HEIGHT)
    expect(clusterCardHeight(0)).toBe(0)
  })

  it('clips mode uses a centred 16:9 card height helper', () => {
    expect(clusterCardHeight(300, true)).toBe(clusterClipCardHeight(300))
    expect(clusterCardHeight(300, true)).not.toBe(clusterCardHeight(300))
    expect(clusterClipItemHeight(300)).toBe(
      Math.round((clusterClipThumbWidth(300) * 9) / 16) + CLUSTER_CLIP_CAPTION_HEIGHT,
    )
  })
})
