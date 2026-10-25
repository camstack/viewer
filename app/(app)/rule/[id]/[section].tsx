// One section of a notification rule's editor. Edits the shared draft and pops
// back to the summary, which holds Save.
import { useLocalSearchParams } from "expo-router";
import { RuleSectionScreen } from "../../../../src/screens/notifications/rule-editor/RuleSectionScreen";

export default function RuleSectionRoute() {
  const params = useLocalSearchParams<{ id: string; section: string; kind?: string }>();
  return <RuleSectionScreen id={params.id} section={params.section} kind={params.kind} />;
}
