import 'server-only';

import { createHash, createHmac, randomBytes } from 'node:crypto';

export const VISITOR_COOKIE = 'chappe_visitor_session';
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A repeatable token makes a retried issue request return the same QR. */
export function deriveReleaseLinkToken(input: {
  secret: string;
  actorId: string;
  releaseId: string;
  idempotencyKey: string;
}): string {
  return createHmac('sha256', input.secret)
    .update(JSON.stringify(['chappe.release-link.v1', input.actorId, input.releaseId, input.idempotencyKey]))
    .digest('base64url');
}

export function createVisitorSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashReleaseToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
