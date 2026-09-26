/**
 * Optional, isolated PostgreSQL regression test (no network/database credentials).
 * Install @electric-sql/pglite@0.3.14 in a temporary directory, then run:
 * PGLITE_TEST_MODULE=/absolute/temp/node_modules/@electric-sql/pglite/dist/index.js node --test tests/backend/data/feedback-sql.mjs
 * Loads the repository's actual table DDL, idempotency functions and this migration.
 * Does not model Supabase HTTP/auth/storage or real multi-connection concurrency.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
const { PGlite } = await import(process.env.PGLITE_TEST_MODULE || "@electric-sql/pglite");
const db = new PGlite();
const id = Object.fromEntries(["workspace", "foreignWorkspace", "member", "engineer", "outsider", "job", "draft", "release", "replacement", "unrelated", "step"].map((key) => [key, randomUUID()]));
const context = { jobId: id.job, releaseId: id.release, draftId: null, draftVersion: null, stepId: id.step, bendId: "B1" };
const hash = "a".repeat(64);
const snapshot = { steps: [{ id: id.step, bendId: "B1" }], bends: [{ bendId: "B1" }] };
async function one(sql, params = []) { return (await db.query(sql, params)).rows[0]; }
async function claim(key = randomUUID(), actor = id.member, operation = "flag.create", payloadHash = hash) {
  return (await one("select public.claim_idempotency_internal('member', $1, $2, $3, $4, 90) as result", [actor, operation, key, payloadHash])).result;
}
async function create(c, overrides = {}) {
  const p = { workspace: id.workspace, actor: id.member, flag: randomUUID(), context, question: "Which detail applies?", name: "Floor member", ...overrides };
  return (await one("select public.create_member_flag_internal($1,$2,$3,$4,$5,$6,$7,$8) as result", [
    p.workspace, p.actor, p.flag, p.context, p.question, p.name, c.recordId, c.claimToken,
  ])).result;
}
async function respond(flagId, overrides = {}) {
  const p = { workspace: id.workspace, actor: id.engineer, version: 1, text: "Drawing detail A applies.", kind: "explanation", replacement: null, ...overrides };
  return (await one("select public.respond_to_flag_internal($1,$2,$3,$4,$5,$6,$7) as result", [p.workspace, p.actor, flagId, p.version, p.text, p.kind, p.replacement])).result;
}
function extractFunction(sql, name, delimiter = "$function$") {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0);
  const bodyStart = sql.indexOf(delimiter, start);
  const end = sql.indexOf(`${delimiter};`, bodyStart + delimiter.length) + delimiter.length + 1;
  return sql.slice(start, end);
}
before(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users (id uuid primary key);");
  const initial = await readFile(new URL("../../../supabase/migrations/20260926030131_initial_schema.sql", import.meta.url), "utf8");
  await db.exec(initial.slice(0, initial.indexOf("-- Read-only membership predicate.")).replace("create extension if not exists pgcrypto with schema extensions;", ""));
  await db.exec(extractFunction(initial, "public.claim_idempotency_internal"));
  await db.exec(extractFunction(initial, "private.complete_idempotency"));
  await db.exec(extractFunction(initial, "private.reject_immutable_row_change", "$trigger$"));
  await db.exec("create trigger flag_responses_immutable before update or delete on public.flag_responses for each row execute function private.reject_immutable_row_change();");
  await db.exec(await readFile(new URL("../../../supabase/migrations/20260926110000_member_feedback.sql", import.meta.url), "utf8"));
  for (const actor of [id.member, id.engineer, id.outsider]) await db.query("insert into auth.users values ($1)", [actor]);
  for (const workspace of [id.workspace, id.foreignWorkspace]) await db.query("insert into public.workspaces (id,name,created_by) values ($1,'Test',$2)", [workspace, id.engineer]);
  for (const [actor, role] of [[id.member, "fabricator"], [id.engineer, "designer"]]) await db.query("insert into public.workspace_members(workspace_id,user_id,role) values ($1,$2,$3)", [id.workspace, actor, role]);
  await db.query("insert into public.jobs(id,workspace_id,title,part_number,part_family,created_by) values ($1,$2,'Part','P-1','Test',$3)", [id.job, id.workspace, id.engineer]);
  await db.query("insert into public.drafts(id,workspace_id,job_id,content,input_fingerprint,created_by) values ($1,$2,$3,$4,$5,$6)", [id.draft, id.workspace, id.job, snapshot, hash, id.engineer]);
  for (const [release, version, predecessor] of [[id.release, 1, null], [id.replacement, 2, id.release], [id.unrelated, 3, null]]) {
    await db.query("insert into public.releases(id,workspace_id,job_id,revision_number,snapshot,source_draft_id,source_draft_version,reviews,published_by,supersedes_release_id) values ($1,$2,$3,$4,$5,$6,1,'[]',$7,$8)", [release, id.workspace, id.job, version, snapshot, id.draft, id.engineer, predecessor]);
  }
});
after(async () => { await db.close(); });

test("text report and idempotency completion commit together; replay is exact", async () => {
  const key = randomUUID(); const c = await claim(key); const flag = await create(c);
  assert.equal(flag.status, "open"); assert.equal(flag.response, null); assert.equal(flag.version, 1);
  assert.equal(flag.createdBy.id, id.member); assert.deepEqual(flag.createdBy.roles, ["fabricator"]);
  assert.deepEqual(flag.photoAssetIds, []); assert.deepEqual(flag.context, context);
  const replay = await claim(key); assert.equal(replay.state, "completed"); assert.deepEqual(replay.response, flag);
  await assert.rejects(create(c), /IDEMPOTENCY_CLAIM_LOST/);
  await assert.rejects(claim(key, id.member, "flag.create", "b".repeat(64)), /IDEMPOTENCY_KEY_REUSED/);
});
test("reports require membership and matching workspace/job/release", async () => {
  await assert.rejects(create(await claim(randomUUID(), id.outsider), { actor: id.outsider }), /FORBIDDEN/);
  await assert.rejects(create(await claim(), { workspace: id.foreignWorkspace }), /FORBIDDEN/);
  await assert.rejects(create(await claim(), { context: { ...context, jobId: randomUUID() } }), /NOT_FOUND/);
});
test("reports require an actual matching operation and release-only context", async () => {
  for (const value of [{ ...context, stepId: randomUUID() }, { ...context, bendId: "B2" }, { ...context, draftId: id.draft }, { ...context, releaseId: "invalid" }, { ...context, extra: true }]) {
    await assert.rejects(create(await claim(), { context: value }), /VALIDATION_FAILED/);
  }
  const general = await create(await claim(), { context: { ...context, stepId: null, bendId: null } });
  assert.equal(general.context.stepId, null);
});
test("wrong claim token, owner, operation and expired lease cannot write", async () => {
  const before = (await one("select count(*)::int as count from public.flags")).count;
  await assert.rejects(create({ ...await claim(), claimToken: null }), /IDEMPOTENCY_CLAIM_LOST/);
  await assert.rejects(create({ ...await claim(), claimToken: randomUUID() }), /IDEMPOTENCY_CLAIM_LOST/);
  await assert.rejects(create(await claim(randomUUID(), id.engineer)), /IDEMPOTENCY_CLAIM_LOST/);
  await assert.rejects(create(await claim(randomUUID(), id.member, "job.create")), /IDEMPOTENCY_CLAIM_LOST/);
  const expired = await claim();
  await db.query("update public.idempotency_records set lease_expires_at = now() - interval '1 second' where id = $1", [expired.recordId]);
  await assert.rejects(create(expired), /IDEMPOTENCY_CLAIM_LOST/);
  assert.equal((await one("select count(*)::int as count from public.flags")).count, before);
});
test("only engineer approval creates the clarification and increments version", async () => {
  const flag = await create(await claim());
  await assert.rejects(respond(flag.id, { actor: id.member }), /FORBIDDEN/);
  await assert.rejects(respond(flag.id, { workspace: id.foreignWorkspace }), /FORBIDDEN/);
  const answered = await respond(flag.id);
  assert.equal(answered.status, "responded"); assert.equal(answered.version, 2);
  assert.equal(answered.response.authorId, id.engineer); assert.equal(answered.response.kind, "explanation");
  await assert.rejects(respond(flag.id), /VERSION_CONFLICT/);
  assert.equal((await one("select count(*)::int as count from public.flag_responses where flag_id=$1", [flag.id])).count, 1);
  await assert.rejects(db.query("update public.flag_responses set text = 'Changed' where flag_id=$1", [flag.id]), /append-only/);
});
test("replacement responses must point at a direct successor in the same job", async () => {
  const flag = await create(await claim());
  await assert.rejects(respond(flag.id, { kind: "replacement_release", replacement: id.unrelated }), /VALIDATION_FAILED/);
  await assert.rejects(respond(flag.id, { replacement: id.replacement }), /VALIDATION_FAILED/);
  const response = await respond(flag.id, { kind: "replacement_release", replacement: id.replacement });
  assert.equal(response.response.replacementReleaseId, id.replacement);
});
test("resolved reports and invalid text/version cannot receive another response", async () => {
  const flag = await create(await claim());
  for (const override of [{ version: null }, { version: 0 }, { text: "  " }, { kind: null }]) await assert.rejects(respond(flag.id, override), /VALIDATION_FAILED/);
  await respond(flag.id);
  await db.query("update public.flags set status = 'resolved', version=3 where id=$1", [flag.id]);
  await assert.rejects(respond(flag.id, { version: 3 }), /VERSION_CONFLICT/);
});
test("membership revocation prevents both report creation and response", async () => {
  const c = await claim();
  await db.query("update public.workspace_members set status = 'revoked' where user_id=$1", [id.member]);
  await assert.rejects(create(c), /FORBIDDEN/);
  await db.query("update public.workspace_members set status = 'active' where user_id=$1", [id.member]);
  const flag = await create(c);
  await db.query("update public.workspace_members set status = 'revoked' where user_id=$1", [id.engineer]);
  await assert.rejects(respond(flag.id), /FORBIDDEN/);
  await db.query("update public.workspace_members set status = 'active' where user_id=$1", [id.engineer]);
});
test("both mutation functions and the serializer are executable only by service role", async () => {
  for (const signature of ["public.create_member_flag_internal(uuid,uuid,uuid,jsonb,text,text,uuid,uuid)", "public.respond_to_flag_internal(uuid,uuid,uuid,integer,text,text,uuid)", "private.member_flag_json(uuid,uuid)"]) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const value = await one("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature]);
      assert.equal(value.allowed, role === "service_role", `${role}: ${signature}`);
    }
  }
});
