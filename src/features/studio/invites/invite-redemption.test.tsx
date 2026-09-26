import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteRedemption } from "./invite-redemption";
import { ApiClientError } from "@/lib/api/client";

const mocks = vi.hoisted(() => ({ redeemInvite: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  api: { workspaces: { redeemInvite: mocks.redeemInvite } },
  ApiClientError: class ApiClientError extends Error {
    code: string;
    constructor(input: { code: string; message: string }) { super(input.message); this.code = input.code; }
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));

const token = "a".repeat(43);
const workspaceId = "8165e055-9c99-4d16-9c49-223f844213ec";

describe("InviteRedemption", () => {
  afterEach(() => cleanup());
  beforeEach(() => { vi.clearAllMocks(); });

  it("accepts the verified account and opens its new workspace", async () => {
    mocks.redeemInvite.mockResolvedValue({ workspaceId });
    render(<InviteRedemption token={token} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(mocks.redeemInvite).toHaveBeenCalledWith(expect.objectContaining({ token })));
    expect(mocks.replace).toHaveBeenCalledWith(`/studio?workspace=${workspaceId}`);
  });

  it("sends a signed-out visitor to sign-in with the same invite path", async () => {
    mocks.redeemInvite.mockRejectedValue(new ApiClientError({ code: "UNAUTHENTICATED", message: "Sign in required.", retryable: false }));
    render(<InviteRedemption token={token} />);
    expect(screen.getByRole("link", { name: "Create account" }).getAttribute("href")).toContain(encodeURIComponent(`/invite/${token}`));
    fireEvent.click(screen.getByRole("button", { name: "Accept invitation" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent(`/invite/${token}`)}`));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
