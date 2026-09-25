import { randomUUID } from "node:crypto";
import {
  AnswerSchema,
  BendSchema,
  ContextRefSchema,
  FindingSchema,
  StepSchema,
  type Bend,
  type EvidenceRef,
  type Finding,
  type MachineProposal,
  type Step,
} from "../../contracts/domain";
import { AiProviderError, type AskResult, type DraftProposal } from "./types";
import type { GenerationInput, PreparedEvidence, QuestionInput, RawCitation } from "./types";
import { GenerationOutputSchema, QuestionOutputSchema, type GenerationOutput } from "./schemas";
import {
  assertEvidenceState,
  assertRawNumericClaimsGrounded,
  distinctCitationIds,
  validateCitations,
  validateMachineOrder,
} from "./grounding";

const MISSING_NOT_FOUND = "The supplied source does not establish this bend fact; confirm it with the designer before forming the part.";
const MISSING_UNREADABLE = "The relevant source is not readable enough to establish this bend fact; confirm it with the designer before forming the part.";
const MISSING_CONFLICT = "The supplied sources disagree about this bend fact; resolve the conflict with the designer before forming the part.";

export function parseGenerationOutput(
  raw: unknown,
  input: GenerationInput,
  evidence: PreparedEvidence[],
  model: string,
): DraftProposal {
  const parsed = GenerationOutputSchema.safeParse(raw);
  if (!parsed.success) throw malformed();
  const output = parsed.data;
  const knownBends = new Map(input.mappedBends.map((bend) => [bend.bendId, bend]));
  const knownSteps = new Map(input.stepTargets.map((step) => [step.id, step]));
  assertKnownUnique(output.bends.map((bend) => bend.bendId), knownBends);
  if (output.bends.length !== knownBends.size) throw malformed();
  const seenStepIds = new Set<string>();
  const stepsById = new Map<string, Step>();
  for (const candidate of output.steps) {
    const target = knownSteps.get(candidate.id);
    if (!target || candidate.bendId !== target.bendId || seenStepIds.has(candidate.id) || !candidate.instruction.trim()) {
      throw unsupported();
    }
    seenStepIds.add(candidate.id);
    const citations = validateCitations(candidate.citations, evidence);
    if (citations.length === 0) throw unsupported();
    assertRawNumericClaimsGrounded(candidate.instruction, candidate.citations, evidence, [candidate.bendId, candidate.id]);
    stepsById.set(candidate.id, StepSchema.parse({
      id: candidate.id,
      bendId: candidate.bendId,
      instruction: candidate.instruction.trim(),
      evidence: citations,
      camera: null,
    }));
  }

  const bends: DraftProposal["bends"] = [];
  const findings: Finding[] = [];
  for (const [bendId, mapped] of knownBends) {
    const candidate = output.bends.find((item) => item.bendId === bendId);
    if (!candidate) throw malformed();
    const finishedAngle = mapSourced(
      candidate.finishedAngle.evidenceState,
      candidate.finishedAngle.value,
      candidate.finishedAngle.citations,
      evidence,
      (value, citations) => validateFinishedAngle(value, citations, candidate.finishedAngle.citations, evidence),
      (value) => value !== null && value.degrees !== null && value.convention !== null,
    );
    const insideRadiusMm = mapSourced(
      candidate.insideRadiusMm.evidenceState,
      candidate.insideRadiusMm.value,
      candidate.insideRadiusMm.citations,
      evidence,
      (value, citations) => validateRadius(value, citations, candidate.insideRadiusMm.citations, evidence),
    );
    const directionText = mapSourced(
      candidate.directionText.evidenceState,
      candidate.directionText.value,
      candidate.directionText.citations,
      evidence,
      (value, citations) => validateDirection(value, citations, candidate.directionText.citations, evidence),
    );

    bends.push(BendSchema.parse({
      bendId,
      hingeId: mapped.hingeId,
      // Signed fold rotation is owned by the reviewed manifest and copied
      // without asking the language model to infer or alter geometry.
      foldRotationDeg: mapped.foldRotationDeg,
      finishedAngle,
      insideRadiusMm,
      directionText,
    }));

    if (mapped.hingeId === null) {
      findings.push(makeFinding("mapping", bendId, "This bend has no reviewed hinge mapping. Map it in the bend editor before publication."));
    }
    addFactFinding(findings, bendId, "signed fold rotation", mapped.foldRotationDeg);
    addFactFinding(findings, bendId, "finished angle", finishedAngle);
    addFactFinding(findings, bendId, "inside radius", insideRadiusMm);
    addFactFinding(findings, bendId, "bend direction", directionText);
  }

  // A missing grounded step becomes an explicit blocking finding rather than
  // an invented instruction. The pre-minted step ID remains unused.
  for (const target of input.stepTargets) {
    if (!stepsById.has(target.id)) {
      findings.push(makeFinding("missing_data", target.bendId, "No source-grounded instruction was available for this bend; ask the designer to add one."));
    }
  }

  const machineProposal = parseMachineProposal(output, input, evidence);
  return {
    bends,
    steps: [...stepsById.values()],
    findings,
    machineProposal,
    model,
  };
}

export function parseQuestionOutput(
  raw: unknown,
  input: QuestionInput,
  evidence: PreparedEvidence[],
  model: string,
): AskResult {
  const parsed = QuestionOutputSchema.safeParse(raw);
  if (!parsed.success) throw malformed();
  const output = parsed.data;
  const knownBends = new Set(input.knownBendIds);
  const knownStepIds = new Set(input.knownStepTargets.map((step) => step.id));
  if (new Set(output.referencedBendIds).size !== output.referencedBendIds.length ||
    new Set(output.referencedStepIds).size !== output.referencedStepIds.length ||
    output.referencedBendIds.some((id) => !knownBends.has(id)) ||
    output.referencedStepIds.some((id) => !knownStepIds.has(id))) throw unsupported();

  const citations = validateCitations(output.citations, evidence);
  const distinct = new Set(distinctCitationIds(output.citations)).size;
  if ((output.evidenceState === "supported" && citations.length < 1) ||
    (output.evidenceState === "conflict" && distinct < 2) ||
    ((output.evidenceState === "not_found" || output.evidenceState === "unreadable") && citations.length !== 0)) {
    throw unsupported();
  }

  const text = safeQuestionText(output.evidenceState, output.text);
  if ((output.evidenceState === "supported" || output.evidenceState === "conflict") && !text) throw malformed();
  if (output.evidenceState === "supported" || output.evidenceState === "conflict") {
    assertRawNumericClaimsGrounded(text, output.citations, evidence, [
      ...input.knownBendIds,
      ...input.knownStepTargets.map((step) => step.id),
    ]);
    assertKnownInlineBendLabels(text, input.knownBendIds);
  }

  const answer = AnswerSchema.parse({
    id: randomUUID(),
    context: ContextRefSchema.parse(input.context),
    evidenceState: output.evidenceState,
    text,
    evidence: citations,
    suggestedFlag: output.evidenceState === "supported" ? null : "Ask the designer to confirm this point.",
  });
  return { ...answer, model };
}

function parseMachineProposal(
  output: GenerationOutput,
  input: GenerationInput,
  evidence: PreparedEvidence[],
): DraftProposal["machineProposal"] {
  const rationale = output.machineRationale.trim();
  if (output.machineOrder.length === 0) {
    if (rationale || output.machineCitations.length) throw unsupported();
    return null;
  }
  if (!rationale) throw unsupported();
  const bendIds = input.mappedBends.map((bend) => bend.bendId);
  const selectedMachine = input.workshopSnapshot.machines.find((machine) => machine.id === input.machineId);
  if (!selectedMachine) throw unsupported();
  validateMachineOrder(output.machineOrder, bendIds, input.partFamily, selectedMachine.approvedOrderConstraints);
  const citations = validateCitations(output.machineCitations, evidence);
  if (citations.length === 0 || !citations.some((citation) =>
    citation.kind === "workshop_note" && citation.snapshotId === input.workshopSnapshot.id && citation.machineId === input.machineId,
  )) throw unsupported();
  const applicableConstraints = selectedMachine.approvedOrderConstraints.filter((constraint) =>
    constraint.appliesToPartFamily.trim().toLocaleLowerCase() === input.partFamily.trim().toLocaleLowerCase(),
  );
  if (applicableConstraints.length === 0) throw unsupported();
  for (const constraint of applicableConstraints) {
    if (!citations.some((citation) => citation.kind === "workshop_note" && citation.noteId === constraint.noteId)) {
      throw unsupported();
    }
  }
  assertRawNumericClaimsGrounded(rationale, output.machineCitations, evidence, [input.machineId, input.workshopSnapshot.id]);
  const proposal: Omit<MachineProposal, "id" | "snapshotId" | "machineId" | "status" | "decidedBy"> = {
    proposedBendOrder: output.machineOrder,
    rationale,
    evidence: citations,
  };
  return proposal;
}

function mapSourced<T>(
  state: "supported" | "conflict" | "not_found" | "unreadable",
  value: T | null,
  rawCitations: RawCitation[],
  evidence: PreparedEvidence[],
  validateValue: (value: T, citations: EvidenceRef[]) => void,
  isPresent: (value: T | null) => boolean = (value) => value !== null,
) {
  const citations = validateCitations(rawCitations, evidence);
  assertEvidenceState(state, isPresent(value), citations, distinctCitationIds(rawCitations));
  if (state === "supported" && value !== null) validateValue(value, citations);
  const evidenceState = state;
  return {
    value: state === "supported" ? value : null,
    evidence: citations,
    evidenceState,
    originalText: citations.length > 0
      ? rawCitations.map((citation) => citation.excerpt).join("; ")
      : null,
  };
}

function validateFinishedAngle(
  value: { degrees: number | null; convention: "internal" | "external" | "from_flat" | null },
  refs: EvidenceRef[],
  raw: RawCitation[],
  evidence: PreparedEvidence[],
): void {
  if (!Number.isFinite(value.degrees) || value.convention === null) throw unsupported();
  const excerpts = citationTexts(raw, evidence).toLocaleLowerCase();
  assertRawNumericClaimsGrounded(String(value.degrees), raw, evidence);
  if (!/(°|\bdeg(?:ree)?s?\b)/i.test(excerpts)) throw unsupported();
  const conventionEvidence: Record<NonNullable<typeof value.convention>, RegExp> = {
    internal: /\b(internal|inside)\b/i,
    external: /\bexternal\b/i,
    from_flat: /\b(from\s+flat|flat\s+position)\b/i,
  };
  if (!conventionEvidence[value.convention].test(excerpts)) throw unsupported();
  if (refs.length === 0) throw unsupported();
}

function validateRadius(value: number, refs: EvidenceRef[], raw: RawCitation[], evidence: PreparedEvidence[]): void {
  if (!Number.isFinite(value) || value < 0) throw unsupported();
  assertRawNumericClaimsGrounded(String(value), raw, evidence);
  if (!/\bmm\b|\bmillimet(?:er|re)s?\b/i.test(citationTexts(raw, evidence))) throw unsupported();
  if (refs.length === 0) throw unsupported();
}

function validateDirection(value: string, refs: EvidenceRef[], raw: RawCitation[], evidence: PreparedEvidence[]): void {
  if (!value.trim()) throw unsupported();
  assertRawNumericClaimsGrounded(value, raw, evidence);
  if (refs.length === 0) throw unsupported();
}

function citationTexts(citations: RawCitation[], evidence: PreparedEvidence[]): string {
  const byKey = new Map(evidence.map((item) => [item.sourceKey, item]));
  return citations.map((citation) => {
    const source = byKey.get(citation.sourceKey);
    return source?.text && source.text.normalize("NFKC").replace(/\s+/g, " ").includes(
      citation.excerpt.normalize("NFKC").replace(/\s+/g, " "),
    ) ? citation.excerpt : "";
  }).join(" ");
}

function addFactFinding(
  findings: Finding[],
  bendId: string,
  label: string,
  value: { evidenceState: Bend["finishedAngle"]["evidenceState"]; evidence: EvidenceRef[] },
): void {
  if (value.evidenceState === "supported") return;
  if (value.evidenceState === "conflict") {
    findings.push(makeFinding("source_conflict", bendId, MISSING_CONFLICT, value.evidence));
  } else if (value.evidenceState === "unreadable") {
    findings.push(makeFinding("missing_data", bendId, `${label}: ${MISSING_UNREADABLE}`));
  } else {
    findings.push(makeFinding("missing_data", bendId, `${label}: ${MISSING_NOT_FOUND}`));
  }
}

function makeFinding(kind: Finding["kind"], bendId: string | null, message: string, evidence: EvidenceRef[] = []): Finding {
  return FindingSchema.parse({
    id: randomUUID(), kind, severity: "blocking", bendId, message,
    evidence, disposition: "open", resolutionRecordId: null,
  });
}

function assertKnownUnique<T>(ids: string[], known: Map<string, T>): void {
  if (new Set(ids).size !== ids.length || ids.length !== known.size || ids.some((id) => !known.has(id))) {
    throw unsupported();
  }
}

function malformed(): AiProviderError {
  return new AiProviderError("MALFORMED_OUTPUT");
}

function safeQuestionText(
  state: "supported" | "conflict" | "not_found" | "unreadable",
  providerText: string,
): string {
  if (state === "not_found") return "The supplied evidence does not establish this. Ask the designer to confirm before forming the part.";
  if (state === "unreadable") return "The relevant source is not readable enough to answer. Ask the designer to confirm before proceeding.";
  const trimmed = providerText.trim();
  if (trimmed.length > 5_000) throw malformed();
  return trimmed;
}

function assertKnownInlineBendLabels(text: string, knownIds: string[]): void {
  const labels = [...text.matchAll(/\bB\d+\b/gi)].map((match) => match[0].toLocaleLowerCase());
  const allowed = new Set(knownIds.map((id) => id.toLocaleLowerCase()));
  if (labels.some((id) => !allowed.has(id))) throw unsupported();
}

function unsupported(): AiProviderError {
  return new AiProviderError("UNSUPPORTED_CLAIM");
}
