import { beforeEach, describe, expect, it, vi } from "vitest";
import { ids } from "../../contracts/fixtures";
const mocks = vi.hoisted(() => ({ getVerifiedRequestIdentity: vi.fn(), getWorkspaceApiContext: vi.fn() }));
vi.mock("@/lib/auth/request-identity", () => ({ getVerifiedRequestIdentity: mocks.getVerifiedRequestIdentity }));
vi.mock("@/server/api/context", () => ({ getWorkspaceApiContext: mocks.getWorkspaceApiContext }));
import { getFlagResponseApiContext } from "@/server/api/feedback-context";

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVerifiedRequestIdentity.mockResolvedValue({ supabase: { from } });
  maybeSingle.mockResolvedValue({ data: { workspace_id: ids.workspace }, error: null });
  mocks.getWorkspaceApiContext.mockResolvedValue({ repository: {} });
});
describe("engineer response scope", () => {
  it("uses the session-visible flag workspace and explicitly requires designer access", async () => {
    await getFlagResponseApiContext(ids.flag);
    expect(from).toHaveBeenCalledWith("flags");
    expect(eq).toHaveBeenCalledWith("id", ids.flag);
    expect(mocks.getWorkspaceApiContext).toHaveBeenCalledWith(ids.workspace, ["designer"]);
  });
  it("does not construct a privileged repository for a flag hidden by RLS", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(getFlagResponseApiContext(ids.flag)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.getWorkspaceApiContext).not.toHaveBeenCalled();
  });
  it("reports an access lookup failure without treating it as an empty flag", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "offline" } });
    await expect(getFlagResponseApiContext(ids.flag)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(mocks.getWorkspaceApiContext).not.toHaveBeenCalled();
  });
});
