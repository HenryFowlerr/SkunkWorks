import "server-only";

import { createHash } from "node:crypto";
import type { Asset, Job, Machine, WorkshopSnapshot } from "@/contracts";
import { ApiFault } from "@/server/http/api";
import { extractPdfEvidence, MAX_PDF_BYTES, PdfTextError } from "./pdf-text";
import {
  PitchSourceSchema,
  PitchSupplierSchema,
  type PitchCapabilityInput,
  type PitchSource,
} from "./pitch";

const MAX_SOURCE_TEXT = 24_000;
const MAX_DISPLAY_TEXT = 1_000;
const MAX_PACKET_SOURCE_COUNT = 120;
const MAX_PACKET_TEXT_CHARS = 180_000;
const MAX_SELECTED_TOOLS = 24;
const TRUNCATION_NOTICE = "\n[Source text is truncated for this draft prompt. Do not infer omitted content.]";

export type PitchSourceReader = (asset: Asset) => Promise<Uint8Array>;

export type PitchPacket = {
  job: Job;
  partSources: PitchSource[];
  supplierNoteSources: PitchSource[];
  workshop: WorkshopSnapshot;
  machineId: string;
};

/**
 * Reads the minimum prompt packet for the five-minute pitch. It deliberately
 * accepts a readable drawing PDF without a bend manifest or model asset.
 * Native CAD and any retained 3D view asset remain outside semantic evidence
 * until an explicit converter/export exists.
 */
export async function preparePitchPacket(input: {
  job: Job;
  assets: Asset[];
  workshop: WorkshopSnapshot;
  readSource: PitchSourceReader;
}): Promise<PitchPacket> {
  const { job, assets, workshop, readSource } = input;
  if (!job.workshopSnapshotId || job.workshopSnapshotId !== workshop.id || !job.machineId ||
      workshop.workspaceId !== job.workspaceId) {
    throw new ApiFault("REVIEW_REQUIRED", "Select a valid facility and machine before preparing the pitch analysis.");
  }
  if (!workshop.confirmedBy || !workshop.confirmedAt) {
    throw new ApiFault("REVIEW_REQUIRED", "The selected supplier profile must be confirmed before preparing the pitch analysis.");
  }
  const selected = selectedAssets(job, assets);
  const selectedMachine = workshop.machines.find((machine) => machine.id === job.machineId);

  if (!selectedMachine) {
    throw new ApiFault("REVIEW_REQUIRED", "The selected machine is not part of the confirmed supplier profile.");
  }

  const drawings = selected.filter((asset) => asset.kind === "drawing_pdf");
  if (!drawings.length) {
    if (selected.some((asset) => asset.kind === "native_part" || asset.kind === "native_drawing")) {
      throw new ApiFault(
        "UNSUPPORTED_ASSET",
        "Native SolidWorks files are retained but cannot be scanned as drawing evidence. Add a readable drawing PDF export.",
      );
    }
    throw new ApiFault("REVIEW_REQUIRED", "Select at least one verified drawing PDF before preparing the pitch analysis.");
  }
  if (drawings.reduce((total, asset) => total + asset.byteSize, 0) >= MAX_PDF_BYTES) {
    throw new ApiFault("UNSUPPORTED_ASSET", "Combined drawing PDFs exceed the 50 MB pitch-analysis limit.");
  }
  for (const drawing of drawings) {
    if (drawing.mimeType.toLowerCase() !== "application/pdf" || !drawing.filename.toLowerCase().endsWith(".pdf")) {
      throw new ApiFault("UNSUPPORTED_ASSET", "Pitch analysis accepts only verified drawing PDF exports as readable evidence.");
    }
  }

  const pdfs = await Promise.all(drawings.map(async (asset) => {
    const bytes = await readCheckedBytes(asset, readSource);
    try {
      return await extractPdfEvidence({ assetId: asset.id, filename: asset.filename, bytes });
    } catch (cause) {
      if (cause instanceof PdfTextError) throw new ApiFault("UNSUPPORTED_ASSET", cause.message);
      throw cause;
    }
  }));
  const partSources = pdfs.flatMap((pdf) => pdf.pages
    .filter((page) => page.text.trim())
    .map((page) => documentSource(pdf.assetId, pdf.filename, page.page, page.text)));
  if (partSources.length === 0) {
    throw new ApiFault("REVIEW_REQUIRED", "The drawing PDFs have no extractable text for cited pitch analysis.");
  }

  const supplierNoteSources = selectedMachine.notes
    .filter((note) => note.confirmedBy !== null)
    .map((note) => boundedSource({
      sourceKey: `workshop_note:${workshop.id}:${selectedMachine.id}:${note.id}`,
      label: `Confirmed workshop note ${note.id}`,
      text: note.text,
    }));

  return {
    job,
    partSources,
    supplierNoteSources,
    workshop,
    machineId: selectedMachine.id,
  };
}

/** Converts a prepared pitch packet into a strictly bounded model input. */
export function buildPitchCapabilityInput(packet: PitchPacket): PitchCapabilityInput {
  const selectedMachine = packet.workshop.machines.find((machine) => machine.id === packet.machineId);
  if (!selectedMachine) {
    throw new TypeError("The selected machine is not part of the supplied workshop snapshot.");
  }
  if (!packet.workshop.confirmedBy || !packet.workshop.confirmedAt) {
    throw new TypeError("The supplier profile must be confirmed before creating a pitch prompt.");
  }
  const supplierSources = [
    selectedMachineProfileSource(packet.workshop, selectedMachine),
    ...packet.supplierNoteSources,
  ];
  assertPacketBounds([...packet.partSources, ...supplierSources]);
  return {
    partName: clip(packet.job.title, 180),
    partNumber: packet.job.partNumber ? clip(packet.job.partNumber, 180) : null,
    sources: packet.partSources,
    supplier: PitchSupplierSchema.parse({
      supplierName: clip(packet.workshop.name, 200),
      profileVersion: String(packet.workshop.version),
      confirmed: true,
      machines: [{
        id: selectedMachine.id,
        name: clip(selectedMachine.name, 200),
        process: clip(selectedMachine.process, 200),
        capabilities: selectedMachineCapabilities(selectedMachine),
      }],
      sources: supplierSources,
    }),
  };
}

function selectedAssets(job: Job, assets: Asset[]): Asset[] {
  if (!job.sourceAssetIds.length || new Set(job.sourceAssetIds).size !== job.sourceAssetIds.length) {
    throw new ApiFault("REVIEW_REQUIRED", "Select one or more unique verified source files before preparing the pitch analysis.");
  }
  const selected = job.sourceAssetIds.map((id) => assets.find((asset) => asset.id === id));
  if (selected.some((asset) => !asset || asset.jobId !== job.id || asset.status !== "ready" || !asset.sha256)) {
    throw new ApiFault("REVIEW_REQUIRED", "Every selected source must finish verification before preparing the pitch analysis.");
  }
  return selected as Asset[];
}

function documentSource(assetId: string, filename: string, page: number, text: string): PitchSource {
  if (text.length > MAX_SOURCE_TEXT) {
    throw new ApiFault("UNSUPPORTED_ASSET", `Drawing PDF ${filename}, page ${page} exceeds the pitch text limit. Split or simplify the export before analysis.`);
  }
  return boundedSource({
    sourceKey: `document:${assetId}:${page}`,
    label: `${filename}, page ${page}`,
    text,
  });
}

function boundedSource(input: { sourceKey: string; label: string; text: string }): PitchSource {
  return PitchSourceSchema.parse({
    sourceKey: input.sourceKey,
    label: clip(input.label, 240),
    text: clipSourceText(input.text),
  });
}

function selectedMachineProfileSource(workshop: WorkshopSnapshot, machine: Machine): PitchSource {
  const sourceKey = `supplier_profile:${workshop.id}:${machine.id}`;
  const fields = [
    `Supplier profile: ${clip(workshop.name, 200)}.`,
    `Profile version: ${workshop.version}.`,
    "Supplier profile confirmation: confirmed.",
    `Selected machine: ${clip(machine.name, 200)}.`,
    `Recorded process: ${clip(machine.process, 200)}.`,
    machine.model ? `Recorded model: ${clip(machine.model, MAX_DISPLAY_TEXT)}.` : "Recorded model: not provided.",
    sourcedMachineValue(machineCapacityLabel(machine), machine.usableBendLengthMm),
    ...machine.tools.slice(0, MAX_SELECTED_TOOLS).map((tool) =>
      `Recorded tool: ${clip(tool.name, 500)}${tool.specification ? ` (${clip(tool.specification, 500)})` : ""}.`),
    ...(machine.tools.length > MAX_SELECTED_TOOLS ? ["Additional recorded tools are omitted from this prompt; do not infer their capabilities."] : []),
  ];

  return boundedSource({
    sourceKey,
    label: `Confirmed supplier profile: ${workshop.name} / ${machine.name}`,
    text: fields.join("\n"),
  });
}

function selectedMachineCapabilities(machine: Machine): string[] {
  const capabilities = [
    `Recorded process: ${clip(machine.process, 200)}`,
    sourcedMachineValue(machineCapacityLabel(machine), machine.usableBendLengthMm),
    ...machine.tools.slice(0, MAX_SELECTED_TOOLS).map((tool) =>
      `Recorded tool: ${clip(tool.name, 500)}${tool.specification ? ` (${clip(tool.specification, 500)})` : ""}`),
  ];
  if (machine.tools.length > MAX_SELECTED_TOOLS) capabilities.push("Additional recorded tools omitted from this prompt");
  return capabilities.map((capability) => clip(capability, MAX_DISPLAY_TEXT));
}

function sourcedMachineValue(
  label: string,
  value: Machine["usableBendLengthMm"],
): string {
  const rendered = value.originalText ?? (value.value === null ? "not provided" : String(value.value));
  return `${label}: ${clip(rendered, MAX_DISPLAY_TEXT)} (recorded evidence state: ${value.evidenceState}).`;
}

function machineCapacityLabel(machine: Machine): string {
  return /bend|brake/i.test(machine.process)
    ? "Usable bend length"
    : "Recorded length field (not a machining envelope)";
}

function assertPacketBounds(sources: PitchSource[]): void {
  if (sources.length > MAX_PACKET_SOURCE_COUNT) {
    throw new ApiFault("UNSUPPORTED_ASSET", "The pitch source packet has too many readable excerpts. Split the drawing packet before analysis.");
  }
  const totalCharacters = sources.reduce((total, source) => total + source.text.length, 0);
  if (totalCharacters > MAX_PACKET_TEXT_CHARS) {
    throw new ApiFault("UNSUPPORTED_ASSET", "The readable pitch source packet is too large. Split the drawing packet before analysis.");
  }
}

async function readCheckedBytes(asset: Asset, readSource: PitchSourceReader): Promise<Uint8Array> {
  const bytes = await readSource(asset);
  if (bytes.byteLength !== asset.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new ApiFault("VERSION_CONFLICT", "A selected source changed after verification; upload it again.");
  }
  return bytes;
}

function clipSourceText(text: string): string {
  if (text.length <= MAX_SOURCE_TEXT) return text;
  const available = MAX_SOURCE_TEXT - TRUNCATION_NOTICE.length;
  return `${text.slice(0, available)}${TRUNCATION_NOTICE}`;
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}
