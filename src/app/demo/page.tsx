import { redirect } from "next/navigation";

/** Keep old /demo links inside the server-hosted application after retiring Pages. */
export default function DemoPage() {
  redirect("/");
}
