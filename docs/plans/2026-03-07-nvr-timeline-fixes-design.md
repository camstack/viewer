# Separate NVR Timeline Fixes Design

**Date:** 2026-03-07
**Status:** Approved
**Context:** Fix Separate NVR timeline continuous mode and thumbnail scrubbing issues

## Problem Statement

Three critical issues in Separate NVR timeline implementation:

1. **Continuous Cursor Toggle**: Remove unnecessary UI toggle for continuous/discrete cursor mode
2. **Broken Thumbnail System**: Fast thumbnails during timeline scrubbing don't work - thumbnails don't update and player gets stuck
3. **Cursor Label Drift**: Timeline cursor label jumps by several minutes at the end of scrolling

## Current Architecture Analysis

### Timeline System
- `TheaterTimeline.tsx` manages scroll handling with dual cursor modes
- `useContinuousCursor` state toggles between discrete and Separate NVR-style continuous mapping
- `nvrScrubTimeChange()` handles thumbnail updates during scroll
- `scrubThumbnailUrl` state controls thumbnail display in `CameraStreamPlayer`

### Problems Identified
- **Mode Toggle**: Unnecessary complexity with continuous/discrete toggle
- **Thumbnail Updates**: `nvrScrubTimeChange` not triggering proper thumbnail refreshes
- **State Cleanup**: `scrubThumbnailUrl` not clearing properly when scroll ends
- **Time Mapping Inconsistency**: Different time calculation methods cause label drift

## Design Solution

### 1. Remove Continuous Cursor Toggle

**Changes:**
- Remove `useContinuousCursor` state from `TheaterTimeline.tsx`
- Hardcode continuous mode behavior (`useContinuousCursor = true`)
- Comment out toggle button in `TimelineFabControls.tsx`
- Simplify conditional logic dependent on cursor mode

**Files:**
- `src/components/TheaterTimeline/TheaterTimeline.tsx:465-466`
- `src/components/TheaterTimeline/TimelineFabControls.tsx:88-100`

### 2. Fix Thumbnail System

**Root Causes:**
- Insufficient update frequency during scroll
- Poor state cleanup when exiting scrub mode
- Inconsistent API call timing

**Solutions:**

#### A. Improve Update Frequency
- Ensure `nvrScrubTimeChange()` called on every scroll frame
- Optimize debouncing for responsive thumbnail updates
- Verify `continuousTimeMs` accuracy in all scroll conditions

#### B. Robust State Cleanup
- Implement automatic `scrubThumbnailUrl` reset on scroll end
- Add timeout-based cleanup for stuck states
- Improve scroll end detection reliability

#### C. API Call Optimization
- Reduce thumbnail API debounce timing
- Add request cancellation for rapid scroll changes
- Implement proper error handling for thumbnail failures

### 3. Fix Cursor Label Drift

**Root Cause:**
Inconsistent time mapping between scroll (continuous) and post-scroll (potentially discrete) phases.

**Solution:**
- **Consistency**: Always use `continuousTimeMs` for label calculation
- **Position Locking**: Freeze final cursor position when scroll ends
- **Prevent Auto-Updates**: Block automatic label changes after scroll completion

**Implementation:**
1. Save final `displayTimeMs` when `userScrollingRef.current = false`
2. Lock this value and prevent further automatic updates
3. Ensure `setNvrPlaybackTimeMs()` uses locked value consistently

## Implementation Strategy

### Phase 1: Remove Toggle (Low Risk)
- Comment out continuous cursor toggle UI
- Hardcode `useContinuousCursor = true`
- Test basic timeline functionality

### Phase 2: Fix Thumbnail System (Medium Risk)
- Improve `nvrScrubTimeChange()` call frequency
- Enhance state cleanup logic
- Add debugging logs for thumbnail flow

### Phase 3: Fix Label Drift (Low Risk)
- Implement position locking mechanism
- Prevent post-scroll label updates
- Verify time mapping consistency

## Testing Plan

### Manual Testing
- **Scroll Performance**: Fast/slow timeline scrolling
- **Thumbnail Updates**: Verify rapid thumbnail changes during scroll
- **State Transitions**: Thumbnail → Live stream transitions
- **Label Accuracy**: Cursor label remains stable at scroll end
- **Network Conditions**: Test with slow/fast API responses

### Regression Testing
- Ensure existing videoclip playback still works
- Verify live stream functionality unaffected
- Test other timeline features (zoom, filters)

## Risk Assessment

**Low Risk:**
- Continuous mode toggle removal (UI only)
- Cursor label drift fix (timing logic)

**Medium Risk:**
- Thumbnail system changes (affects core scrubbing)

**Mitigation:**
- Incremental implementation with testing between phases
- Preserve existing fallback mechanisms
- Add comprehensive logging for debugging

## Success Criteria

1. ✅ Continuous cursor toggle removed from UI
2. ✅ Thumbnail updates work smoothly during timeline scroll
3. ✅ Player returns to live/clip view when scroll ends
4. ✅ Cursor label remains stable at final scroll position
5. ✅ No regressions in existing timeline functionality

## Follow-up Considerations

- Monitor thumbnail API performance under heavy usage
- Consider implementing thumbnail caching for better UX
- Evaluate broader timeline architecture improvements based on learnings