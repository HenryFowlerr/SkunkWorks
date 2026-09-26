import {
  CONTRACT_VERSION,
  IdempotencyKeySchema,
  ApiWireErrorCodeSchema,
  type ApiErrorEnvelope,
  type ApiWireErrorCode,
} from "../../contracts/api";
import { z } from "zod";
import { AiProviderError } from "../ai/types";
import { DomainError } from "../domain/errors";
import {
  assertJsonRequest,
  assertSameOrigin,
  createRequestId,
  RequestSecurityError,
} from "./request-security";

const STATUS_BY_CODE: Record<ApiWireErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  VERSION_CONFLICT: 409,
  UNSUPPORTED_ASSET: 415,
  MAPPING_REQUIRED: 422,
  REVIEW_REQUIRED: 422,
  GENERATION_RUNNING: 409,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_TIMEOUT: 504,
  RATE_LIMITED: 429,
  RELEASE_REVOKED: 410,
  IDEMPOTENCY_KEY_REUSED: 409,
  INTERNAL_ERROR: 500,
};

export class ApiFault extends Error {
  constructor(
    readonly code: ApiWireErrorCode,
    message: string,
    readonly options: {
    fieldErrors?: Record<string, string[]>;
    retryable?: boolean;
    status?: number;
    retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "ApiFault";
  }

  get status(): number {
    return this.options.status ?? STATUS_BY_CODE[this.code];
  }
}

function fieldErrorsFromZod(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "body" : issue.path.map(String).join(".");
    (result[path] ??= []).push(issue.message);
  }
  return result;
}

export async function parseApiBody<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  assertSameOrigin(request);
  assertJsonRequest(request);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw new ApiFault("VALIDATION_FAILED", "The request body must contain valid JSON.", {
      fieldErrors: { body: ["Invalid JSON."] },
    });
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiFault("VALIDATION_FAILED", "Check the request fields and try again.", {
      fieldErrors: fieldErrorsFromZod(parsed.error),
    });
  }

  return parsed.data;
}

/** Enforces the documented Idempotency-Key header and keeps any body mirror aligned. */
export function readIdempotencyKey(request: Request, bodyKey?: string): string {
  const rawKey = request.headers.get("idempotency-key");
  const parsed = IdempotencyKeySchema.safeParse(rawKey);

  if (!parsed.success) {
    throw new ApiFault("VALIDATION_FAILED", "A valid Idempotency-Key header is required.", {
      fieldErrors: { "Idempotency-Key": ["Provide a key between 16 and 128 characters."] },
    });
  }

  if (bodyKey !== undefined && bodyKey !== parsed.data) {
    throw new ApiFault("VALIDATION_FAILED", "The idempotency key in the body must match the request header.", {
      fieldErrors: { idempotencyKey: ["The body value does not match Idempotency-Key."] },
    });
  }

  return parsed.data;
}

export function successResponse<TData>(
  data: TData,
  options: { requestId?: string; status?: number } = {},
): Response {
  const requestId = options.requestId ?? createRequestId();
  return Response.json(
    {
      data,
      meta: { requestId, contractVersion: CONTRACT_VERSION },
    },
    {
      status: options.status ?? 200,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}

export function errorResponse(
  cause: unknown,
  options: { requestId?: string } = {},
): Response {
  const requestId = options.requestId ?? createRequestId();
  let fault: ApiFault;

  if (cause instanceof ApiFault) {
    fault = cause;
  } else if (cause instanceof RequestSecurityError) {
    fault = new ApiFault("FORBIDDEN", cause.message, { status: cause.status });
  } else if (cause instanceof Error && cause.name === "SupabaseConfigurationError") {
    fault = new ApiFault("PROVIDER_UNAVAILABLE", "The sign-in service is not configured.", {
      retryable: false,
    });
  } else if (cause instanceof DomainError) {
    const code = cause.code === "GENERATION_STALE" ? "VERSION_CONFLICT" : cause.code;
    fault = new ApiFault(code, cause.message);
  } else if (
    cause instanceof Error &&
    cause.name === "DataAdapterError" &&
    "code" in cause
  ) {
    const parsedCode = ApiWireErrorCodeSchema.safeParse(cause.code);
    fault = new ApiFault(
      parsedCode.success ? parsedCode.data : "INTERNAL_ERROR",
      cause.message || "The data operation could not be completed.",
    );
  } else if (cause instanceof AiProviderError) {
    const code = cause.code === "PROVIDER_TIMEOUT"
      ? "PROVIDER_TIMEOUT"
      : cause.code === "PROVIDER_UNAVAILABLE" ||
          cause.code === "MISSING_CREDENTIALS" ||
          cause.code === "MISSING_MODEL_CONFIGURATION" ||
          cause.code === "MODEL_OR_FEATURE_UNAVAILABLE"
        ? "PROVIDER_UNAVAILABLE"
        : "VALIDATION_FAILED";
    fault = new ApiFault(code, cause.message, { retryable: cause.retryable });
  } else if (cause instanceof z.ZodError) {
    fault = new ApiFault("VALIDATION_FAILED", "Check the request fields and try again.", {
      fieldErrors: fieldErrorsFromZod(cause),
    });
  } else {
    fault = new ApiFault("INTERNAL_ERROR", "The request could not be completed.");
  }

  const error: ApiErrorEnvelope = {
    error: {
      code: fault.code,
      message: fault.message,
      ...(fault.options.fieldErrors ? { fieldErrors: fault.options.fieldErrors } : {}),
      retryable: fault.options.retryable ?? false,
    },
    meta: { requestId, contractVersion: CONTRACT_VERSION },
  };

  return Response.json(error, {
    status: fault.status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...(fault.options.retryAfterSeconds
        ? { "retry-after": String(Math.max(1, Math.ceil(fault.options.retryAfterSeconds))) }
        : {}),
    },
  });
}

/** Keeps every route on the same success/error envelope and request ID. */
export async function handleApiOperation<TData>(
  operation: (requestId: string) => Promise<TData>,
  options: { status?: number } = {},
): Promise<Response> {
  const requestId = createRequestId();
  try {
    return successResponse(await operation(requestId), {
      requestId,
      status: options.status,
    });
  } catch (cause) {
    return errorResponse(cause, { requestId });
  }
}
