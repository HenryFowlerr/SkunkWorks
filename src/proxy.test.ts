import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TestSupabaseConfigurationError extends Error {
    constructor() {
      super("Supabase server credentials are not configured.");
      this.name = "SupabaseConfigurationError";
    }
  }

  return {
    next: vi.fn(),
    updateSession: vi.fn(),
    TestSupabaseConfigurationError,
  };
});

vi.mock("next/server", () => ({
  NextResponse: { next: mocks.next },
}));

vi.mock("@/lib/auth/proxy-session", () => ({
  SupabaseConfigurationError: mocks.TestSupabaseConfigurationError,
  updateSession: mocks.updateSession,
}));

import { proxy } from "./proxy";

function requestFor(pathname: string) {
  return { nextUrl: { pathname } } as Parameters<typeof proxy>[0];
}

describe("workspace session proxy", () => {
  beforeEach(() => {
    mocks.next.mockReset();
    mocks.updateSession.mockReset();
  });

  it.each(["/studio", "/studio/manufacturing"]) (
    "renders %s's existing recovery state when Supabase is unconfigured",
    async (pathname) => {
      const request = requestFor(pathname);
      const response = { kind: "next" };
      mocks.next.mockReturnValue(response);
      mocks.updateSession.mockRejectedValue(new mocks.TestSupabaseConfigurationError());

      await expect(proxy(request)).resolves.toBe(response);
      expect(mocks.next).toHaveBeenCalledWith({ request });
    },
  );

  it("keeps the existing public-part configuration fallback", async () => {
    const request = requestFor("/parts/part-1");
    const response = { kind: "next" };
    mocks.next.mockReturnValue(response);
    mocks.updateSession.mockRejectedValue(new mocks.TestSupabaseConfigurationError());

    await expect(proxy(request)).resolves.toBe(response);
  });

  it("does not turn a real session failure into a successful workspace response", async () => {
    const request = requestFor("/studio");
    const failure = new Error("Authentication provider timed out.");
    mocks.updateSession.mockRejectedValue(failure);

    await expect(proxy(request)).rejects.toBe(failure);
    expect(mocks.next).not.toHaveBeenCalled();
  });

  it("keeps a verified session response unchanged", async () => {
    const request = requestFor("/studio/manufacturing");
    const verifiedResponse = { kind: "verified-session" };
    mocks.updateSession.mockResolvedValue(verifiedResponse);

    await expect(proxy(request)).resolves.toBe(verifiedResponse);
    expect(mocks.next).not.toHaveBeenCalled();
  });
});
