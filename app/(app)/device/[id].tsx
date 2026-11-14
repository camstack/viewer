// A device's detail, in a sheet over the screen it was opened from (a bottom
// sheet on the phone, a centred dialog on the web — `DeviceDetailScreen`).
// Reached with `router.push('/device/<id>')` from an accessory row. The route
// is a transparent modal, so the screen underneath stays drawn. The sheet
// itself is `DeviceCardSheetHost`, beside the navigator: this route only
// presents it, and leaving the route parks the document instead of destroying
// it. router.back() closes it.
import { useEffect } from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import { parkDeviceCard, presentDeviceCard } from "../../../src/device-embed/device-card-session";

function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default function DeviceRoute() {
  const { id, name, type } = useLocalSearchParams<{ id: string; name?: string; type?: string }>();
  const deviceId = Number(id);
  const known = Number.isFinite(deviceId) && deviceId > 0;
  useEffect(() => {
    if (!known) return;
    presentDeviceCard({ deviceId, deviceName: param(name), deviceType: param(type) });
    return () => parkDeviceCard();
  }, [deviceId, known, name, type]);
  if (!known) return null;
  return (
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
  );
}
