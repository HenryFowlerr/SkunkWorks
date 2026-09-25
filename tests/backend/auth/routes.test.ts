import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as signIn } from "@/app/api/auth/sign-in/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("auth route configuration boundary", () => {
  it("returns an honest provider-unavailable envelope without Supabase configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const response = await signIn(new Request("https://skunkworks.example/api/auth/sign-in", {
      method: "POST",
      headers: {
        origin: "https://skunkworks.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "designer@example.test", password: "correct-horse-battery" }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: "The sign-in service is not configured.",
        retryable: false,
      },
      meta: { contractVersion: "1.0" },
    });
  });
});
