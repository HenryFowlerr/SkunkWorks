import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Asset, DraftContent, Generation } from "../../../src/contracts/domain";
import { AiProviderError } from "../../../src/server/ai/types";
import type { AiAdapter } from "../../../src/server/ai/openai";
import { createGeneration, loadTrustedPdfEvidence, type GenerationDependencies } from "../../../src/server/api/generation";
import type { AuthorizedPrivateAsset } from "../../../src/server/data/repository";
import { ids, draft as fixtureDraft, draftContent, job as fixtureJob, panelModel, sourceAsset, workshopSnapshot } from "../../contracts/fixtures";

const inputFingerprint = "c".repeat(64);
const claimToken = ids.review;
const manifestAssetId = "00000000-0000-4000-8000-000000000018";

function makePdf(): Uint8Array {
  const stream = "BT /F1 12 Tf 20 200 Td (Bend B1: 90 degrees, R3.) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source, "ascii"));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source, "ascii");
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(source, "ascii"));
}

function makeManifest(): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify({
    manifestVersion: "1.0",
    panelModel: {
      schemaVersion: panelModel.schemaVersion,
      units: panelModel.units,
      thicknessMm: panelModel.thicknessMm,
      rootPanelId: panelModel.rootPanelId,
      panels: panelModel.panels,
      hinges: panelModel.hinges,
      origin: panelModel.origin,
      referenceFaceLabel: panelModel.referenceFaceLabel,
    },
    bends: [{ bendId: "B1", hingeId: "H1" }],
  }), "utf8"));
}

function makeGeneration(state: Generation["state"] = "running"): Generation {
  return {
    id: ids.generation,
    jobId: ids.job,
    inputFingerprint,
    state,
    startedAt: "2026-09-26T00:00:00.000Z",
    expiresAt: "2026-09-26T00:02:00.000Z",
    draftVersion: state === "succeeded" ? 2 : null,
    errorCode: state === "failed" ? "PROVIDER_TIMEOUT" : null,
  };
}

function makeHarness(options: {
  startState?: "started" | "running" | "completed" | "failed";
  completion?: { applied: true; draft: unknown } | { applied: false; reason: string };
  aiError?: AiProviderError;
  manifestBytes?: Uint8Array | null;
  includeCurrentDraft?: boolean;
} = {}) {
  const bytes = makePdf();
  const manifestBytes = options.manifestBytes === undefined ? makeManifest() : options.manifestBytes;
  const asset: Asset = {
    ...sourceAsset,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const manifestAsset: Asset | null = manifestBytes ? {
    ...sourceAsset,
    id: manifestAssetId,
    kind: "bend_manifest",
    filename: "bend-manifest.json",
    mimeType: "application/json",
    byteSize: manifestBytes.byteLength,
    sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  } : null;
  const assets = [asset, ...(manifestAsset ? [manifestAsset] : [])];
  const job = { ...fixtureJob, sourceAssetIds: assets.map(({ id }) => id) };
  const draft = {
    ...fixtureDraft,
    generationId: null,
    inputFingerprint,
    content: { ...draftContent, sourceAssetIds: job.sourceAssetIds },
  };
  const currentDraft = options.includeCurrentDraft ? draft : null;
  const authorized: AuthorizedPrivateAsset = {
    bucketId: "skunkworks-private",
    objectKey: `workspaces/${ids.workspace}/jobs/${ids.job}/assets/${ids.asset}/blob`,
    asset,
  };
  const authorizedAssets: AuthorizedPrivateAsset[] = [authorized, ...(manifestAsset ? [{
    bucketId: "skunkworks-private" as const,
    objectKey: `workspaces/${ids.workspace}/jobs/${ids.job}/assets/${manifestAsset.id}/blob`,
    asset: manifestAsset,
  }] : [])];
  const generation = makeGeneration();
  const completedGeneration = makeGeneration("succeeded");
  let completedContent: DraftContent | undefined;
  let completedModelIdentifier: string | undefined;
  let observedInput: Parameters<AiAdapter["generateDraft"]>[0] | undefined;
  const generatedDraft = {
    ...draft,
    version: 2,
    generationId: ids.generation,
    content: undefined,
  };

  const repository = {
    startGeneration: vi.fn(async () => {
      const state = options.startState ?? "started";
      if (state === "running") return { state, retryAfterSeconds: 2 } as const;
      if (state === "completed") return { state, generation: completedGeneration, draft } as const;
      if (state === "failed") return { state, generation: makeGeneration("failed"), errorCode: "PROVIDER_TIMEOUT" } as const;
      return {
        state,
        generation,
        claimToken,
        baseDraftVersion: currentDraft?.version ?? null,
        jobVersion: job.version,
      } as const;
    }),
    getJobBundle: vi.fn(async () => ({ job, assets, draft: currentDraft, releases: [] })),
    getWorkshopSnapshot: vi.fn(async () => workshopSnapshot),
    listGenerationSourceAssets: vi.fn(async () => authorizedAssets),
    completeGeneration: vi.fn(async ({ content, modelIdentifier }: { content: unknown; modelIdentifier: string }) => {
      completedContent = content as DraftContent;
      completedModelIdentifier = modelIdentifier;
      if (options.completion) return options.completion;
      return {
        applied: true,
        draft: { ...generatedDraft, content: completedContent },
      } as const;
    }),
    getGeneration: vi.fn(async () => completedGeneration),
    getGenerationResult: vi.fn(),
    failGeneration: vi.fn(async () => makeGeneration("failed")),
  } as unknown as GenerationDependencies["repository"];

  const generateDraft = vi.fn(async (input: Parameters<AiAdapter["generateDraft"]>[0]) => {
    observedInput = input;
    if (options.aiError) throw options.aiError;
    return {
      model: "environment-selected-test-model",
      bends: input.mappedBends.map((mapped) => ({
        ...mapped,
        finishedAngle: { value: null, evidence: [], evidenceState: "not_found" as const, originalText: null },
        insideRadiusMm: { value: null, evidence: [], evidenceState: "not_found" as const, originalText: null },
        directionText: { value: null, evidence: [], evidenceState: "not_found" as const, originalText: null },
      })),
      steps: input.stepTargets.map(({ id, bendId }) => ({
        id,
        bendId,
        instruction: "Follow the mapped bend after human review.",
        evidence: [],
        camera: null,
      })),
      findings: [],
      machineProposal: null,
    };
  });
  const ai: AiAdapter = {
    generateDraft,
    answerQuestion: vi.fn(),
  };
  const loadAuthorizedAsset = vi.fn(async (authorizedAsset: AuthorizedPrivateAsset) =>
    authorizedAsset.asset.id === manifestAssetId && manifestBytes ? manifestBytes : bytes,
  );
  const dependencies: GenerationDependencies = {
    repository,
    storage: { loadAuthorizedAsset },
    ai,
    fingerprint: () => inputFingerprint,
    createId: () => ids.proposal,
  };
  return {
    bytes,
    manifestBytes,
    asset,
    manifestAsset,
    authorized,
    authorizedAssets,
    repository,
    dependencies,
    ai,
    loadAuthorizedAsset,
    generateDraft,
    get completedContent() { return completedContent; },
    get completedModelIdentifier() { return completedModelIdentifier; },
    get observedInput() { return observedInput; },
  };
}

describe("request-bound generation service", () => {
  it("uses an explicit versioned manifest and verified PDF pages, then persists an unreviewed draft", async () => {
    const harness = makeHarness();
    const generation = await createGeneration({
      jobId: ids.job,
      expectedJobVersion: fixtureJob.version,
      idempotencyKey: "generate-key-0001",
    }, harness.dependencies);

    expect(generation).toMatchObject({ state: "succeeded", draftVersion: 2, inputFingerprint });
    expect(harness.observedInput?.pdfs[0]).toMatchObject({
      assetId: ids.asset,
      pageCount: 1,
      pages: [{ page: 1, text: "Bend B1: 90 degrees, R3." }],
    });
    expect(harness.observedInput?.workshopSnapshot.id).toBe(workshopSnapshot.id);
    expect(harness.observedInput?.machineId).toBe(ids.machine);
    expect(harness.observedInput?.sources.some((source) => source.kind === "workshop_note" && source.noteId === ids.machineNote)).toBe(true);
    expect(harness.observedInput?.mappedBends[0]).toMatchObject({
      bendId: "B1",
      hingeId: "H1",
      foldRotationDeg: { value: null, evidenceState: "not_found", evidence: [] },
    });
    expect(harness.observedInput?.stepTargets).toEqual([{ id: ids.proposal, bendId: "B1" }]);
    expect(harness.completedContent?.panelModel?.reviewed).toBe(false);
    expect(harness.completedContent?.panelModel?.origin).toBe("authored_manifest");
    expect(harness.completedContent?.bends[0].foldRotationDeg).toMatchObject({ value: null, evidenceState: "not_found" });
    expect(harness.completedContent?.steps[0].id).toBe(ids.proposal);
    expect(harness.completedModelIdentifier).toBe("environment-selected-test-model");
    expect(harness.repository.completeGeneration).toHaveBeenCalledWith(expect.objectContaining({
      generationId: ids.generation,
      claimToken,
    }));
    expect(harness.repository.failGeneration).not.toHaveBeenCalled();
  });

  it("runs first generation without a draft or manifest and saves an incomplete draft with a blocking mapping finding", async () => {
    const harness = makeHarness({ manifestBytes: null });
    const generation = await createGeneration({
      jobId: ids.job,
      expectedJobVersion: fixtureJob.version,
      idempotencyKey: "generate-initial-no-map",
    }, harness.dependencies);

    expect(generation.state).toBe("succeeded");
    expect(harness.repository.getJobBundle).toHaveBeenCalledOnce();
    expect(harness.observedInput?.pdfs).toHaveLength(1);
    expect(harness.observedInput?.mappedBends).toEqual([]);
    expect(harness.observedInput?.stepTargets).toEqual([]);
    expect(harness.completedContent?.panelModel).toBeNull();
    expect(harness.completedContent?.bends).toEqual([]);
    expect(harness.completedContent?.findings).toContainEqual(expect.objectContaining({
      kind: "mapping",
      severity: "blocking",
      bendId: null,
      disposition: "open",
      message: expect.stringContaining("No bend manifest"),
    }));
  });

  it("can use a current server-saved mapping when no manifest is selected, without carrying forward rotation evidence", async () => {
    const harness = makeHarness({ manifestBytes: null, includeCurrentDraft: true });
    await createGeneration({
      jobId: ids.job,
      expectedJobVersion: fixtureJob.version,
      idempotencyKey: "generate-saved-map",
    }, harness.dependencies);

    expect(harness.observedInput?.mappedBends).toHaveLength(1);
    expect(harness.observedInput?.mappedBends[0]).toMatchObject({
      bendId: "B1",
      hingeId: "H1",
      foldRotationDeg: { value: null, evidenceState: "not_found", evidence: [] },
    });
    expect(harness.completedContent?.panelModel?.origin).toBe("ai_proposed");
    expect(harness.completedContent?.panelModel?.reviewed).toBe(false);
  });

  it("marks duplicate bend IDs or out-of-model hinge pointers as an incomplete mapping instead of guessing", async () => {
    const invalidManifest = new Uint8Array(Buffer.from(JSON.stringify({
      manifestVersion: "1.0",
      panelModel: {
        schemaVersion: panelModel.schemaVersion,
        units: panelModel.units,
        thicknessMm: panelModel.thicknessMm,
        rootPanelId: panelModel.rootPanelId,
        panels: panelModel.panels,
        hinges: panelModel.hinges,
        origin: panelModel.origin,
        referenceFaceLabel: panelModel.referenceFaceLabel,
      },
      bends: [{ bendId: "B1", hingeId: "H-UNKNOWN" }],
    }), "utf8"));
    const harness = makeHarness({ manifestBytes: invalidManifest });
    await createGeneration({
      jobId: ids.job,
      expectedJobVersion: fixtureJob.version,
      idempotencyKey: "generate-invalid-map",
    }, harness.dependencies);

    expect(harness.observedInput?.mappedBends).toEqual([]);
    expect(harness.completedContent?.panelModel).toBeNull();
    expect(harness.completedContent?.findings).toContainEqual(expect.objectContaining({
      kind: "mapping",
      severity: "blocking",
      message: expect.stringContaining("hinge mapping outside its panel model"),
    }));
  });

  it("rejects a client-forged reviewed field in a manifest and never persists it as approved", async () => {
    const manifestWithReviewed = new Uint8Array(Buffer.from(JSON.stringify({
      manifestVersion: "1.0",
      panelModel: panelModel,
      bends: [{ bendId: "B1", hingeId: "H1" }],
    }), "utf8"));
    const harness = makeHarness({ manifestBytes: manifestWithReviewed });
    await createGeneration({
      jobId: ids.job,
      expectedJobVersion: fixtureJob.version,
      idempotencyKey: "generate-forged-reviewed",
    }, harness.dependencies);

    expect(harness.observedInput?.mappedBends).toEqual([]);
    expect(harness.completedContent?.panelModel).toBeNull();
    expect(harness.completedContent?.findings).toContainEqual(expect.objectContaining({
      kind: "mapping",
      severity: "blocking",
      message: expect.stringContaining("does not match version 1.0"),
    }));
  });

  it("returns durable idempotent running/completed/failed states without re-running the provider", async () => {
    const running = makeHarness({ startState: "running" });
    await expect(createGeneration({ jobId: ids.job, expectedJobVersion: 1, idempotencyKey: "generate-key-0002" }, running.dependencies))
      .rejects.toMatchObject({ code: "GENERATION_RUNNING" });
    expect(running.generateDraft).not.toHaveBeenCalled();

    const completed = makeHarness({ startState: "completed" });
    await expect(createGeneration({ jobId: ids.job, expectedJobVersion: 1, idempotencyKey: "generate-key-0003" }, completed.dependencies))
      .resolves.toMatchObject({ state: "succeeded" });
    expect(completed.repository.getJobBundle).not.toHaveBeenCalled();
    expect(completed.generateDraft).not.toHaveBeenCalled();

    const failed = makeHarness({ startState: "failed" });
    await expect(createGeneration({ jobId: ids.job, expectedJobVersion: 1, idempotencyKey: "generate-key-0004" }, failed.dependencies))
      .rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(failed.generateDraft).not.toHaveBeenCalled();
  });

  it("persists provider timeout failures with the claim token and safe diagnostic code", async () => {
    const harness = makeHarness({ aiError: new AiProviderError("PROVIDER_TIMEOUT", { retryable: true }) });
    await expect(createGeneration({ jobId: ids.job, expectedJobVersion: 1, idempotencyKey: "generate-key-0005" }, harness.dependencies))
      .rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(harness.repository.failGeneration).toHaveBeenCalledWith({
      generationId: ids.generation,
      claimToken,
      errorCode: "PROVIDER_TIMEOUT",
    });
    expect(harness.repository.completeGeneration).not.toHaveBeenCalled();
  });

  it("rejects a stale completion without trying to change an already terminal generation", async () => {
    const harness = makeHarness({ completion: { applied: false, reason: "inputs_changed" } });
    await expect(createGeneration({ jobId: ids.job, expectedJobVersion: 1, idempotencyKey: "generate-key-0006" }, harness.dependencies))
      .rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(harness.repository.completeGeneration).toHaveBeenCalledOnce();
    expect(harness.repository.failGeneration).not.toHaveBeenCalled();
  });

  it("loads trusted PDF text only from authorized ready private sources", async () => {
    const harness = makeHarness();
    const loaded = await loadTrustedPdfEvidence([harness.authorized], harness.dependencies.storage);
    expect(loaded[0]).toMatchObject({ assetId: ids.asset, pages: [{ page: 1, text: "Bend B1: 90 degrees, R3." }] });
    expect(harness.loadAuthorizedAsset).toHaveBeenCalledOnce();

    const wrongDigest = { ...harness.authorized, asset: { ...harness.asset, sha256: "d".repeat(64) } };
    const storage = { loadAuthorizedAsset: vi.fn(async () => harness.bytes) };
    await expect(loadTrustedPdfEvidence([wrongDigest], storage)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
