import { NextResponse, type NextRequest } from "next/server";
import { SupabaseConfigurationError, updateSession } from "@/lib/auth/proxy-session";

export async function proxy(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (error) {
    const pathname = request.nextUrl.pathname;
    const hasRecoverableConfigurationScreen =
      pathname.startsWith("/parts/") ||
      pathname === "/studio" ||
      pathname.startsWith("/studio/");

    // Let public part pages and the workspace shell render their existing
    // truthful recovery states when a deployment lacks Supabase configuration.
    // This does not create a session or bypass the API's authorization checks.
    if (hasRecoverableConfigurationScreen && error instanceof SupabaseConfigurationError) {
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
