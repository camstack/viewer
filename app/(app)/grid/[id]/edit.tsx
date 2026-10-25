// Grid builder (edit name + camera membership). A stacked route in the (app) group,
// pushed OVER the tabs via the parent (app)/_layout.tsx Stack — reached with
// `router.push('/grid/<id>/edit')` from the grids list (on create) and the grid
// view's pencil action. router.back() pops back to the previous screen.
import { useLocalSearchParams } from "expo-router";
import { GridBuilderScreen } from "../../../../src/screens/GridBuilderScreen";

export default function GridBuilderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <GridBuilderScreen gridId={id} />;
}
