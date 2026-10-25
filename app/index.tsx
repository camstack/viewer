// Auth gate. Branches on the persisted active-server state: loading spinner →
// login → redirect into the bottom-tab navigator. Relative imports (the `@v2/*`
// tsconfig alias is type-only; Metro resolves paths at runtime).
import { ActivityIndicator, View } from "react-native";
import { Redirect, type Href } from "expo-router";
import {
  peekPendingDeepLinkHub,
  takePendingDeepLink,
} from "../src/navigation/pending-deep-link";
import { useServer } from "../src/app/ServerProvider";
import { useTheme } from "../src/theme/theme-provider";
import { LoginScreen } from "../src/screens/LoginScreen";
import {
  HubSessionBootstrap,
  canReuseHubSession,
} from "../src/auth/HubSessionBootstrap";

export default function Index() {
  const { loading, server, token } = useServer();
  const { colors } = useTheme();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!server || !token) {
    // Hub-served web build with no config yet: reuse the admin session
    // (httpOnly cookie → auth.exchangeSession) instead of asking the
    // operator to log in twice. Falls back to the login screen when the
    // exchange definitively fails.
    if (canReuseHubSession(false)) {
      return <HubSessionBootstrap fallback={<LoginScreen />} />;
    }
    // A cold-start link that named its hub (`?hub=`) prefills the login with
    // it — a suggestion in an editable field, never a saved server.
    const linkHub = peekPendingDeepLinkHub();
    return linkHub !== null ? <LoginScreen initialServerUrl={linkHub} /> : <LoginScreen />;
  }

  // A cold start that was OPENING a deep link resumes it here, once —
  // otherwise the default tab. See src/navigation/pending-deep-link.ts.
  //
  // Documented type boundary: the stash holds a runtime URL that
  // isStashableDeepLink has already constrained to this app's route families;
  // expo-router's Href is a template-literal union no runtime string can
  // satisfy structurally.
  const pending = takePendingDeepLink();
  if (pending !== null) return <Redirect href={pending as Href} />;
  return <Redirect href="/cameras" />;
}
