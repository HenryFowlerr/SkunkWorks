import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/client";
import { StudioSessionProvider } from "./studio-session";

const { apiMock, navigation, location } = vi.hoisted(() => ({
  apiMock: {
    auth: { me: vi.fn(), signOut: vi.fn() },
    workspaces: { create: vi.fn() },
  },
  navigation: { push: vi.fn(), replace: vi.fn() },
  location: { pathname: "/studio/jobs", search: "?workspace=workspace-1" },
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, api: apiMock };
});

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.search),
}));

const membership = {
  id: "membership-1",
  workspaceId: "workspace-1",
  userId: "actor-1",
  role: "designer" as const,
  createdAt: "2026-09-26T00:00:00.000Z",
};

const session = {
  actor: { id: "actor-1", displayName: "Rae Designer", kind: "member" as const, roles: ["designer" as const] },
  memberships: [membership],
};

describe("StudioSessionProvider", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    apiMock.auth.me.mockReset();
    apiMock.auth.signOut.mockReset();
    apiMock.workspaces.create.mockReset();
    navigation.push.mockReset();
    navigation.replace.mockReset();
    location.pathname = "/studio/jobs";
    location.search = "?workspace=workspace-1";
  });

  it("opens the selected member workspace after the server confirms the session", async () => {
    apiMock.auth.me.mockResolvedValue(session);
    render(<StudioSessionProvider><p>Designer desk content</p></StudioSessionProvider>);

    expect(await screen.findByText("Designer desk content")).toBeTruthy();
    expect((screen.getByLabelText("Select workspace") as HTMLSelectElement).value).toBe("workspace-1");
    expect(screen.getByText("Rae Designer")).toBeTruthy();
  });

  it("redirects only when the API reports an unauthenticated session", async () => {
    apiMock.auth.me.mockRejectedValue(new ApiClientError({
      code: "UNAUTHENTICATED",
      message: "Sign in required.",
      retryable: false,
    }));
    render(<StudioSessionProvider><p>Protected content</p></StudioSessionProvider>);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?returnTo=%2Fstudio%2Fjobs%3Fworkspace%3Dworkspace-1"));
    expect(screen.queryByText("Protected content")).toBeNull();
  });

  it("shows an unavailable-service message without redirecting or inventing a workspace", async () => {
    apiMock.auth.me.mockRejectedValue(new ApiClientError({
      code: "ENDPOINT_UNAVAILABLE",
      message: "The SkunkWorks API endpoint is unavailable.",
      retryable: true,
    }));
    render(<StudioSessionProvider><p>Protected content</p></StudioSessionProvider>);

    expect(await screen.findByText("The SkunkWorks API endpoint is unavailable.")).toBeTruthy();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(apiMock.workspaces.create).not.toHaveBeenCalled();
  });

  it("offers explicit workspace creation when a verified user has no membership", async () => {
    apiMock.auth.me.mockResolvedValue({ ...session, memberships: [] });
    apiMock.workspaces.create.mockResolvedValue({
      workspace: { id: "workspace-2", name: "Prototype Lab", createdAt: "2026-09-26T00:00:00.000Z" },
      membership: { ...membership, id: "membership-2", workspaceId: "workspace-2", role: "admin" },
    });
    render(<StudioSessionProvider><p>Designer desk content</p></StudioSessionProvider>);

    fireEvent.change(await screen.findByLabelText("Workspace name"), { target: { value: "Prototype Lab" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    expect(await screen.findByText("Designer desk content")).toBeTruthy();
    expect(apiMock.workspaces.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Prototype Lab" }));
  });
});
