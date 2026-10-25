// Alarm configuration — admin only. A stacked route in the (app) group, pushed
// OVER the tabs via the parent (app)/_layout.tsx Stack — reached with
// `router.push('/settings/alarm')` from the Notification Center, which shows
// the entry only to a confirmed admin. A deep link from anyone else renders
// the hub's answer (admin only), never a blank form.
import { AlarmSettingsScreen } from "../../../src/screens/notifications/AlarmSettingsScreen";

export default function AlarmSettingsRoute() {
  return <AlarmSettingsScreen />;
}
