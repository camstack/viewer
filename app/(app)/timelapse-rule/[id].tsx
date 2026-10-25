// A scheduled timelapse rule's editor — `new` or a rule id. A stacked route in
// the (app) group, pushed over the Notifications tab's Timelapse list.
import { useLocalSearchParams } from "expo-router";
import { TimelapseEditorScreen } from "../../../src/screens/notifications/rule-editor/TimelapseEditorScreen";

export default function TimelapseRuleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TimelapseEditorScreen id={id} />;
}
