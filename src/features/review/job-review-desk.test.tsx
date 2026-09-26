import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiTransport, ApiTransportRequest } from '@/lib/api/client';
import { createApiClient } from '@/lib/api/client';
import type { Asset, Draft, DraftContentInput, Flag, Generation, Job, MachineProposal, Release, Review } from '@/contracts';
import { draft, ids, job, openFlag, release, sourceAsset } from '../../../tests/contracts/fixtures';
import { JobReviewDesk } from './job-review-desk';
import { getPublishBlockers, toDraftContentInput } from './review.logic';

vi.mock('@/features/visualization', () => ({
  BendMapEditor: () => <div>Mapping editor</div>,
  BendScene: () => null,
  ModelViewer: () => null,
}));

afterEach(() => cleanup());

const meta = { requestId: 'review-test', contractVersion: '1.0' as const };
const proposal: MachineProposal = {
  id: ids.proposal,
  snapshotId: ids.workshopSnapshot,
  machineId: ids.machine,
  proposedBendOrder: ['B1'],
  rationale: 'Keep the return flange supported against the back gauge.',
  evidence: [],
  status: 'proposed',
  decidedBy: null,
};

function proposalDraft(): Draft {
  return {
    ...structuredClone(draft),
    content: { ...structuredClone(draft.content), machineProposals: [structuredClone(proposal)] },
  };
}

const modelAsset: Asset = {
  ...sourceAsset,
  id: ids.proposal,
  kind: 'model_glb',
  filename: 'sample-bracket.glb',
  mimeType: 'model/gltf-binary',
};
const manifestAsset: Asset = {
  ...sourceAsset,
  id: ids.generation,
  kind: 'bend_manifest',
  filename: 'sample-bracket.bend.json',
  mimeType: 'application/json',
};

const pitchCitation = { sourceKey: `document:${ids.asset}:1`, excerpt: 'All dimensions in millimeters.' };
const pitchCapability = {
  approvalState: 'draft' as const,
  decision: 'clear_for_engineer_review' as const,
  code: 'SETUP_REVIEW_REQUIRED' as const,
  title: 'Ready for engineer review',
  explanation: 'The readable drawing and supplier profile need final setup review.',
  checks: [{ id: 'drawing-units', label: 'Drawing units', status: 'supported' as const, reason: 'The drawing names its unit system.', citations: [pitchCitation] }],
  requiredEngineerDecisions: ['Confirm setup before release.'],
  sourceKeysRead: [pitchCitation.sourceKey],
};
const pitchKnowledgeBase = {
  approvalState: 'draft' as const,
  title: 'Sample bracket knowledge base',
  titleCitations: [pitchCitation],
  partSummary: 'A concise source-backed draft.',
  partSummaryCitations: [pitchCitation],
  sourceSummary: 'One readable drawing source was reviewed.',
  sourceSummaryCitations: [pitchCitation],
  operatorSteps: [{ id: 'inspect', title: 'Inspect drawing', instruction: 'Read the supplied drawing before setup.', guidanceKind: 'attention' as const, citations: [pitchCitation] }],
  attentionPoints: [],
  openQuestions: [],
  openQuestionCitations: [],
  recommendedPhoneStartStepId: 'inspect',
};
const pitchTriage = {
  approvalState: 'draft' as const,
  severity: 'hold' as const,
  title: 'Review reported hole position',
  summary: 'The floor report requires engineer review.',
  affectedOperation: 'Hole drilling',
  knownEvidence: ['The drawing establishes the unit system.'],
  knownEvidenceCitations: [[pitchCitation]],
  unknowns: ['The selected fixture is not established by the packet.'],
  engineerDecisionNeeded: 'Confirm the intended drawing context before work resumes.',
  suggestedReply: 'Keep the affected work pending while engineering reviews it.',
  citations: [pitchCitation],
};
const pitchPreview = {
  approvalState: 'draft' as const,
  evidenceState: 'supported' as const,
  text: 'Read the supplied drawing before setup.',
  citations: [pitchCitation],
  suggestedEngineerReview: null,
};

function twoStepDraft(): Draft {
  const first = { ...draft.content.steps[0], instruction: 'First pass for Bend B1.' };
  const second = { ...draft.content.steps[0], id: ids.review, instruction: 'Second pass for Bend B1.' };
  return { ...proposalDraft(), content: { ...proposalDraft().content, steps: [first, second] } };
}

function apiHarness(options: { forbiddenReview?: boolean; flags?: Flag[]; releases?: Release[]; twoSteps?: boolean; noDraft?: boolean; generation?: boolean; pitch?: boolean } = {}) {
  let serverDraft = options.twoSteps ? twoStepDraft() : proposalDraft();
  const noDraftAssets = options.pitch ? [sourceAsset, modelAsset] : [sourceAsset, modelAsset, manifestAsset];
  let serverJob: Job = options.noDraft
    ? { ...job, draftId: null, latestReleaseId: null, sourceAssetIds: noDraftAssets.map((asset) => asset.id) }
    : job;
  let generation: Generation | null = null;
  const requests: ApiTransportRequest[] = [];
  const transport: ApiTransport = {
    async request(request) {
      requests.push(request);
      if (request.method === 'GET' && request.path === `/api/jobs/${ids.job}`) {
        return {
          data: {
            job: serverJob,
            assets: options.noDraft ? noDraftAssets : [sourceAsset],
            draft: serverJob.draftId ? serverDraft : null,
            releases: options.releases ?? (options.noDraft ? [] : [release]),
          },
          meta,
        };
      }
      if (request.method === 'GET' && request.path === `/api/jobs/${ids.job}/draft`) return { data: serverDraft, meta };
      if (request.method === 'GET' && request.path.startsWith('/api/flags?')) return { data: options.flags ?? [], meta };
      if (request.method === 'GET' && request.path.startsWith('/api/assets/') && request.path.endsWith('/link')) {
        return { data: { url: 'https://storage.example.test/source.pdf?authorized=1', expiresAt: '2026-09-27T00:00:00Z' }, meta };
      }
      if (options.generation && request.method === 'POST' && request.path === `/api/jobs/${ids.job}/generate`) {
        generation = {
          id: ids.generation,
          jobId: ids.job,
          inputFingerprint: 'c'.repeat(64),
          state: 'running',
          startedAt: '2026-09-26T10:00:00Z',
          expiresAt: '2026-09-26T11:00:00Z',
          draftVersion: null,
          errorCode: null,
        };
        return { data: generation, meta };
      }
      if (options.generation && request.method === 'GET' && request.path === `/api/generations/${ids.generation}` && generation) {
        const completed: Generation = { ...generation, state: 'succeeded', draftVersion: serverDraft.version, errorCode: null };
        generation = completed;
        serverJob = { ...serverJob, draftId: serverDraft.id, version: serverJob.version + 1 };
        return { data: { generation: completed, draft: serverDraft }, meta };
      }
      if (options.pitch && request.method === 'POST' && request.path === `/api/jobs/${ids.job}/pitch`) {
        const body = request.body as { action: 'capability' | 'knowledge_base' | 'preview_question' | 'triage' };
        if (body.action === 'capability') return { data: { action: 'capability', capability: pitchCapability }, meta };
        if (body.action === 'knowledge_base') return { data: { action: 'knowledge_base', capability: pitchCapability, knowledgeBase: pitchKnowledgeBase }, meta };
        if (body.action === 'preview_question') return { data: { action: 'preview_question', answer: pitchPreview }, meta };
        return { data: { action: 'triage', triage: pitchTriage }, meta };
      }
      if (request.method === 'POST' && request.path === `/api/jobs/${ids.job}/draft/proposals/${ids.proposal}/decision`) {
        const body = request.body as { decision: 'accept' | 'reject' };
        serverDraft = {
          ...serverDraft,
          content: { ...serverDraft.content, machineProposals: serverDraft.content.machineProposals.map((item) => ({ ...item, status: body.decision === 'accept' ? 'accepted' : 'rejected', decidedBy: ids.member })) },
        };
        return { data: serverDraft, meta };
      }
      if (request.method === 'POST' && request.path === `/api/jobs/${ids.job}/draft/reviews`) {
        if (options.forbiddenReview) return { error: { code: 'FORBIDDEN', message: 'This account cannot record this review.', retryable: false }, meta };
        const body = request.body as { kind: Review['kind'] };
        const review: Review = { kind: body.kind, actorId: ids.member, draftVersion: serverDraft.version, at: '2026-09-26T10:00:00Z' };
        serverDraft = {
          ...serverDraft,
          content: { ...serverDraft.content, panelModel: serverDraft.content.panelModel ? { ...serverDraft.content.panelModel, reviewed: true } : null },
          reviews: [...serverDraft.reviews.filter((item) => item.kind !== body.kind), review],
        };
        return { data: serverDraft, meta };
      }
      if (request.method === 'PUT' && request.path === `/api/jobs/${ids.job}/draft`) {
        const body = request.body as { content: DraftContentInput };
        serverDraft = {
          ...serverDraft,
          version: serverDraft.version + 1,
          content: {
            ...body.content,
            panelModel: body.content.panelModel ? { ...body.content.panelModel, reviewed: false } : null,
            findings: body.content.findings.map((item) => {
              const previous = serverDraft.content.findings.find((finding) => finding.id === item.id);
              return { ...item, disposition: previous?.disposition ?? 'open', resolutionRecordId: previous?.resolutionRecordId ?? null };
            }),
            machineProposals: body.content.machineProposals.map((item) => {
              const previous = serverDraft.content.machineProposals.find((proposalItem) => proposalItem.id === item.id);
              return { ...item, status: previous?.status ?? 'proposed', decidedBy: previous?.decidedBy ?? null };
            }),
          },
          reviews: [],
        };
        serverJob = { ...serverJob, version: serverJob.version + 1 };
        return { data: serverDraft, meta };
      }
      if (request.method === 'POST' && request.path === `/api/jobs/${ids.job}/publish`) return { data: release, meta };
      if (request.method === 'POST' && request.path === `/api/flags/${ids.flag}/response`) {
        const body = request.body as { text: string; kind: 'explanation' | 'replacement_release'; replacementReleaseId: string | null };
        const responded: Flag = {
          ...openFlag,
          version: openFlag.version + 1,
          status: 'responded',
          response: { text: body.text, authorId: ids.member, at: '2026-09-26T10:00:00Z', kind: body.kind, replacementReleaseId: body.replacementReleaseId },
        };
        return { data: responded, meta };
      }
      throw new Error(`Unexpected review API request: ${request.method} ${request.path}`);
    },
    async upload() { throw new Error('The review desk should not upload files.'); },
  };
  return { client: createApiClient(transport), requests };
}

describe('designer review desk', () => {
  it('reports the real unavailable API instead of rendering fixture success', async () => {
    render(<JobReviewDesk jobId={ids.job} role="designer" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/endpoint is not available/i);
    expect(screen.queryByRole('heading', { name: 'Sample bracket' })).not.toBeInTheDocument();
  });

  it('strips server-owned fields from mapping saves and explains proposal/review/publish blockers', () => {
    const editable = toDraftContentInput(proposalDraft());
    expect(editable.panelModel).not.toHaveProperty('reviewed');
    expect(editable.findings[0]).toBeUndefined();
    expect(editable.machineProposals[0]).not.toHaveProperty('status');
    expect(editable.machineProposals[0]).not.toHaveProperty('decidedBy');

    const blockers = getPublishBlockers(proposalDraft());
    expect(blockers).toContain('A current design review is required.');
    expect(blockers).toContain('A current process review is required.');
    expect(blockers).toContain('Decide every machine order proposal.');
    expect(getPublishBlockers(proposalDraft(), true)).toContain('Save the mapping changes before reviewing or publishing.');
  });

  it('routes proposal decisions and both review kinds to the API, then only enables eligible publication', async () => {
    const { client, requests } = apiHarness();
    render(<JobReviewDesk jobId={ids.job} role="designer" client={client} />);

    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Publish release' })).toBeDisabled();
    expect(screen.getByText(/Decide every machine order proposal/i)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Accept proposal' }));
    await waitFor(() => expect(requests.some((request) => request.path.endsWith('/draft/proposals/' + ids.proposal + '/decision'))).toBe(true));
    await waitFor(() => expect(screen.getByText('Machine proposal accepted by the service.')).toBeVisible());

    expect(screen.getByRole('button', { name: 'Submit design review' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I checked this version’s bend IDs/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit design review' }));
    await waitFor(() => expect(requests.some((request) => request.path.endsWith('/draft/reviews') && (request.body as { kind?: string }).kind === 'design')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Submit process review' }));
    await waitFor(() => expect(requests.some((request) => request.path.endsWith('/draft/reviews') && (request.body as { kind?: string }).kind === 'process')).toBe(true));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Publish release' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Publish release' }));
    await waitFor(() => expect(requests.some((request) => request.path === `/api/jobs/${ids.job}/publish`)).toBe(true));
    expect(await screen.findByText(/service published release #1/i)).toBeVisible();
  });

  it('stages an instruction reorder and saves the new sequence with the current draft version', async () => {
    const { client, requests } = apiHarness({ twoSteps: true });
    render(<JobReviewDesk jobId={ids.job} role="designer" client={client} />);

    expect(await screen.findByRole('heading', { name: 'Process sequence and phone guidance' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Move step 2, Bend B1, earlier' }));

    expect(screen.getByText(/Step 2 of 2/)).toBeVisible();
    expect(screen.getByText('Second pass for Bend B1.')).toBeVisible();
    expect(screen.getByText(/Step order change staged/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Submit design review' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft changes' }));
    await waitFor(() => expect(requests.some((request) => request.method === 'PUT' && request.path === `/api/jobs/${ids.job}/draft`)).toBe(true));
    const save = requests.find((request) => request.method === 'PUT' && request.path === `/api/jobs/${ids.job}/draft`);
    expect(save?.body).toMatchObject({
      expectedVersion: 1,
      content: { steps: [{ id: ids.review }, { id: ids.step }] },
    });
    expect(await screen.findByText('Draft version 2 saved by the service.')).toBeVisible();
  });

  it('lets an engineer edit and select a guide before a new draft review', async () => {
    const { client, requests } = apiHarness();
    render(<JobReviewDesk jobId={ids.job} role="designer" client={client} />);

    const instruction = await screen.findByRole('textbox', { name: 'Proposed instruction' });
    fireEvent.change(instruction, { target: { value: 'Check the marked orientation before forming this return.' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Show detailed guidance to the operator?' }), { target: { value: 'exclude' } });
    expect(screen.getByRole('button', { name: 'Submit design review' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft changes' }));

    await waitFor(() => expect(requests.some((request) => request.method === 'PUT' && request.path === `/api/jobs/${ids.job}/draft`)).toBe(true));
    const save = requests.find((request) => request.method === 'PUT' && request.path === `/api/jobs/${ids.job}/draft`);
    expect(save?.body).toMatchObject({
      expectedVersion: 1,
      content: { steps: [{ instruction: 'Check the marked orientation before forming this return.', guidance: { decision: 'exclude' } }] },
    });
    expect(await screen.findByText('Draft version 2 saved by the service.')).toBeVisible();
  });

  it('starts and reads a server generation operation before showing the returned draft', async () => {
    const { client, requests } = apiHarness({ noDraft: true, generation: true });
    render(<JobReviewDesk jobId={ids.job} role="designer" client={client} />);

    expect(await screen.findByRole('heading', { name: 'Generate the first draft' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));

    await waitFor(() => expect(requests.some((request) => request.method === 'POST' && request.path === `/api/jobs/${ids.job}/generate`)).toBe(true));
    await waitFor(() => expect(requests.some((request) => request.method === 'GET' && request.path === `/api/generations/${ids.generation}`)).toBe(true));
    expect(requests.find((request) => request.method === 'POST' && request.path === `/api/jobs/${ids.job}/generate`)).toMatchObject({
      body: { expectedJobVersion: job.version },
    });
    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Generate AI draft' })).not.toBeInTheDocument();
    expect(screen.getByText(/Process sequence and phone guidance/i)).toBeVisible();
  });

  it('runs the readable-PDF pitch check, knowledge-base draft, and floor triage without a bend manifest release', async () => {
    const { client, requests } = apiHarness({ noDraft: true, pitch: true });
    render(<JobReviewDesk jobId={ids.job} role="designer" client={client} />);

    expect(await screen.findByRole('heading', { name: 'Pitch analysis for readable drawings' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Run supplier capability check' }));
    expect(await screen.findByText('Ready for engineer review')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Create knowledge-base draft' }));
    expect(await screen.findByText('Sample bracket knowledge base')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Affected operation (optional)' }), { target: { value: 'Hole drilling' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Floor report' }), { target: { value: 'The hole position is unclear.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create engineer triage draft' }));
    expect(await screen.findByText('Review reported hole position')).toBeVisible();

    const pitchRequests = requests.filter((request) => request.path === `/api/jobs/${ids.job}/pitch`);
    expect(pitchRequests.map((request) => (request.body as { action: string }).action)).toEqual(['capability', 'knowledge_base', 'triage']);
    expect(pitchRequests[2]?.body).toMatchObject({ issue: { operation: 'Hole drilling', text: 'The hole position is unclear.' } });
    expect(screen.getByText(/cannot publish a QR guide/i)).toBeVisible();
  });

  it('keeps the Luna phone chat preview inside the engineer draft flow', async () => {
    const { client, requests } = apiHarness({ noDraft: true, pitch: true });
    render(<JobReviewDesk jobId={ids.job} role="designer" client={client} />);

    expect(await screen.findByRole('heading', { name: 'Pitch analysis for readable drawings' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Run supplier capability check' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create knowledge-base draft' }));
    expect(await screen.findByLabelText('Luna phone Q&A preview')).toBeVisible();
    expect(screen.getByText(/cannot publish a release, create a QR destination/i)).toBeVisible();

    fireEvent.change(screen.getByRole('textbox', { name: 'Preview floor question' }), { target: { value: 'What should I check first?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask draft phone chat' }));

    expect(await screen.findByLabelText('Draft phone answer')).toHaveTextContent(pitchPreview.text);
    const previewRequest = requests.find((request) => (request.body as { action?: string } | undefined)?.action === 'preview_question');
    expect(previewRequest?.body).toEqual({
      expectedJobVersion: job.version,
      action: 'preview_question',
      preview: { question: 'What should I check first?' },
    });
  });

  it('sends a process review request for the current role and shows the API authorization error unchanged', async () => {
    const { client, requests } = apiHarness({ forbiddenReview: true });
    render(<JobReviewDesk jobId={ids.job} role="fabricator" client={client} />);
    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Submit process review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This account cannot record this review.');
    expect(requests.some((request) => request.method === 'POST' && request.path.endsWith('/draft/reviews'))).toBe(true);
  });

  it('responds to the exact flag context and only offers an actual same-job replacement release', async () => {
    const otherJobRelease: Release = { ...structuredClone(release), id: ids.workspace, jobId: ids.workspace, revisionNumber: 99 };
    const sameJobReplacement: Release = { ...structuredClone(release), id: ids.review, revisionNumber: 2, supersedesReleaseId: release.id };
    const { client, requests } = apiHarness({ flags: [openFlag], releases: [release, sameJobReplacement, otherJobRelease] });
    render(<JobReviewDesk jobId={ids.job} role="designer" client={client} />);
    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(await screen.findByText(openFlag.question)).toBeVisible();
    expect(requests.some((request) => request.method === 'GET' && request.path === `/api/flags?jobId=${ids.job}`)).toBe(true);

    fireEvent.change(screen.getByLabelText('Response type'), { target: { value: 'replacement_release' } });
    const replacementSelect = screen.getByLabelText('Same-job replacement release');
    expect(screen.queryByRole('option', { name: 'Release #99' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Release #2' })).toBeInTheDocument();
    fireEvent.change(replacementSelect, { target: { value: sameJobReplacement.id } });
    fireEvent.change(screen.getByLabelText('Response to the factory-floor issue'), { target: { value: 'Use the revised bend sequence in this published release.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send reply' }));

    await waitFor(() => expect(requests.some((request) => request.method === 'POST' && request.path === `/api/flags/${ids.flag}/response`)).toBe(true));
    const responseRequest = requests.find((request) => request.path === `/api/flags/${ids.flag}/response`);
    expect(responseRequest?.body).toEqual({
      expectedVersion: openFlag.version,
      text: 'Use the revised bend sequence in this published release.',
      kind: 'replacement_release',
      replacementReleaseId: sameJobReplacement.id,
    });
  });
});
