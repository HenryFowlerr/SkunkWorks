import { describe, expect, it } from "vitest";
import { actorForMembership } from "../../../src/server/auth/authorization";
import { ApiFault } from "../../../src/server/http/api";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "member@example.test",
  user_metadata: { display_name: "Member One" },
};

const membership = {
  id: "00000000-0000-4000-8000-000000000002",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  userId: user.id,
  role: "designer",
  createdAt: "2026-09-26T00:00:00.000Z",
};

describe("workspace actor authorization", () => {
  it("scopes domain roles to the membership for the requested workspace", () => {
    expect(actorForMembership(user, membership, membership.workspaceId)).toMatchObject({
      id: user.id,
      kind: "member",
      roles: ["designer"],
    });
  });

  it("rejects a membership from another workspace or user", () => {
    expect(() => actorForMembership(user, membership, "00000000-0000-4000-8000-000000000011"))
      .toThrow(ApiFault);
    expect(() => actorForMembership(
      { ...user, id: "00000000-0000-4000-8000-000000000003" },
      membership,
      membership.workspaceId,
    )).toThrow(ApiFault);
  });

  it("rejects a role that cannot perform the requested operation", () => {
    expect(() => actorForMembership(user, membership, membership.workspaceId, ["admin", "fabricator"]))
      .toThrow(ApiFault);
  });
});
