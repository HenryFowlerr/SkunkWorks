import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/proxy-session";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

// The prepared public demo paths are deliberately excluded from auth/session middleware.
// Invite acceptance remains session-aware for the separate authenticated product flow.
export const config = {
  matcher: ["/invite/:path*"],
};
