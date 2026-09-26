import { NextResponse, type NextRequest } from "next/server";
import { SupabaseConfigurationError, updateSession } from "@/lib/auth/proxy-session";

export async function proxy(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (error) {
    // Let the part page show its truthful unavailable state in an unconfigured demo.
    if (request.nextUrl.pathname.startsWith("/parts/") && error instanceof SupabaseConfigurationError) {
      return NextResponse.next({ request });
    }
    throw error;
  }
}

// Protected pages need refreshed cookies before their server session checks.
// API handlers refresh their own cookies; legacy release floor routes are unchanged.
export const config = {
  matcher: ["/studio/:path*", "/parts/:path*"],
};
