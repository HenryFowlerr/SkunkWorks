import "server-only";

export type DataErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "VALIDATION_FAILED"
  | "REVIEW_REQUIRED"
  | "RELEASE_REVOKED"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INTERNAL_ERROR";

export class DataAdapterError extends Error {
  constructor(
    readonly code: DataErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DataAdapterError";
  }
}

export function throwDatabaseError(
  error: { code?: string; message?: string } | null,
  operation: string,
): never | void {
  if (!error) return;

  const code: DataErrorCode =
    error.code === "40001" || error.message?.includes("VERSION_CONFLICT")
      ? "VERSION_CONFLICT"
      : error.code === "P0002" || error.message?.includes("NOT_FOUND")
        ? "NOT_FOUND"
      : error.message?.includes("FORBIDDEN")
        ? "FORBIDDEN"
        : error.message?.includes("VALIDATION_FAILED")
          ? "VALIDATION_FAILED"
        : error.message?.includes("REVIEW_REQUIRED")
          ? "REVIEW_REQUIRED"
          : error.message?.includes("RELEASE_REVOKED")
            ? "RELEASE_REVOKED"
            : error.message?.includes("IDEMPOTENCY_KEY_REUSED")
              ? "IDEMPOTENCY_KEY_REUSED"
              : error.code === "42501"
                ? "FORBIDDEN"
                : "INTERNAL_ERROR";

  // Keep provider messages out of API responses. Preserve the error as a cause
  // so server-side observability can inspect its code without logging secrets.
  throw new DataAdapterError(code, `Database operation failed: ${operation}.`, {
    cause: error,
  });
}
