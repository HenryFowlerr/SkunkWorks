import { createHash } from "node:crypto";
import { z } from "zod";
import type { Asset, Bend, EvidenceRef } from "@/contracts";
import { DomainError } from "./errors";

const AuthoredBendSchema = z.object({
  bendId: z.string().min(1),
  hingeId: z.string().min(1),
  foldRotationDeg: z.number().finite(),
});
const AuthoredManifestSchema = z.object({
  manifestVersion: z.literal("skunkworks-bend-manifest/1.0"),
  bendMappings: z.array(AuthoredBendSchema).min(1).max(200),
});

/** A manifest pointer proves where a proposal came from, never that it is approved or physically feasible. */
export async function assertAuthoredManifestEvidence(input: {
  bends: Bend[];
  sourceAssetIds: string[];
  assets: Asset[];
  readSource: (asset: Asset) => Promise<Uint8Array>;
  panelModelOrigin?: "authored_manifest" | "reviewer_mapped" | "ai_proposed" | null;
  publication?: boolean;
}): Promise<void> {
  for (const bend of input.bends) {
    if (input.publication && (bend.foldRotationDeg.value === null || bend.foldRotationDeg.evidenceState !== "supported" || bend.foldRotationDeg.evidence.length === 0)) {
      throw new DomainError("MAPPING_REQUIRED", `Bend ${bend.bendId} has no supported signed rotation reference.`);
    }
    if (input.panelModelOrigin === "authored_manifest" && !bend.foldRotationDeg.evidence.some((ref) => ref.kind === "authored_manifest")) {
      throw new DomainError("MAPPING_REQUIRED", `Bend ${bend.bendId} must cite its selected authored manifest mapping.`);
    }
  }
  const references = input.bends.flatMap((bend) => bend.foldRotationDeg.evidence.filter(
    (ref): ref is Extract<EvidenceRef, { kind: "authored_manifest" }> => ref.kind === "authored_manifest",
  ));
  if (references.length === 0) return;
  const selected = new Set(input.sourceAssetIds);
  const manifests = new Map<string, Map<string, { hingeId: string; foldRotationDeg: number }>>();

  for (const ref of references) {
    if (manifests.has(ref.assetId)) continue;
    const asset = input.assets.find((candidate) => candidate.id === ref.assetId);
    if (!asset || !selected.has(asset.id) || asset.kind !== "bend_manifest" || asset.status !== "ready" || !asset.sha256 || asset.byteSize > 2 * 1024 * 1024) {
      throw new DomainError("MAPPING_REQUIRED", "The cited authored manifest is not a ready source on this job.");
    }
    const bytes = await input.readSource(asset);
    if (bytes.byteLength !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new DomainError("VERSION_CONFLICT", "The cited manifest no longer matches its verified upload.");
    }
    let decoded: unknown;
    try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new DomainError("MAPPING_REQUIRED", "The cited manifest cannot be read."); }
    const parsed = AuthoredManifestSchema.safeParse(decoded);
    if (!parsed.success) throw new DomainError("MAPPING_REQUIRED", "The cited manifest has no supported bend mappings.");
    const byBend = new Map<string, { hingeId: string; foldRotationDeg: number }>();
    for (const bend of parsed.data.bendMappings) {
      if (byBend.has(bend.bendId)) throw new DomainError("MAPPING_REQUIRED", "The cited manifest repeats a bend ID.");
      byBend.set(bend.bendId, bend);
    }
    manifests.set(ref.assetId, byBend);
  }

  for (const bend of input.bends) {
    for (const ref of bend.foldRotationDeg.evidence) {
      if (ref.kind !== "authored_manifest") continue;
      const authored = manifests.get(ref.assetId)?.get(ref.bendId);
      if (ref.bendId !== bend.bendId || !authored || authored.hingeId !== bend.hingeId || authored.foldRotationDeg !== bend.foldRotationDeg.value) {
        throw new DomainError("MAPPING_REQUIRED", `Bend ${bend.bendId} no longer matches its cited manifest mapping. Correct the source or attach a different supported reference.`);
      }
    }
  }
}
