import { redirect } from "next/navigation";

// The arena is the app's real home screen; the root path just lands there.
export default function Home() {
  redirect("/arena");
}
