// A rule's delivery history — admin only (the screen refuses anyone else). A
// stacked route in the (app) group, pushed over the Notifications tab from a
// rule card's "last run" line.
import { useLocalSearchParams } from "expo-router";
import { RuleHistoryScreen } from "../../../../../src/screens/notifications/RuleHistoryScreen";

export default function RuleHistoryRoute() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  return <RuleHistoryScreen id={params.id} name={params.name} />;
}
