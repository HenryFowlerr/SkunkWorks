import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceDataRepository } from "@/server/data/repository";
import { ids, memberActor, openFlag, releaseContext } from "../../contracts/fixtures";

const createInput = { flagId: ids.flag, context: releaseContext, question: openFlag.question,
  displayName: memberActor.displayName, idempotencyRecordId: ids.review, idempotencyClaimToken: ids.proposal };
const responseInput = { flagId: ids.flag, expectedVersion: 1, text: "See drawing detail A.", kind: "explanation" as const, replacementReleaseId: null };
function adapter(role: "fabricator" | "designer" | "admin" = "fabricator") {
  const rpc = vi.fn().mockResolvedValue({ data: openFlag, error: null });
  const repository = new WorkspaceDataRepository({ rpc } as unknown as SupabaseClient, {
    actorId: ids.member, workspaceId: ids.workspace, role,
  });
  return { repository, rpc };
}

describe("feedback persistence boundaries", () => {
  it("binds report RPC to verified actor and workspace, with the exact claim token", async () => {
    const { repository, rpc } = adapter();
    await repository.createFlag(createInput);
    expect(rpc).toHaveBeenCalledWith("create_member_flag_internal", {
      p_workspace_id: ids.workspace, p_actor_id: ids.member, p_flag_id: ids.flag,
      p_context: releaseContext, p_question: openFlag.question, p_display_name: memberActor.displayName,
      p_idempotency_record_id: ids.review, p_idempotency_claim_token: ids.proposal,
    });
  });

  it("rejects a fabricator response before invoking privileged SQL", async () => {
    const { repository, rpc } = adapter();
    await expect(repository.respondToFlag(responseInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["designer", "admin"] as const)("binds %s response to the version and authenticated author", async (role) => {
    const { repository, rpc } = adapter(role);
    await repository.respondToFlag(responseInput);
    expect(rpc).toHaveBeenCalledWith("respond_to_flag_internal", {
      p_workspace_id: ids.workspace, p_actor_id: ids.member, p_flag_id: ids.flag,
      p_expected_version: 1, p_text: responseInput.text, p_kind: "explanation", p_replacement_release_id: null,
    });
  });

  it("preserves version conflict errors and rejects malformed RPC results", async () => {
    const { repository, rpc } = adapter("designer");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "40001", message: "VERSION_CONFLICT" } });
    await expect(repository.respondToFlag(responseInput)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    rpc.mockResolvedValueOnce({ data: { status: "responded" }, error: null });
    await expect(repository.respondToFlag(responseInput)).rejects.toThrow();
  });
});
