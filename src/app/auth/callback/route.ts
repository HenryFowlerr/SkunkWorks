import { createSupabaseServerClient } from "@/lib/auth/server";
import { NextRequest, NextResponse } from "next/server";

function safeReturnPath(request: NextRequest): string {
  const requested = request.nextUrl.searchParams.get("next");
  if (!requested || !requested.startsWith("/") || requested.startsWith("//") || requested.startsWith("/\\")) {
    return "/studio";
  }

  try {
    const target = new URL(requested, request.url);
    return target.origin === request.nextUrl.origin
      ? target.pathname + target.search + target.hash
      : "/studio";
  } catch {
    return "/studio";
  }
}

function redirect(request: NextRequest, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const code = request.nextUrl.searchParams.get("code");
  const destination = safeReturnPath(request);

  if (!code) {
    return redirect(request, "/login?error=confirmation_failed");
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return redirect(request, "/login?error=confirmation_failed");
    }
    const { data, error: verifyError } = await supabase.auth.getUser();
    if (verifyError || !data.user) {
      return redirect(request, "/login?error=confirmation_failed");
    }
    return redirect(request, destination);
  } catch {
    return redirect(request, "/login?error=confirmation_failed");
  }
}
