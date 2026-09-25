import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { exchangeReleaseAccessLink } from "@/server/data/tokens";
import { DataAdapterError } from "@/server/data/errors";
import { visitorSessionSetCookie } from "@/server/access/visitor-cookie";

type RouteContext = { params: Promise<{ token: string }> };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  if (!TOKEN_PATTERN.test(token)) return unavailableLink();

  try {
    const config = getSupabasePrivilegedConfig();
    const exchange = await exchangeReleaseAccessLink({
      serviceClient: createSupabaseServiceClient(config),
      linkToken: token,
    });
    const location = new URL(`/floor/${encodeURIComponent(exchange.scope.releaseId)}`, request.url);
    const headers = new Headers({
      Location: location.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    headers.append("Set-Cookie", visitorSessionSetCookie(request, exchange.sessionToken, exchange.scope.expiresAt));
    return new Response(null, { status: 303, headers });
  } catch (cause) {
    if (cause instanceof DataAdapterError && ["NOT_FOUND", "RELEASE_REVOKED", "FORBIDDEN"].includes(cause.code)) {
      return unavailableLink();
    }
    return new Response("The shared release service is temporarily unavailable.", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}

function unavailableLink(): Response {
  return new Response("This shared release link is unavailable or has expired.", {
    status: 410,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
