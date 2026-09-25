import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { DataAdapterError } from "@/server/data/errors";
import { lookupWorkspaceInvite } from "@/server/data/tokens";

type RouteContext = { params: Promise<{ token: string }> };

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** Validates a copied invitation without redeeming it, then removes the token from the request URL. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  if (!TOKEN_PATTERN.test(token)) return unavailableInvite();

  try {
    await lookupWorkspaceInvite(createSupabaseServiceClient(getSupabasePrivilegedConfig()), token);
    const destination = new URL("/login", request.url);
    // Keep the bearer only in a URL fragment. Browsers do not send fragments in
    // HTTP requests or Referer headers; the login flow redeems it after auth.
    destination.hash = `invite=${encodeURIComponent(token)}`;
    return redirectWithoutCaching(destination);
  } catch (cause) {
    if (cause instanceof DataAdapterError && ["NOT_FOUND", "FORBIDDEN", "VALIDATION_FAILED"].includes(cause.code)) {
      return unavailableInvite();
    }
    return new Response("The invitation service is temporarily unavailable.", {
      status: 503,
      headers: securityHeaders(),
    });
  }
}

function redirectWithoutCaching(location: URL): Response {
  const headers = securityHeaders();
  headers.set("Location", location.toString());
  return new Response(null, { status: 303, headers });
}

function unavailableInvite(): Response {
  return new Response("This invitation is unavailable, expired, or already used.", {
    status: 410,
    headers: securityHeaders(),
  });
}

function securityHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": "text/plain; charset=utf-8",
  });
}
