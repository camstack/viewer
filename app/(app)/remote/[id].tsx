// A device's remote, full screen. A stacked route in the (app) group, pushed
// OVER the tabs like camera/[id]; reached with `router.push('/remote/<id>')`
// from the media player's control. router.back() pops back to where it opened.
import { useLocalSearchParams } from "expo-router";
import { RemoteScreen } from "../../../src/screens/RemoteScreen";

export default function RemoteRoute() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const deviceId = Number(id);
  if (!Number.isFinite(deviceId)) return null;
  return <RemoteScreen deviceId={deviceId} deviceName={name ?? ""} />;
}
