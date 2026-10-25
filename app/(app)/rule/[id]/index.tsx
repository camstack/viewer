// A notification rule's editor summary — one row per section of its kind. A
// stacked route in the (app) group, pushed over the Notifications tab.
import { useLocalSearchParams } from "expo-router";
import { RuleSummaryScreen } from "../../../../src/screens/notifications/rule-editor/RuleSummaryScreen";

export default function RuleRoute() {
  const params = useLocalSearchParams<{ id: string; kind?: string }>();
  return <RuleSummaryScreen id={params.id} kind={params.kind} />;
}
