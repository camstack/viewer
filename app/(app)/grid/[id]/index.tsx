// Live multi-camera grid view. A stacked route in the (app) group, pushed OVER the
// tabs via the parent (app)/_layout.tsx Stack — reached with
// `router.push('/grid/<id>')` from the grids list. Not a tab; router.back() pops
// back to the tabs. The singular `grid/[id]` mirrors the `camera/[id]` pattern.
import { Stack, useLocalSearchParams } from "expo-router";
import { GridViewScreen } from "../../../../src/screens/GridViewScreen";

export default function GridViewRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false, fullScreenGestureEnabled: false }} />
      <GridViewScreen gridId={id} />
    </>
  );
}
