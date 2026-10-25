// ON-THE-FLY grid: `/grid/adhoc?devices=1,2,3` renders a TRANSIENT grid of the
// listed cameras (camera-switcher multiselect → "Open grid"). Nothing is
// persisted — the grid lives only in this screen instance's state, so there is
// no store entry and nothing to clean up on exit. The static `adhoc` segment
// wins over the dynamic sibling `[id]` in expo-router's matching.
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { GridViewScreen } from "../../../src/screens/GridViewScreen";
import { parseAdhocDeviceIds } from "../../../src/grid/adhoc-devices";

export default function AdhocGridRoute() {
  const { devices } = useLocalSearchParams<{ devices?: string }>();
  const ids = useMemo(() => parseAdhocDeviceIds(devices), [devices]);
  if (ids.length === 0) return null;
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
      <GridViewScreen gridId={null} adhocCameraIds={ids} />
    </>
  );
}
