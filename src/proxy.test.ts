import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    updateSession: vi.fn(),
  };
});

vi.mock("@/lib/auth/proxy-session", () => ({
  updateSession: mocks.updateSession,
}));

import { config, proxy } from "./proxy";

function requestFor(pathname: string) {
  return { nextUrl: { pathname } } as Parameters<typeof proxy>[0];
}

describe("public demo proxy boundary", () => {
  beforeEach(() => {
    mocks.updateSession.mockReset();
  });

  it("runs session middleware only for invite acceptance", () => {
    expect(config.matcher).toEqual(["/invite/:path*"]);
  });

  it("keeps a verified invite session response unchanged", async () => {
    const request = requestFor("/invite/demo-token");
    const response = { kind: "verified-session" };
    mocks.updateSession.mockResolvedValue(response);

    await expect(proxy(request)).resolves.toBe(response);
    expect(mocks.updateSession).toHaveBeenCalledWith(request);
  });

  it("does not hide invite session failures", async () => {
    const request = requestFor("/invite/demo-token");
    const failure = new Error("Authentication provider timed out.");
    mocks.updateSession.mockRejectedValue(failure);

    await expect(proxy(request)).rejects.toBe(failure);
  });
});
