// Notifications tab — the Notification Center (rules / targets / snooze).
// The stacked `/settings/notifications` route stays an alias for old deep links.
import { NotificationCenterScreen } from "../../../src/screens/notifications/NotificationCenterScreen";

export default function NotificationsTab() {
  return <NotificationCenterScreen embedded />;
}
