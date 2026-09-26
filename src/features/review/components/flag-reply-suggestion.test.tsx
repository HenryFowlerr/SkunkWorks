import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient, type ApiTransport } from '@/lib/api/client';
import { ids, openFlag, releaseContext } from '../../../../tests/contracts/fixtures';
import { FlagReplySuggestionControl } from './flag-reply-suggestion';
afterEach(cleanup);
describe('engineer suggestion approval boundary', () => {
  it('automatically prepares one report draft with citations when an open floor flag reaches engineering', async () => {
    const request = vi.fn(async () => ({ data: { flagId: ids.flag, flagVersion: 1, approvalState: 'draft', promptVersion: 'engineer-reply.v1',
      answer: { id: ids.flag, context: releaseContext, evidenceState: 'supported', text: 'Confirm the marked orientation.',
        evidence: [{ kind: 'document', assetId: ids.asset, page: 1, region: null, excerpt: 'Use marked orientation.' }], suggestedFlag: null } },
      meta: { requestId: 'test', contractVersion: '1.0' } }));
    const client = createApiClient({ request, upload: vi.fn() } as ApiTransport);
    const onUse = vi.fn();
    render(<FlagReplySuggestionControl flag={openFlag} client={client} onUse={onUse} />);
    await screen.findByText('Luna report draft · engineer review required');
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByText(openFlag.question)).toBeInTheDocument();
    expect(screen.getByText(/Drawing page 1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use suggested reply in editor' }));
    expect(onUse).toHaveBeenCalledWith('Confirm the marked orientation.');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: `/api/jobs/${ids.job}/flags/suggest` }));
  });
  it('shows provider errors with no fabricated suggestion', async () => {
    const client = createApiClient({ request: async () => ({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'AI provider credentials are not configured.', retryable: false }, meta: { requestId: 'test', contractVersion: '1.0' } }), upload: vi.fn() });
    render(<FlagReplySuggestionControl flag={openFlag} client={client} onUse={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('AI provider credentials are not configured.');
    expect(screen.queryByRole('button', { name: 'Use suggested reply in editor' })).not.toBeInTheDocument();
  });
});
