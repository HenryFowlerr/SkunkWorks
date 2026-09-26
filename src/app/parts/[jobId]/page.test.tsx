import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ids } from '../../../../tests/contracts/fixtures';
import PartPage from './page';

const entry = vi.hoisted(() => ({ resolve: vi.fn(), redirect: vi.fn(() => { throw new Error('redirect'); }) }));
vi.mock('@/server/parts/entry', () => ({ resolvePartEntry: entry.resolve }));
vi.mock('next/navigation', () => ({ redirect: entry.redirect }));
vi.mock('@/features/operator/operator-floor', () => ({ OperatorFloor: ({ releaseId }: { releaseId: string }) => <div data-testid="floor">{releaseId}</div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('part QR page', () => {
  it('keeps the part URL while showing the selected approved guide', async () => {
    entry.resolve.mockResolvedValue({ state: 'ready', releaseId: ids.release });
    render(await PartPage({ params: Promise.resolve({ jobId: ids.job }) }));
    expect(screen.getByTestId('floor')).toHaveTextContent(ids.release);
    expect(entry.redirect).not.toHaveBeenCalled();
  });

  it('preserves the QR destination at the sign-in boundary', async () => {
    entry.resolve.mockResolvedValue({ state: 'sign-in' });
    await expect(PartPage({ params: Promise.resolve({ jobId: ids.job }) })).rejects.toThrow('redirect');
    expect(entry.redirect).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent(`/parts/${ids.job}`)}`);
  });

  it('shows a useful approval-pending state without rendering draft content', async () => {
    entry.resolve.mockResolvedValue({ state: 'unpublished' });
    render(await PartPage({ params: Promise.resolve({ jobId: ids.job }) }));
    expect(screen.getByRole('heading')).toHaveTextContent('Engineering has not approved a guide yet');
    expect(screen.queryByTestId('floor')).not.toBeInTheDocument();
  });
});
