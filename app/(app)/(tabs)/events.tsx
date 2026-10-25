// The Library tab. The ROUTE keeps the name `events`: every link shared from a
// track detail is spelled `camstack://events?trackId=…&deviceId=…`, and the tab
// still opens on the events page. `?section=artifacts` opens the gallery.
import { LibraryScreen } from "../../../src/screens/LibraryScreen";

export default function LibraryTab() {
  return <LibraryScreen />;
}
