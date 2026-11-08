// A device's detail, full screen. A stacked route in the (app) group, pushed
// OVER the tabs like remote/[id]; reached with `router.push('/device/<id>')`
// from an accessory row. router.back() pops back to where it opened.
import { useLocalSearchParams } from "expo-router";
import { DeviceDetailScreen } from "../../../src/screens/DeviceDetailScreen";

export default function DeviceRoute() {
  const { id, name, type } = useLocalSearchParams<{ id: string; name?: string; type?: string }>();
  const deviceId = Number(id);
  if (!Number.isFinite(deviceId)) return null;
  return <DeviceDetailScreen deviceId={deviceId} deviceName={name ?? ""} deviceType={type ?? ""} />;
}
