export class RequestSecurityError extends Error {
  readonly status = 403;

  constructor(message = "This request is not allowed.") {
    super(message);
    this.name = "RequestSecurityError";
  }
}

/**
 * Cookie-authenticated state changes are accepted only from the exact origin
 * serving the API. A missing or opaque Origin fails closed; public release
 * access still uses this rule because visitors also rely on cookies.
 */
export function assertSameOrigin(request: Request): void {
  const rawOrigin = request.headers.get("origin");

  if (!rawOrigin || rawOrigin === "null") {
    throw new RequestSecurityError("A same-origin request is required.");
  }

  let requestOrigin: string;
  let suppliedOrigin: string;

  try {
    requestOrigin = new URL(request.url).origin;
    suppliedOrigin = new URL(rawOrigin).origin;
  } catch {
    throw new RequestSecurityError("A valid same-origin request is required.");
  }

  if (suppliedOrigin !== rawOrigin || suppliedOrigin !== requestOrigin) {
    throw new RequestSecurityError("A same-origin request is required.");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new RequestSecurityError("Cross-site requests are not allowed.");
  }
}

export function assertJsonRequest(request: Request): void {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestSecurityError("The request must use application/json.");
  }
}

export function createRequestId(): string {
  return crypto.randomUUID();
}
