import "server-only";

import { createHash, createHmac } from "node:crypto";

/** Derive a repeatable bearer token for one admin request without persisting it. */
export function deriveInviteToken(input: {
  secret: string;
  actorId: string;
  workspaceId: string;
  idempotencyKey: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(JSON.stringify(["chappe.workspace-invite.v1", input.actorId, input.workspaceId, input.idempotencyKey]))
    .digest("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
