// Single-camera live detail. A stacked route in the (app) group, pushed OVER the
// tabs via the parent (app)/_layout.tsx Stack — reached with
// `router.push('/camera/<id>')` from the cameras list. Not a tab (not registered
// in TabsNavigator's TabList); router.back() pops back to the tabs.
import { Stack, useLocalSearchParams } from "expo-router";
import { CameraDetailScreen } from "../../../src/screens/CameraDetailScreen";

export default function CameraDetailRoute() {
  // Optional `at` (epoch ms): open the camera ALREADY seeked to a recorded
  // moment — the events page / reel "go to this moment" navigation carries it
  // (without it the screen always opened LIVE and the button felt broken).
  const { id, at } = useLocalSearchParams<{ id: string; at?: string }>();
  const deviceId = Number(id);
  const atMs = at !== undefined ? Number(at) : Number.NaN;
  if (!Number.isFinite(deviceId)) return null;
  // NOT keyed by device id any more (2026-09-12, D483).
  //
  // It used to be: `router.replace('/camera/<id>')` re-renders this SAME route
  // with new params, and the key forced a clean screen remount — "fresh WebRTC
  // session, playback machine, per-camera seeds". That was deliberate and it
  // was the reason a camera change felt like a page reload: the remount tore
  // down the WebRTC session and paid the whole cold path again.
  //
  // The operator asked for the opposite («cambia semplicemente la camera nello
  // scope corrente senza ricaricare tutto»), so the screen now stays mounted
  // and swaps in place. Note what this does NOT cost: `replace` still updates
  // the route, so the URL keeps naming the camera on screen and back still
  // returns to the list. The remount was never required BY the route change —
  // it was required by this key.
  //
  // What the key was buying is now explicit, in one render-time block in
  // `CameraDetailScreen` (search `shownDeviceId`): every piece of per-camera
  // state is reset there, and the playhead is reset AND seeded with the instant
  // the gesture carried. Anything added to that screen which describes THE
  // CAMERA rather than THE SCREEN has to be reset there too — there is no
  // longer a remount to do it for free.
  return (
    <>
      <Stack.Screen
        options={{
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
          // Contained-transparent from FIRST mount, never flipped later.
          // Changing `presentation` on an already-pushed native screen remounts
          // it and renegotiates WebRTC (operator-visible error, 2026-08-23), so
          // this value is FIXED here rather than derived from any screen state.
          // `transparentModal` would be a separate iOS UIViewController whose
          // root view eats every touch; contained stays IN the stack
          // (OverCurrentContext).
          presentation: "containedTransparentModal",
          animation: "slide_from_right",
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
      <CameraDetailScreen
        deviceId={deviceId}
        initialSeekMs={Number.isFinite(atMs) && atMs > 0 ? atMs : undefined}
      />
    </>
  );
}
