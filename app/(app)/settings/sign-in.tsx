// Old deep link: sign-in methods moved into the shell Account screen (D1102).
import { Redirect } from "expo-router";

export default function SignInMethodsRedirect() {
  return <Redirect href="/account" />;
}
