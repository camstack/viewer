// A new notification rule. Without a kind it is the kind picker; the picker
// `replace`s to `/rule/new?kind=…` — which lands HERE again (a static segment
// wins over `[id]`), so a known kind renders the editor summary directly.
import { useLocalSearchParams } from "expo-router";
import { parseKind } from "../../../src/components/notifications/rule-kind-nav";
import { KindPickerScreen } from "../../../src/screens/notifications/rule-editor/KindPickerScreen";
import { RuleSummaryScreen } from "../../../src/screens/notifications/rule-editor/RuleSummaryScreen";

export default function NewRuleRoute() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const parsed = parseKind(kind);
  return parsed === undefined ? <KindPickerScreen /> : <RuleSummaryScreen id="new" kind={parsed} />;
}
