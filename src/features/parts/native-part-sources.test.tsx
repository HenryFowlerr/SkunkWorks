import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '@/lib/api/client';
import { sourceAsset } from '../../../tests/contracts/fixtures';
import { NativePartSources } from './native-part-sources';
afterEach(cleanup);
describe('native source previews', () => {
  it('loads a private cached image and preserves the limitation label', async () => {
    const request = vi.fn(async () => ({ data: { mimeType: 'image/png', imageBase64: 'cG5n', width: 640, height: 480, label: 'Cached model preview · not verified manufacturing evidence' }, meta: { requestId: 'test', contractVersion: '1.0' } }));
    render(<NativePartSources assets={[{ ...sourceAsset, kind: 'native_part', filename: 'Engineering test block.SLDPRT' }]} client={createApiClient({ request, upload: vi.fn() })} />);
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'data:image/png;base64,cG5n');
    expect(screen.getByText(/The model image cannot be rotated/)).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: `/api/assets/${sourceAsset.id}/preview` }));
  });
  it('never tries to preview unverified source bytes', () => {
    const request = vi.fn();
    render(<NativePartSources assets={[{ ...sourceAsset, kind: 'native_drawing', status: 'pending', sha256: null }]} client={createApiClient({ request, upload: vi.fn() })} />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
