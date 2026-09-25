export type DomainErrorCode =
  | "VALIDATION_FAILED"
  | "VERSION_CONFLICT"
  | "REVIEW_REQUIRED"
  | "MAPPING_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "IDEMPOTENCY_KEY_REUSED"
  | "GENERATION_STALE"
  | "RELEASE_REVOKED";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function assertExpectedVersion(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected !== actual) {
    throw new DomainError("VERSION_CONFLICT", "The resource changed. Reload it before saving.", {
      expectedVersion: expected,
      currentVersion: actual,
    });
  }
}
