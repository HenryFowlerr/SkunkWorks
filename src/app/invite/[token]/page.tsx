import type { Metadata } from "next";
import { InviteRedemption } from "@/features/studio/invites/invite-redemption";

export const metadata: Metadata = { title: "Join a Chappe workspace", robots: { index: false, follow: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteRedemption token={token} />;
}
