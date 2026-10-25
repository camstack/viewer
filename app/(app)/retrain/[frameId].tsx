// The retrain annotation editor — one corpus frame, full screen. A stacked
// route in the (app) group, pushed over the Library's Retrain grid. Reachable
// by URL too, so it mounts only for a session holding the `retrain` feature.
import { useLocalSearchParams } from "expo-router";
import { parseRetrainScope } from "../../../src/navigation/retrain-routes";
import { FeatureRouteGate } from "../../../src/navigation/FeatureRouteGate";
import { RetrainEditorScreen } from "../../../src/screens/retrain/editor/RetrainEditorScreen";

export default function RetrainFrameRoute() {
  const params = useLocalSearchParams<{
    frameId: string;
    deviceId?: string;
    collectionId?: string;
  }>();
  const scope = parseRetrainScope(params);
  return (
    <FeatureRouteGate feature="retrain">
      <RetrainEditorScreen
        frameId={params.frameId}
        deviceId={scope.deviceId}
        collectionId={scope.collectionId}
      />
    </FeatureRouteGate>
  );
}
