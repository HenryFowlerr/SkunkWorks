import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceInvites } from "./workspace-invites";

const { invite } = vi.hoisted(() => ({ invite: vi.fn() }));

vi.mock("@/lib/api/client", () => ({ api: { workspaces: { invite } } }));

describe("WorkspaceInvites", () => {
  afterEach(() => cleanup());
  beforeEach(() => invite.mockReset());

  it("shows only the issued role-bound link returned by the service", async () => {
    invite.mockResolvedValue({
      id: "invite-1",
      workspaceId: "workspace-1",
      role: "fabricator",
      createdAt: "2026-09-26T00:00:00.000Z",
      expiresAt: "2026-09-27T00:00:00.000Z",
      inviteUrl: "https://app.example/invite/opaque-token",
    });
    render(<WorkspaceInvites workspaceId="workspace-1" role="admin" />);

    fireEvent.click(screen.getByRole("button", { name: "Create invitation link" }));

    expect(await screen.findByText("https://app.example/invite/opaque-token")).toBeTruthy();
    expect(invite).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "workspace-1", role: "fabricator" }));
  });

  it("does not offer invitation creation to non-admin roles", () => {
    render(<WorkspaceInvites workspaceId="workspace-1" role="designer" />);
    expect(screen.getByText(/cannot issue invitations/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create invitation link" })).toBeNull();
    expect(invite).not.toHaveBeenCalled();
  });

  it("reports an API failure without displaying an issued link", async () => {
    invite.mockRejectedValueOnce(new Error("Workspace invitations are unavailable."));
    render(<WorkspaceInvites workspaceId="workspace-1" role="admin" />);
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Create invitation link" }).closest("form")!);
    });

    expect((await screen.findByRole("alert")).textContent).toContain("Workspace invitations are unavailable.");
    expect(screen.queryByRole("link", { name: /invite\// })).toBeNull();
  });
});
