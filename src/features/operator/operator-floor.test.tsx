import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiTransport, ApiTransportRequest } from '@/lib/api/client';
import { createApiClient } from '@/lib/api/client';
import type { Answer, Flag, ReleaseView } from '@/contracts';
import { ids, openFlag, releaseContext, releaseView } from '../../../tests/contracts/fixtures';
import { OperatorFloor } from './operator-floor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/visualization', () => ({
  BendScene: () => null,
  ModelViewer: ({ assetId, format, variant }: { assetId: string; format: 'glb' | 'stl'; variant?: 'default' | 'immersive' }) => (
    <output data-testid="released-model-viewer" data-asset-id={assetId} data-format={format} data-variant={variant ?? 'default'}>Loaded {format.toUpperCase()} visual reference</output>
  ),
}));

afterEach(() => cleanup());

const meta = { requestId: 'floor-test', contractVersion: '1.0' as const };
const sampleAnswer: Answer = {
  id: ids.review,
  context: releaseContext,
  evidenceState: 'supported',
  text: 'The released drawing marks the outside face as the reference side.',
  evidence: [],
  suggestedFlag: null,
};

function viewFixture(): ReleaseView {
  return {
    ...structuredClone(releaseView),
    release: {
      ...structuredClone(releaseView.release),
      snapshot: { ...structuredClone(releaseView.release.snapshot), panelModel: null },
    },
  };
}

function viewWithReadyModel(kind: 'model_glb' | 'model_stl'): ReleaseView {
  const view = viewFixture();
  view.job.sourceAssetIds = [...view.job.sourceAssetIds, ids.proposal];
  view.release.snapshot.sourceAssetIds = [...view.release.snapshot.sourceAssetIds, ids.proposal];
  view.sourceAssets = [...view.sourceAssets, {
    ...view.sourceAssets[0],
    id: ids.proposal,
    kind,
    filename: kind === 'model_glb' ? 'engineering-test-block.glb' : 'Engineering test block (1).STL',
    mimeType: kind === 'model_glb' ? 'model/gltf-binary' : 'model/stl',
    status: 'ready',
    sha256: 'b'.repeat(64),
  }];
  return view;
}

function apiHarness(floorView: ReleaseView = viewFixture()) {
  const requests: ApiTransportRequest[] = [];
  const transport: ApiTransport = {
    async request(request) {
      requests.push(request);
      if (request.method === 'GET' && request.path === '/api/releases/' + ids.release) {
        return { data: floorView, meta };
      }
      if (request.method === 'GET' && request.path.startsWith('/api/flags?')) {
        return { data: [], meta };
      }
      if (request.method === 'POST' && request.path === '/api/questions') {
        return { data: sampleAnswer, meta };
      }
      if (request.method === 'POST' && request.path === '/api/flags') {
        const body = request.body as { context: Flag['context']; question: string; photoAssetIds: string[] };
        const created: Flag = {
          ...openFlag,
          context: body.context,
          question: body.question,
          photoAssetIds: body.photoAssetIds,
        };
        return { data: created, meta };
      }
      throw new Error('Unexpected test API request: ' + request.method + ' ' + request.path);
    },
    async upload() { throw new Error('The test did not request an upload.'); },
  };
  return { client: createApiClient(transport), requests };
}

describe('release-bound factory floor', () => {
  it('opens on the approved operation guide with direct contextual help', async () => {
    const { client } = apiHarness();
    render(<OperatorFloor releaseId={ids.release} client={client} />);
    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Guide' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Ask about this operation' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Flag an issue' })).toBeVisible();
  });

  it.each([
    ['model_glb', 'glb', 'engineering-test-block.glb'],
    ['model_stl', 'stl', 'Engineering test block (1).STL'],
  ] as const)('shows a ready %s private visual model on the default guide', async (kind, format, filename) => {
    const { client } = apiHarness(viewWithReadyModel(kind));
    render(<OperatorFloor releaseId={ids.release} client={client} />);

    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Guide' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: filename })).toBeVisible();
    expect(screen.getByText('Released visual reference')).toBeVisible();
    expect(screen.getByTestId('released-model-viewer')).toHaveAttribute('data-asset-id', ids.proposal);
    expect(screen.getByTestId('released-model-viewer')).toHaveAttribute('data-format', format);
    expect(screen.getByText(`Loaded ${format.toUpperCase()} visual reference`)).toBeVisible();
  });

  it('uses a one-screen model presentation with a release-bound chat composer for the stable QR entry', async () => {
    const { client, requests } = apiHarness(viewWithReadyModel('model_glb'));
    render(<OperatorFloor releaseId={ids.release} client={client} presentation="model" />);

    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.getByText('Current part')).toBeVisible();
    expect(screen.getByTestId('released-model-viewer')).toHaveAttribute('data-format', 'glb');
    expect(screen.getByTestId('released-model-viewer')).toHaveAttribute('data-variant', 'immersive');
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Ask about this part'), { target: { value: 'Which face is the reference side?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));

    expect(await screen.findByText(sampleAnswer.text)).toBeVisible();
    const request = requests.find((item) => item.method === 'POST' && item.path === '/api/questions');
    expect(request?.body).toEqual({
      context: { ...releaseContext, stepId: null, bendId: null },
      question: 'Which face is the reference side?',
    });
  });

  it('asks against the current published bend and shows the returned grounded answer', async () => {
    const { client, requests } = apiHarness();
    render(<OperatorFloor releaseId={ids.release} client={client} />);

    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Ask' }));
    fireEvent.change(screen.getByLabelText("Question for the designer's released information"), {
      target: { value: 'Which face is the reference side?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask this release' }));

    expect(await screen.findByText(sampleAnswer.text)).toBeVisible();
    const request = requests.find((item) => item.method === 'POST' && item.path === '/api/questions');
    expect(request?.body).toEqual({
      context: releaseContext,
      question: 'Which face is the reference side?',
    });
  });

  it('keeps quick assist scoped to the current release and operation, then offers a contextual flag', async () => {
    const { client, requests } = apiHarness();
    render(<OperatorFloor releaseId={ids.release} client={client} />);

    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Quick assist' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Ask Chappe about this operation'), {
      target: { value: 'Which face is the reference side?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask Chappe' }));

    expect(await screen.findByText(sampleAnswer.text)).toBeVisible();
    const questionRequest = requests.find((item) => item.method === 'POST' && item.path === '/api/questions');
    expect(questionRequest?.body).toEqual({
      context: releaseContext,
      question: 'Which face is the reference side?',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Flag this answer' }));
    expect(screen.getByRole('tab', { name: 'Flags' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText("What needs the designer's attention?")).toBeVisible();
  });

  it('creates a release and bend scoped flag through the real typed client boundary', async () => {
    const { client, requests } = apiHarness();
    render(<OperatorFloor releaseId={ids.release} client={client} />);

    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Flags' }));
    fireEvent.change(screen.getByLabelText("What needs the designer's attention?"), {
      target: { value: 'The bend direction on the sheet is unclear.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save flag to release' }));

    expect(await screen.findByText(/Flag saved to the published release\. Engineering will receive a concise Luna draft report/)).toBeVisible();
    const request = requests.find((item) => item.method === 'POST' && item.path === '/api/flags');
    const body = request?.body as { context: Flag['context']; question: string; photoAssetIds: string[] };
    expect(body.context).toEqual(releaseContext);
    expect(body.question).toBe('The bend direction on the sheet is unclear.');
    expect(body.photoAssetIds).toEqual([]);
    expect(request?.headers?.['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('does not turn the default unavailable API into release data', async () => {
    render(<OperatorFloor releaseId={ids.release} />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Release unavailable' })).toBeVisible());
    expect(screen.getByText(/endpoint is not available in the current build/i)).toBeVisible();
  });

  it('offers typed input when browser speech recognition is unavailable', async () => {
    const { client } = apiHarness();
    render(<OperatorFloor releaseId={ids.release} client={client} />);
    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Ask' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speak question' }));
    expect(screen.getByText('Voice input is not available in this browser. Type your question instead.')).toBeVisible();
    expect(screen.getByLabelText("Question for the designer's released information")).toBeEnabled();
  });

  it('keeps a direct operation selector available above the floor tabs', async () => {
    const { client } = apiHarness();
    render(<OperatorFloor releaseId={ids.release} client={client} />);
    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.getByLabelText('Jump to an operation')).toHaveValue('0');
    expect(screen.getByRole('option', { name: /B1/ })).toBeVisible();
  });

  it('does not present legacy steps without a release decision as approved guidance', async () => {
    const legacy = viewFixture();
    for (const step of legacy.release.snapshot.steps) Reflect.deleteProperty(step, 'guidance');
    const { client } = apiHarness(legacy);
    render(<OperatorFloor releaseId={ids.release} client={client} />);
    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.queryByLabelText('Jump to an operation')).not.toBeInTheDocument();
    expect(screen.getByText(/No extra operation guidance was approved/)).toBeVisible();
  });

  it('omits steps the engineer excluded from detailed phone guidance', async () => {
    const excluded = viewFixture();
    excluded.release.snapshot.steps[0].guidance!.decision = 'exclude';
    const { client } = apiHarness(excluded);
    render(<OperatorFloor releaseId={ids.release} client={client} />);
    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    expect(screen.queryByLabelText('Jump to an operation')).not.toBeInTheDocument();
    expect(screen.getByText(/No extra operation guidance was approved/)).toBeVisible();
  });
});
