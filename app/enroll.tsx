// `camstack://enroll?hub=<origin>&code=<code>` — the link an admin's QR carries
// (D855). OUTSIDE the (app) auth group on purpose: the phone it enrolls may be
// one nobody can log in on, so it must render while signed out. With no code in
// the URL it opens the QR scanner instead.
import { EnrollScreen } from "../src/screens/EnrollScreen";

export default function EnrollRoute() {
  return <EnrollScreen />;
}
