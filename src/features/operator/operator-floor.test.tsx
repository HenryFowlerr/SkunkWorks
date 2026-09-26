import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiTransport, ApiTransportRequest } from '@/lib/api/client';
import { createApiClient } from '@/lib/api/client';
import type { Answer, Flag, ReleaseView } from '@/contracts';
import { ids, openFlag, releaseContext, releaseView } from '../../../tests/contracts/fixtures';
import { OperatorFloor } from './operator-floor';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

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

  it('creates a release and bend scoped flag through the real typed client boundary', async () => {
    const { client, requests } = apiHarness();
    render(<OperatorFloor releaseId={ids.release} client={client} />);

    expect(await screen.findByRole('heading', { name: 'Sample bracket' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Flags' }));
    fireEvent.change(screen.getByLabelText("What needs the designer's attention?"), {
      target: { value: 'The bend direction on the sheet is unclear.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save flag to release' }));

    expect(await screen.findByText('Flag saved to the published release.')).toBeVisible();
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
