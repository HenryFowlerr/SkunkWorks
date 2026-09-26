import type { Draft, DraftContentInput, EvidenceRef, PanelModelInput } from '@/contracts';

function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const result = { ...value };
  for (const key of keys) delete result[key];
  return result;
}

/** Project a server draft into the strict editable request contract. */
export function toDraftContentInput(draft: Draft): DraftContentInput {
  const panelModel: PanelModelInput | null = draft.content.panelModel
    ? omit(structuredClone(draft.content.panelModel), 'reviewed')
    : null;

  return {
    sourceAssetIds: [...draft.content.sourceAssetIds],
    workshopSnapshotId: draft.content.workshopSnapshotId,
    machineId: draft.content.machineId,
    panelModel,
    bends: structuredClone(draft.content.bends),
    steps: structuredClone(draft.content.steps),
    findings: draft.content.findings.map((finding) => structuredClone(omit(finding, 'disposition', 'resolutionRecordId'))),
    machineProposals: draft.content.machineProposals.map((proposal) => structuredClone(omit(proposal, 'status', 'decidedBy'))),
  };
}

export type PublishDraftSnapshot = Pick<Draft, 'version' | 'content' | 'reviews'>;

/** Client-side explanation only; the publish endpoint still enforces every invariant. */
export function getPublishBlockers(draft: PublishDraftSnapshot, isDirty = false): string[] {
  const blockers: string[] = [];
  if (isDirty) blockers.push('Save the mapping changes before reviewing or publishing.');
  if (!draft.content.panelModel?.reviewed) blockers.push('The panel mapping has not been design-reviewed.');
  for (const kind of ['design', 'process'] as const) {
    if (!draft.reviews.some((review) => review.kind === kind && review.draftVersion === draft.version)) {
      blockers.push(`A current ${kind} review is required.`);
    }
  }
  if (draft.content.findings.some((finding) => finding.disposition === 'open' && finding.severity === 'blocking')) {
    blockers.push('Resolve all open blocking findings.');
  }
  if (draft.content.machineProposals.some((proposal) => proposal.status === 'proposed')) {
    blockers.push('Decide every machine order proposal.');
  }
  if (draft.content.steps.some((step) => !step.guidance || step.guidance.decision === 'pending')) {
    blockers.push('Decide which operations need detailed phone guidance.');
  }
  return blockers;
}

export function evidenceAssetId(evidence: EvidenceRef): string | null {
  return evidence.kind === 'document' ? evidence.assetId : null;
}
