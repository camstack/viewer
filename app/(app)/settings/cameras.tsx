// Cameras management — local rename / hide / reorder. A stacked route in the
// (app) group, pushed OVER the tabs via the parent (app)/_layout.tsx Stack —
// reached with `router.push('/settings/cameras')` from the cameras list header
// and the Settings screen. router.back() pops back to where it was opened.
import { CamerasManageScreen } from "../../../src/screens/CamerasManageScreen";

export default function CamerasManageRoute() {
  return <CamerasManageScreen />;
}
