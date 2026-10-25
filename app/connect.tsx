// `/connect?hub=<origin>` — the "add this server" link
// (https://camstack.zentik.app/connect?hub=…). OUTSIDE the (app) auth group on
// purpose: it must render, and survive its own login, while signed out. The
// rules (offer, never replace) live in src/connection/hub-link.ts.
import { ConnectScreen } from "../src/screens/ConnectScreen";

export default function ConnectRoute() {
  return <ConnectScreen />;
}
