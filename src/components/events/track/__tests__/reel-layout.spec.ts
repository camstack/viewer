/**
 * The reel's height contract: what the Cameras page reserves before the strip
 * has painted, and the surfaces that must all agree on it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  REEL_BLOCK_PADDING_BOTTOM,
  REEL_BLOCK_PADDING_TOP,
  REEL_CAPTION_LINE_HEIGHT,
  REEL_CAPTION_PADDING_BOTTOM,
  reelBlockHeight,
  reelRowHeight,
} from '../reel-layout.js'

const RECENT_REEL_SRC = readFileSync(join(__dirname, '..', 'RecentReelBlock.tsx'), 'utf8')
const SKELETON_SRC = readFileSync(
  join(__dirname, '..', '..', '..', 'CameraCardSkeleton.tsx'),
  'utf8',
)

describe('reelRowHeight', () => {
  it('is the square hero plus strip padding only', () => {
    expect(reelRowHeight(80)).toBe(80 + 8)
  })
})

/**
 * The RESERVED BLOCK, not just the strip.
 *
 * `reelRowHeight` only ever described the scrolling strip. The Cameras page
 * puts a caption above it and padding around it, and that whole block is what
 * has to be reserved before the embed has painted — otherwise the list still
 * jumps by the caption's height the moment the reel appears. Three surfaces
 * size off it (the fixed header, the cold-launch skeleton, the not-connected
 * placeholder), so it is ONE function, here, beside the strip contract it
 * builds on.
 */
describe('reelBlockHeight — what the Cameras page reserves', () => {
  it('is the strip plus the caption line and the block padding', () => {
    expect(reelBlockHeight(80)).toBe(
      REEL_BLOCK_PADDING_TOP +
        REEL_CAPTION_LINE_HEIGHT +
        REEL_CAPTION_PADDING_BOTTOM +
        reelRowHeight(80) +
        REEL_BLOCK_PADDING_BOTTOM,
    )
  })

  it('grows with the card preset, one-for-one with the strip', () => {
    // The user's reel-size preference moves the block by exactly what it moves
    // the strip — nothing else in the block depends on the card.
    for (const [small, large] of [[60, 80], [80, 106]] as const) {
      expect(reelBlockHeight(large) - reelBlockHeight(small)).toBe(
        reelRowHeight(large) - reelRowHeight(small),
      )
    }
  })

  it('reserves a caption line that a platform font cannot resize', () => {
    // The caption is rendered with this EXPLICIT lineHeight. Without it the
    // line is whatever the platform makes of `fontSize: 11` — iOS, Android and
    // the browser each pick a different number, and the reserved block is then
    // right on exactly one of them.
    expect(REEL_CAPTION_LINE_HEIGHT).toBeGreaterThan(0)
    expect(RECENT_REEL_SRC).toContain('lineHeight: REEL_CAPTION_LINE_HEIGHT')
  })
})

describe('the reel block is reserved by every surface that draws it', () => {
  it('the block itself sizes off `reelBlockHeight`', () => {
    expect(RECENT_REEL_SRC).toContain('reelBlockHeight(cardWidth)')
  })

  it('the cold-launch skeleton draws the SAME block, not its own strip', () => {
    // The skeleton used to hand-roll a reel row with different spacing, so the
    // cold-launch page and the loaded page did not agree on where the grid
    // starts. One component now, so they cannot drift.
    expect(SKELETON_SRC).toContain('<RecentReelBlock')
    expect(SKELETON_SRC).not.toContain('function ReelRowSkeleton')
  })
})
