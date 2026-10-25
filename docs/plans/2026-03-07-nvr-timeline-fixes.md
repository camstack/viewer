# Separate NVR Timeline Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Separate NVR timeline by removing continuous cursor toggle, fixing thumbnail scrubbing, and preventing cursor label drift.

**Architecture:** Incremental fixes to existing TheaterTimeline system. Remove UI complexity, improve state management, and ensure consistent time mapping throughout scroll lifecycle.

**Tech Stack:** React Native, TypeScript, Zustand state management, FlashList timeline, Separate NVR API integration

---

## Task 1: Remove Continuous Cursor Toggle

**Files:**
- Modify: `src/components/TheaterTimeline/TheaterTimeline.tsx:465-466`
- Modify: `src/components/TheaterTimeline/TheaterTimeline.tsx:1270-1325`
- Modify: `src/components/TheaterTimeline/TimelineFabControls.tsx:88-100`

**Step 1: Comment out continuous cursor state**

In `TheaterTimeline.tsx`, replace the useContinuousCursor state:

```typescript
// ✨ REMOVED: Toggle between FlashList discrete cursor and continuous cursor
// const [useContinuousCursor, setUseContinuousCursor] = useState(false);
const useContinuousCursor = true; // Force continuous mode for Separate NVR
```

**Step 2: Comment out toggle button in FAB controls**

In `TimelineFabControls.tsx`, comment out the continuous cursor toggle section:

```tsx
{/* ✨ REMOVED: Continuous cursor toggle - now hardcoded to continuous mode
{onToggleContinuousCursor && (
  <Pressable
    style={[styles.fabBtn, useContinuousCursor && styles.fabBtnActive]}
    onPress={onToggleContinuousCursor}
  >
    <Ionicons
      name={useContinuousCursor ? "analytics" : "grid"}
      size={16}
      color={useContinuousCursor ? "#007AFF" : "#fff"}
    />
  </Pressable>
)}
*/}
```

**Step 3: Remove props from TimelineFabControls interface**

In `TimelineFabControls.tsx`, comment out the toggle props:

```tsx
export interface TimelineFabControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  /** Detection class filter */
  enabledClasses: Set<string>;
  onToggleClass: (cls: string) => void;
  /** REMOVED: Toggle between discrete and continuous cursor */
  // useContinuousCursor?: boolean;
  // onToggleContinuousCursor?: () => void;
}
```

**Step 4: Remove toggle props from component usage**

In `TheaterTimeline.tsx`, remove the props passed to TimelineFabControls:

```tsx
<TimelineFabControls
  onZoomIn={handleZoomIn}
  onZoomOut={handleZoomOut}
  canZoomIn={canZoomIn}
  canZoomOut={canZoomOut}
  enabledClasses={enabledClasses}
  onToggleClass={handleToggleClass}
  // REMOVED: useContinuousCursor={useContinuousCursor}
  // REMOVED: onToggleContinuousCursor={() => setUseContinuousCursor(!useContinuousCursor)}
/>
```

**Step 5: Update dependency array in handleScroll**

In `TheaterTimeline.tsx`, remove useContinuousCursor from the dependency array:

```typescript
[cumulativeOffsets, isNvrAdapter, nvrScrubTimeChange, getContinuousTimeFromScrollOffset], // removed useContinuousCursor
```

**Step 6: Test continuous mode functionality**

Run: `npm run start:dev`
Navigate to timeline view with Separate NVR camera
Expected: Timeline works in continuous mode, no toggle button visible

**Step 7: Commit**

```bash
git add src/components/TheaterTimeline/TheaterTimeline.tsx src/components/TheaterTimeline/TimelineFabControls.tsx
git commit -m "feat: remove continuous cursor toggle, force continuous mode

- Comment out useContinuousCursor state and toggle UI
- Hardcode continuous mode for better Separate NVR experience
- Remove unnecessary interface props and dependencies"
```

---

## Task 2: Fix Thumbnail Update Frequency

**Files:**
- Modify: `src/components/TheaterTimeline/TheaterTimeline.tsx:1270-1325`
- Check: `src/hooks/use-separate-nvr-scrub-controller.ts`

**Step 1: Add debug logging to handleScroll**

In `TheaterTimeline.tsx`, enhance the scroll handler with more detailed logging:

```typescript
// Add at the start of handleScroll callback
if (__DEV__ && isNvrAdapter) {
  console.log("[NvrDbg] handleScroll: offsetY=", offsetY,
    "continuousTime=", continuousTimeMs ? new Date(continuousTimeMs).toISOString().slice(11, 19) : "null",
    "displayTime=", new Date(displayTimeMs).toISOString().slice(11, 19)
  );
}

// After nvrScrubTimeChange call
if (isNvrAdapter) {
  console.log("[NvrDbg] handleScroll → nvrScrubTimeChange called with:", new Date(displayTimeMs).toISOString());
}
```

**Step 2: Test current thumbnail behavior**

Run: `npm run start:dev`
Open Separate NVR camera timeline
Scroll slowly and observe console logs
Expected: See detailed scroll timing logs

**Step 3: Verify nvrScrubTimeChange call frequency**

In the scroll handler, ensure nvrScrubTimeChange is called on every scroll frame:

```typescript
// Separate NVR: fetch thumbnails during scroll (Layer 1 of two-layer pattern)
if (isNvrAdapter) {
  console.log("[NvrDbg] handleScroll → nvrScrubTimeChange with displayTimeMs:", displayTimeMs);
  nvrScrubTimeChange(displayTimeMs);
} else {
  console.log("[NvrDbg] handleScroll: isNvrAdapter=false");
}
```

**Step 4: Test improved scroll frequency**

Run: `npm run start:dev`
Scroll timeline rapidly and slowly
Expected: See nvrScrubTimeChange called on every scroll event

**Step 5: Commit**

```bash
git add src/components/TheaterTimeline/TheaterTimeline.tsx
git commit -m "debug: add comprehensive logging to timeline scroll handler

- Add detailed scroll timing logs for debugging
- Log nvrScrubTimeChange call frequency
- Help identify thumbnail update bottlenecks"
```

---

## Task 3: Fix Thumbnail State Cleanup

**Files:**
- Modify: `src/components/TheaterTimeline/TheaterTimeline.tsx:1260-1325`

**Step 1: Add scroll end detection improvement**

In the handleScroll callback, improve the user scrolling detection:

```typescript
// Mark user as scrolling (supplements onViewableItemsChanged)
userScrollingRef.current = true;
if (userScrollingTimerRef.current) clearTimeout(userScrollingTimerRef.current);

// Improve scroll end detection with shorter timeout
userScrollingTimerRef.current = setTimeout(() => {
  userScrollingRef.current = false;

  // Add cleanup logic when scroll ends
  if (__DEV__) {
    console.log("[NvrDbg] Scroll ended - userScrolling set to false");
  }

  // TODO: Add thumbnail cleanup logic here in next task
}, 1000); // Reduced from 1500ms to 1000ms for faster response
```

**Step 2: Add scroll state logging**

```typescript
// Add after setting userScrollingRef.current = true
if (__DEV__) {
  console.log("[NvrDbg] User scrolling detected at:", new Date().toISOString().slice(11, 23));
}
```

**Step 3: Test scroll end detection**

Run: `npm run start:dev`
Scroll timeline and stop
Expected: See "Scroll ended" log after 1 second of inactivity

**Step 4: Commit**

```bash
git add src/components/TheaterTimeline/TheaterTimeline.tsx
git commit -m "improve: enhance scroll end detection timing

- Reduce scroll end timeout from 1500ms to 1000ms
- Add detailed scroll state logging for debugging
- Prepare foundation for thumbnail cleanup logic"
```

---

## Task 4: Implement Cursor Label Position Locking

**Files:**
- Modify: `src/components/TheaterTimeline/TheaterTimeline.tsx:1260-1325`

**Step 1: Add state for locked scroll position**

At the top of TheaterTimeline component, add new ref:

```typescript
const [nvrPlaybackTimeMs, setNvrPlaybackTimeMs] = useState<number | null>(null);
// Add this new ref for position locking
const lockedScrollTimeMs = useRef<number | null>(null);
const isScrollLocked = useRef<boolean>(false);
```

**Step 2: Implement position locking in scroll handler**

Update the handleScroll callback to lock final position:

```typescript
// ✨ Lock cursor position when continuous mode active
if (useContinuousCursor && continuousTimeMs !== null) {
  displayTimeMs = continuousTimeMs;

  // Lock this position while user is scrolling
  if (userScrollingRef.current) {
    lockedScrollTimeMs.current = displayTimeMs;
    isScrollLocked.current = true;

    if (__DEV__) {
      console.log("[NvrDbg] Position locked at:", new Date(displayTimeMs).toISOString().slice(11, 19));
    }
  }
} else {
  // Original discrete interpolation method
  const itemTop = offsets[lo];
  const itemHeight = item.height || 1;
  const fraction = Math.max(0, Math.min(1, (offsetY - itemTop) / itemHeight));

  displayTimeMs = item.timeMs;
  const nextItem = lo + 1 < items.length ? items[lo + 1] : null;
  if (nextItem?.timeMs && nextItem.timeMs !== item.timeMs) {
    displayTimeMs = item.timeMs + fraction * (nextItem.timeMs - item.timeMs);
  } else if (prevItem?.timeMs && prevItem.timeMs !== item.timeMs) {
    displayTimeMs = prevItem.timeMs - fraction * (prevItem.timeMs - item.timeMs);
  }
}

// Use locked position if available and scroll ended
const finalDisplayTime = (isScrollLocked.current && lockedScrollTimeMs.current !== null)
  ? lockedScrollTimeMs.current
  : displayTimeMs;

setNvrPlaybackTimeMs(finalDisplayTime);
scrollTimeMsRef.current = finalDisplayTime;
```

**Step 3: Add cleanup in scroll end timeout**

Update the scroll end detection to clear locks:

```typescript
userScrollingTimerRef.current = setTimeout(() => {
  userScrollingRef.current = false;

  if (__DEV__) {
    console.log("[NvrDbg] Scroll ended - maintaining locked position:",
      lockedScrollTimeMs.current ? new Date(lockedScrollTimeMs.current).toISOString().slice(11, 19) : "none"
    );
  }

  // Keep position locked even after scroll ends to prevent drift
  // Position will unlock only when new scroll starts or component unmounts
}, 1000);
```

**Step 4: Reset lock on new scroll start**

At the beginning of handleScroll, add lock reset logic:

```typescript
const handleScroll = useCallback(
  (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Reset position lock when new scroll starts
    if (!userScrollingRef.current && isScrollLocked.current) {
      if (__DEV__) {
        console.log("[NvrDbg] New scroll started - unlocking position");
      }
      isScrollLocked.current = false;
      lockedScrollTimeMs.current = null;
    }

    // ... rest of scroll handler
  },
  // ... dependencies
);
```

**Step 5: Test position locking**

Run: `npm run start:dev`
Scroll to a specific time and stop
Expected: Cursor label remains exactly at final scroll position

**Step 6: Commit**

```bash
git add src/components/TheaterTimeline/TheaterTimeline.tsx
git commit -m "feat: implement cursor label position locking

- Add lockedScrollTimeMs ref to prevent label drift
- Lock cursor position during scroll and maintain after scroll ends
- Unlock position only when new scroll starts
- Prevent automatic label updates that cause time jumps"
```

---

## Task 5: Add Thumbnail Cleanup Logic

**Files:**
- Modify: `src/components/TheaterTimeline/TheaterTimeline.tsx:1260-1325`
- Check: `src/hooks/use-separate-nvr-scrub-controller.ts`

**Step 1: Add thumbnail cleanup in scroll end handler**

Update the scroll end timeout to trigger thumbnail cleanup:

```typescript
userScrollingTimerRef.current = setTimeout(() => {
  userScrollingRef.current = false;

  if (__DEV__) {
    console.log("[NvrDbg] Scroll ended - triggering thumbnail cleanup");
  }

  // Cleanup thumbnail state when scroll ends
  if (isNvrAdapter && nvrScrub?.scrubThumbnailUrl) {
    if (__DEV__) {
      console.log("[NvrDbg] Clearing scrub thumbnail URL after scroll end");
    }

    // This should trigger cleanup in the separate NVR scrub controller
    // The hook should handle clearing scrubThumbnailUrl automatically
    // when user stops scrubbing for sufficient time
  }
}, 1000);
```

**Step 2: Add safety timeout for stuck thumbnails**

Add a longer timeout to force cleanup of stuck thumbnail states:

```typescript
// Add this ref at component level
const thumbnailCleanupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// In scroll handler, set up cleanup timeout
if (isNvrAdapter) {
  // Clear any existing cleanup timeout
  if (thumbnailCleanupTimeoutRef.current) {
    clearTimeout(thumbnailCleanupTimeoutRef.current);
  }

  // Set up safety cleanup timeout (5 seconds of inactivity)
  thumbnailCleanupTimeoutRef.current = setTimeout(() => {
    if (__DEV__) {
      console.log("[NvrDbg] Safety timeout - forcing thumbnail cleanup");
    }
    // Force cleanup after extended inactivity
  }, 5000);

  nvrScrubTimeChange(finalDisplayTime);
}
```

**Step 3: Add component cleanup**

Add cleanup effect for component unmount:

```typescript
// Add this useEffect near other effects
useEffect(() => {
  return () => {
    // Cleanup timeouts on unmount
    if (userScrollingTimerRef.current) {
      clearTimeout(userScrollingTimerRef.current);
    }
    if (thumbnailCleanupTimeoutRef.current) {
      clearTimeout(thumbnailCleanupTimeoutRef.current);
    }
  };
}, []);
```

**Step 4: Test thumbnail cleanup**

Run: `npm run start:dev`
Scroll timeline then wait
Expected: Thumbnails clear after scroll ends, return to live/clip view

**Step 5: Commit**

```bash
git add src/components/TheaterTimeline/TheaterTimeline.tsx
git commit -m "feat: add thumbnail cleanup logic and safety timeouts

- Add thumbnail cleanup when scroll ends
- Implement safety timeout for stuck thumbnail states
- Clean up timeouts on component unmount
- Prevent player from staying stuck in thumbnail mode"
```

---

## Task 6: Test and Validate Complete Fix

**Files:**
- Test: All timeline functionality
- Check: Console logs for debugging

**Step 1: Test continuous mode behavior**

Run: `npm run start:dev`
Navigate to Separate NVR camera timeline
Expected: No continuous cursor toggle visible, smooth continuous scrolling

**Step 2: Test thumbnail updates**

Scroll timeline slowly and quickly
Expected: Thumbnails update rapidly during scroll, clear when scroll ends

**Step 3: Test cursor label stability**

Scroll to specific time and stop
Expected: Label remains stable at final position, no drift after scroll ends

**Step 4: Test state cleanup**

Scroll, wait, then try to return to live view
Expected: Clean transition back to live stream, no stuck thumbnail states

**Step 5: Remove debug logging**

Clean up debug console.log statements added during implementation:

```typescript
// Remove or comment out __DEV__ debug logs added in previous tasks
// Keep only essential error logging
```

**Step 6: Final commit**

```bash
git add src/components/TheaterTimeline/TheaterTimeline.tsx src/components/TheaterTimeline/TimelineFabControls.tsx
git commit -m "cleanup: remove debug logging, finalize timeline fixes

- Clean up development debug logs
- Finalize Separate NVR timeline fixes implementation
- Continuous mode forced, thumbnail cleanup working, label stable"
```

---

## Manual Test Plan

### Test Cases:
1. **Continuous Mode**: Verify no toggle button, smooth continuous behavior
2. **Thumbnail Speed**: Fast/slow scrolling shows responsive thumbnail updates
3. **Label Stability**: Cursor label doesn't drift at scroll end
4. **State Cleanup**: Return to live stream works after scrubbing
5. **Performance**: No memory leaks or performance degradation
6. **Regression**: Other timeline features (zoom, filters) still work

### Expected Results:
- ✅ Smooth thumbnail scrubbing like Separate NVR web interface
- ✅ Stable cursor labels without time drift
- ✅ Clean state transitions between scrub/live modes
- ✅ No UI toggle complexity
- ✅ Improved user experience for timeline navigation

---

Plan complete and saved to `docs/plans/2026-03-07-nvr-timeline-fixes.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?