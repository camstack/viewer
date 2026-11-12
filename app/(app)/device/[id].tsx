// A device's detail, in a sheet over the screen it was opened from (a bottom
// sheet on the phone, a centred dialog on the web — `DeviceDetailScreen`).
// Reached with `router.push('/device/<id>')` from an accessory row. The route
// is a transparent modal, so the screen underneath stays drawn; the sheet
// animates itself, so the route does not. router.back() closes it.
import { Stack, useLocalSearchParams } from "expo-router";
import { DeviceDetailScreen } from "../../../src/screens/DeviceDetailScreen";

export default function DeviceRoute() {
  const { id, name, type } = useLocalSearchParams<{ id: string; name?: string; type?: string }>();
  const deviceId = Number(id);
  if (!Number.isFinite(deviceId)) return null;
  return (
    <>
      <Stack.Screen
        options={{
          // Contained: stays IN the stack (OverCurrentContext) like camera/[id];
          // `transparentModal` would be a separate iOS view controller.
          presentation: "containedTransparentModal",
          animation: "none",
          gestureEnabled: false,
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
      <DeviceDetailScreen deviceId={deviceId} deviceName={name ?? ""} deviceType={type ?? ""} />
    </>
  );
}
