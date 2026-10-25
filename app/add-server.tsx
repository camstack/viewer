// "Add server": the login for another hub while signed in to one. A root-stack
// route, outside the (app) auth group, so the connected app stays mounted
// underneath and the current server is never signed out.
import { AddServerScreen } from "../src/screens/AddServerScreen";

export default function AddServerRoute() {
  return <AddServerScreen />;
}
