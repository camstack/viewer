// ON-THE-FLY grid: `/grid/adhoc?devices=1,2,3[&from=<camera>]` renders a
// TRANSIENT grid of the listed cameras. It is the SHARING format and the deep
// link — the camera screen builds its view in place and no longer navigates
// here. Nothing is persisted: the grid lives only in this screen instance's
// state. The static `adhoc` segment wins over the dynamic sibling `[id]`.
//
// Presented like the camera route (contained, transparent) so it stacks ABOVE
// a camera that is mounted under it: a plain push is placed UNDER the camera's
// modal chain on iOS, which left this grid's own back button untouchable.
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { GridViewScreen } from "../../../src/screens/GridViewScreen";
import { parseAdhocDeviceIds } from "../../../src/grid/adhoc-devices";
import { parseAdhocOrigin } from "../../../src/navigation/adhoc-back";

export default function AdhocGridRoute() {
  const { devices, from } = useLocalSearchParams<{ devices?: string; from?: string }>();
  const ids = useMemo(() => parseAdhocDeviceIds(devices), [devices]);
  const origin = useMemo(() => parseAdhocOrigin(from), [from]);
  if (ids.length === 0) return null;
  return (
    <>
      <Stack.Screen
        options={{
          gestureEnabled: false,
          fullScreenGestureEnabled: false,
          presentation: "containedTransparentModal",
          animation: "slide_from_right",
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
      <GridViewScreen gridId={null} adhocCameraIds={ids} originDeviceId={origin} />
    </>
  );
}
