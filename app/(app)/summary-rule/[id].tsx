// A multi-camera digest rule's editor — `new` or a rule id. A stacked route in
// the (app) group, pushed over the Notifications tab's Summary list.
import { useLocalSearchParams } from "expo-router";
import { SummaryEditorScreen } from "../../../src/screens/notifications/rule-editor/SummaryEditorScreen";

export default function SummaryRuleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SummaryEditorScreen id={id} />;
}
