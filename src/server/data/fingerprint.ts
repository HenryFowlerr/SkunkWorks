import "server-only";

import { createHash } from "node:crypto";
import type { Asset, Job, WorkshopSnapshot } from "@/contracts";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Fingerprints server-read source bytes and the selected immutable profile
 * identity. Snapshot ID/version plus machine ID fully identify machine data
 * because workshop versions are immutable. The SQL serializer uses the same
 * integer/string/null-only payload so publication can recompute it from rows.
 */
export function computeInputFingerprint(input: {
  job: Pick<Job, "partFamily" | "workshopSnapshotId" | "machineId" | "sourceAssetIds">;
  assets: Asset[];
  workshopSnapshot: WorkshopSnapshot;
}): string {
  if (!input.job.workshopSnapshotId || !input.job.machineId) {
    throw new Error("A workshop snapshot and machine are required to fingerprint job inputs.");
  }

  const machine = input.workshopSnapshot.machines.find(({ id }) => id === input.job.machineId);
  if (!machine || input.workshopSnapshot.id !== input.job.workshopSnapshotId) {
    throw new Error("The selected machine is not part of the selected workshop snapshot.");
  }

  const ids = [...input.job.sourceAssetIds].sort();
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const sourceAssets = ids.map((id) => {
    const asset = assetsById.get(id);
    if (!asset) throw new Error(`Selected source asset ${id} is missing.`);
    return {
      id: asset.id,
      version: asset.version,
      sha256: asset.sha256,
      status: asset.status,
    };
  });

  const canonicalInputs = canonicalJson({
    contractVersion: "1.0",
    partFamily: input.job.partFamily,
    workshopSnapshot: {
      id: input.workshopSnapshot.id,
      version: input.workshopSnapshot.version,
      machineId: input.job.machineId,
    },
    sourceAssets,
  });

  return createHash("sha256").update(canonicalInputs, "utf8").digest("hex");
}
