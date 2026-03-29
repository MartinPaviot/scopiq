import { redirect } from "next/navigation";

export default function Home() {
  // Middleware handles auth redirect. If we reach here, user is authenticated
  // and middleware redirected to /market. This is a fallback.
  redirect("/market");
}
