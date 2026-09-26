import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/proxy-session";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

// Studio pages need refreshed auth cookies before their session checks run.
// API handlers refresh their own cookies; the release-bound floor is public.
export const config = {
  matcher: ["/studio/:path*"],
};
