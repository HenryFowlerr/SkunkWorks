import { VISITOR_SESSION_COOKIE_NAME } from "@/server/data/tokens";

export { VISITOR_SESSION_COOKIE_NAME };

/** Cookie tokens are base64url, so decoding them is unnecessary and unsafe. */
export function readVisitorSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const prefix = `${VISITOR_SESSION_COOKIE_NAME}=`;
  for (const segment of cookieHeader.split(";")) {
    const candidate = segment.trim();
    if (!candidate.startsWith(prefix)) continue;
    const value = candidate.slice(prefix.length);
    return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
  }
  return null;
}

export function visitorSessionSetCookie(
  request: Request,
  token: string,
  expiresAt: string,
): string {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new TypeError("Visitor session token is malformed.");
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) throw new TypeError("Visitor session expiry is malformed.");
  const maxAge = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${VISITOR_SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export function visitorSessionClearCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${VISITOR_SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
