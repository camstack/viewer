/**
 * CarouselPager — the shared arrows + counter shell around
 * {@link ../ui/carousel-paging.js}, so no surface has to re-derive what
 * "next" means at the last page.
 *
 * It renders NOTHING of its own content: the caller supplies `renderPage`,
 * and the pager mounts exactly the window `mountedCarouselIndices` allows —
 * the current page visibly, its immediate neighbours invisibly so their media
 * is fetched before the operator steps. Never the whole set: a 40-face
 * selection must cost 3 crop fetches, not 40.
 *
 * The index is CONTROLLED. The owner keeps it, because a modal that assigns
 * the visible page must know which page that is, and an internal index would
 * be a second copy of that fact.
 */
import React, { memo } from 'react'
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TABULAR } from '../../theme/tokens.js'
import {
  canStepCarousel,
  clampCarouselIndex,
  mountedCarouselIndices,
  stepCarouselIndex,
  type CarouselDirection,
} from './carousel-paging.js'

export interface CarouselPagerProps {
  readonly count: number
  readonly index: number
  readonly onIndexChange: (index: number) => void
  /** `visible` is false for the preloaded neighbours — the caller may use it
   *  to skip work an invisible page does not need. */
  readonly renderPage: (index: number, visible: boolean) => React.ReactNode
  /** Hide the "3/7" counter (a single-page pager never shows it anyway). */
  readonly hideCounter?: boolean
  readonly style?: StyleProp<ViewStyle>
}

export const CarouselPager = memo(function CarouselPager({
  count,
  index,
  onIndexChange,
  renderPage,
  hideCounter = false,
  style,
}: CarouselPagerProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const current = clampCarouselIndex(index, count)
  const step = (direction: CarouselDirection): void => {
    onIndexChange(stepCarouselIndex(current, direction, count))
  }

  return (
    <View style={style}>
      {mountedCarouselIndices(current, count).map((i) => (
        <View
          key={i}
          pointerEvents={i === current ? 'auto' : 'none'}
          style={i === current ? styles.page : [styles.page, styles.preloadHidden]}
        >
          {renderPage(i, i === current)}
        </View>
      ))}

      {canStepCarousel(current, -1, count) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('v2.theater.clusterPrevImage')}
          onPress={() => step(-1)}
          hitSlop={8}
          style={[styles.arrow, styles.arrowLeft, { backgroundColor: `${colors.background}CC` }]}
        >
          <ChevronLeft size={18} color={colors.foreground} />
        </Pressable>
      ) : null}
      {canStepCarousel(current, 1, count) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('v2.theater.clusterNextImage')}
          onPress={() => step(1)}
          hitSlop={8}
          style={[styles.arrow, styles.arrowRight, { backgroundColor: `${colors.background}CC` }]}
        >
          <ChevronRight size={18} color={colors.foreground} />
        </Pressable>
      ) : null}

      {!hideCounter && count > 1 ? (
        <View style={[styles.counter, { backgroundColor: `${colors.background}CC` }]}>
          <Text style={[styles.counterText, TABULAR, { color: colors.foreground }]}>
            {`${String(current + 1)}/${String(count)}`}
          </Text>
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  // Every page occupies the same box; only one is visible at a time, so the
  // pager's own height never depends on which page is showing.
  page: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  preloadHidden: { opacity: 0 },
  arrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowLeft: { left: SPACING.xs },
  arrowRight: { right: SPACING.xs },
  counter: {
    position: 'absolute',
    bottom: SPACING.xs,
    alignSelf: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  counterText: { fontSize: 11, fontWeight: '700' },
})
