import { describe, expect, it } from "vitest";
import {
  errorResponse,
  parseApiBody,
  readIdempotencyKey,
  successResponse,
  ApiFault,
} from "../../../src/server/http/api";
import { RequestSecurityError } from "../../../src/server/http/request-security";
import { DomainError } from "../../../src/server/domain/errors";
import { AiProviderError } from "../../../src/server/ai/types";
import { z } from "zod";

const BodySchema = z.object({ title: z.string().min(1) }).strict();

function jsonRequest(
  body: unknown,
  options: { origin?: string; contentType?: string; key?: string } = {},
) {
  return new Request("https://skunkworks.example/api/jobs", {
    method: "POST",
    headers: {
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.contentType ? { "content-type": options.contentType } : {}),
      ...(options.key ? { "Idempotency-Key": options.key } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("API envelope and request parsing", () => {
  it("returns the versioned success envelope with a request ID", async () => {
    const response = successResponse({ value: 2 });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      data: { value: 2 },
      meta: { contractVersion: "1.0" },
    });
  });

  it("parses strict JSON only after origin checks", async () => {
    const request = jsonRequest(
      { title: "Part 12" },
      { origin: "https://skunkworks.example", contentType: "application/json" },
    );
    await expect(parseApiBody(request, BodySchema)).resolves.toEqual({ title: "Part 12" });
  });

  it("returns field validation errors for malformed fields", async () => {
    const request = jsonRequest(
      { title: "" },
      { origin: "https://skunkworks.example", contentType: "application/json" },
    );
    await expect(parseApiBody(request, BodySchema)).rejects.toBeInstanceOf(ApiFault);
  });

  it("requires a matching idempotency header", () => {
    const key = "0123456789abcdef";
    const request = jsonRequest({}, { key });
    expect(readIdempotencyKey(request, key)).toBe(key);
    expect(() => readIdempotencyKey(request, key + "x")).toThrow(ApiFault);
    expect(() => readIdempotencyKey(jsonRequest({}))).toThrow(ApiFault);
  });

  it("maps security and internal failures to honest HTTP envelopes", async () => {
    const forbidden = errorResponse(new RequestSecurityError("Denied."));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN", message: "Denied.", retryable: false },
      meta: { contractVersion: "1.0" },
    });

    const internal = errorResponse(new Error("secret internal detail"));
    expect(internal.status).toBe(500);
    await expect(internal.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
    });
  });

  it("maps missing Supabase runtime configuration without exposing internals", async () => {
    const configurationError = new Error("Supabase server credentials are not configured.");
    configurationError.name = "SupabaseConfigurationError";
    const response = errorResponse(configurationError);
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE", message: "The sign-in service is not configured.", retryable: false },
      meta: { contractVersion: "1.0" },
    });
    expect(JSON.stringify(body)).not.toContain("credentials");
  });

  it("maps lifecycle conflicts and AI configuration failures to contract errors", async () => {
    const conflict = errorResponse(new DomainError("GENERATION_STALE", "Generation inputs changed."));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "VERSION_CONFLICT", message: "Generation inputs changed." },
    });

    const provider = errorResponse(new AiProviderError("MISSING_CREDENTIALS"));
    expect(provider.status).toBe(503);
    await expect(provider.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE", retryable: false },
    });
  });
});
