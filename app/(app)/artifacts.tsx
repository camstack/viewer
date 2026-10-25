// Artifacts — the gallery of hub-produced media (timelapses, summary mosaics,
// and the clip / gif / still a notification rule cut). A stacked route in the
// (app) group, pushed OVER the tabs via the parent (app)/_layout.tsx Stack —
// kept so old deep links and bookmarks still land. The Library tab's Media
// section is the operator entry; Settings no longer links here (removed
// 2026-08-18 with the duplicate Cameras settings section).
// router.back() pops back to where it was opened.
import { ArtifactsScreen } from "../../src/screens/artifacts/ArtifactsScreen";

export default function ArtifactsRoute() {
  return <ArtifactsScreen />;
}
