import { describe, expect, it } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { loadAuthSessionView } from "../../../src/server/auth/session-view";

const activeWorkspaceId = "00000000-0000-4000-8000-000000000010";
const userId = "00000000-0000-4000-8000-000000000001";

describe("auth session view", () => {
  it("omits revoked workspace memberships and roles", async () => {
    const rows = [
      {
        id: "00000000-0000-4000-8000-000000000011",
        workspace_id: activeWorkspaceId,
        user_id: userId,
        role: "designer",
        created_at: "2026-09-26T00:00:00.000Z",
        status: "active",
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        workspace_id: "00000000-0000-4000-8000-000000000020",
        user_id: userId,
        role: "admin",
        created_at: "2026-09-26T00:00:00.000Z",
        status: "revoked",
      },
    ];
    const filters: Array<[string, unknown]> = [];
    const query = {
      select() {
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return query;
      },
      async order() {
        const filtered = rows.filter((row) =>
          filters.every(([column, value]) => row[column as keyof typeof row] === value),
        );
        return {
          data: filtered.map((row) => ({
            id: row.id,
            workspace_id: row.workspace_id,
            user_id: row.user_id,
            role: row.role,
            created_at: row.created_at,
          })),
          error: null,
        };
      },
    };
    const supabase = { from: () => query } as unknown as SupabaseClient;
    const user = {
      id: userId,
      email: "member@example.test",
      user_metadata: { display_name: "Member One" },
    } as unknown as User;

    const view = await loadAuthSessionView(supabase, user);

    expect(filters).toContainEqual(["status", "active"]);
    expect(view.memberships).toHaveLength(1);
    expect(view.actor.roles).toEqual(["designer"]);
  });
});
