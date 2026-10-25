// Notification Center — rules + delivery targets. Reached two ways: as the
// Notifications tab, and as a stacked alias pushed OVER the tabs via the
// parent (app)/_layout.tsx Stack so an old bookmark does not 404.
import { NotificationCenterScreen } from "../../../src/screens/notifications/NotificationCenterScreen";

export default function NotificationsRoute() {
  return <NotificationCenterScreen />;
}
