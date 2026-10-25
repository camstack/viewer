// Exports — a stacked ALIAS of the Library's merged gallery, kept so an old
// bookmark or deep link does not 404. There is no Exports page any more: exports
// were merged into Artifacts on 2026-09-13 (they are the same class of thing —
// a file on the hub with a camera, an instant and a retention window), and the
// gallery lists them as one of its kinds. Landing here shows that gallery, which
// is where the exports now live; router.back() pops back to where it opened.
import { ArtifactsScreen } from "../../src/screens/artifacts/ArtifactsScreen";

export default function ExportsRoute() {
  return <ArtifactsScreen />;
}
