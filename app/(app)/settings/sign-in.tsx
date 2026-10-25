// Sign-in methods — password, authenticator app, passkeys, linked accounts.
// A stacked route in the (app) group, pushed OVER the tabs from Settings →
// Account (`router.push('/settings/sign-in')`).
import { SignInMethodsScreen } from "../../../src/screens/settings/SignInMethodsScreen";

export default function SignInMethodsRoute() {
  return <SignInMethodsScreen />;
}
