import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { ids } from '../../../tests/contracts/fixtures';
import { PartQr } from './part-qr';
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cG5n') } }));
afterEach(cleanup);
describe('part identity QR before approval', () => {
  it('uses only the stable part URL and explains access without requiring a release', async () => {
    render(<PartQr jobId={ids.job} />);
    await screen.findByAltText('Stable part QR code');
    expect(QRCode.toDataURL).toHaveBeenCalledWith(new URL(`/parts/${ids.job}`, window.location.origin).toString(), expect.anything());
    expect(screen.getByText(/sign in with workspace access/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open part knowledge base', hidden: true })).toHaveAttribute('href', `/parts/${ids.job}`);
  });
});
