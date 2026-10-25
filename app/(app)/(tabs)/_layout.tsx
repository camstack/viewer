// Bottom-tab layout. Pure headless-Tabs entry: the auth guard and the shared
// ConnectionProvider were lifted to the parent (app)/_layout.tsx Stack, so this
// only mounts the responsive nav UI. It must NOT introduce a Stack — TabsNavigator
// renders expo-router/ui's <Tabs>, and detail routes push over it from the (app) Stack.
import { TabsNavigator } from "../../../src/navigation/TabsNavigator";

export default function TabsLayout() {
  return <TabsNavigator />;
}
