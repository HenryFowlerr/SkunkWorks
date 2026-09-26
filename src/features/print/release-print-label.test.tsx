import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiTransport, ApiTransportRequest } from '@/lib/api/client';
import { createApiClient } from '@/lib/api/client';
import { ids, releaseView, sourceAsset } from '../../../tests/contracts/fixtures';
import { ReleasePrintLabel } from './release-print-label';

const qr = vi.hoisted(() => ({ toDataURL: vi.fn(async (value: string) => `data:image/png;base64,${btoa(value)}`) }));
vi.mock('qrcode', () => ({ default: qr }));

afterEach(() => cleanup());

const meta = { requestId: 'print-test', contractVersion: '1.0' as const };
const partUrl = new URL(`/parts/${ids.job}`, window.location.origin).toString();

function apiHarness(view = releaseView) {
  const requests: ApiTransportRequest[] = [];
  const transport: ApiTransport = {
    async request(request) {
      requests.push(request);
      if (request.method === 'GET' && request.path === `/api/releases/${ids.release}`) return { data: view, meta };
      if (request.method === 'GET' && request.path === `/api/assets/${ids.asset}/link`) {
        return { data: { url: 'https://storage.example.test/drawing.pdf?authorized=source', expiresAt: '2026-09-27T00:00:00Z' }, meta };
      }
      throw new Error(`Unexpected print API request: ${request.method} ${request.path}`);
    },
    async upload() { throw new Error('The print label should not upload files.'); },
  };
  return { client: createApiClient(transport), requests };
}

describe('release print label', () => {
  it('prints a stable part QR without issuing an access token or share link', async () => {
    qr.toDataURL.mockClear();
    const { client, requests } = apiHarness();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<ReleasePrintLabel releaseId={ids.release} client={client} />);

    expect(await screen.findByAltText(/QR code for part BR-100 knowledge base/i)).toBeVisible();
    expect(qr.toDataURL).toHaveBeenCalledTimes(1);
    expect(qr.toDataURL).toHaveBeenCalledWith(partUrl, expect.objectContaining({ errorCorrectionLevel: 'M' }));
    expect(requests.some((request) => request.method === 'GET' && request.path === `/api/releases/${ids.release}`)).toBe(true);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
    expect(requests.some((request) => request.method === 'GET' && request.path === `/api/assets/${ids.asset}/link`)).toBe(true);
    expect(screen.getByRole('heading', { name: 'BR-100' })).toBeVisible();
    expect(screen.getByText('Guide at printing')).toBeVisible();
    expect(screen.getByText('Workspace sign-in required')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open sample-bracket.pdf' })).toHaveAttribute('href', 'https://storage.example.test/drawing.pdf?authorized=source');
    fireEvent.click(screen.getByRole('button', { name: 'Print label' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('does not generate a QR or expose sources when authorized loading fails', async () => {
    qr.toDataURL.mockClear();
    render(<ReleasePrintLabel releaseId={ids.release} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/endpoint is not available/i);
    expect(screen.queryByRole('img', { name: /QR code/i })).not.toBeInTheDocument();
    expect(qr.toDataURL).not.toHaveBeenCalled();
  });

  it('does not require a CAD revision to generate the stable part label', async () => {
    qr.toDataURL.mockClear();
    const noRevisionView = {
      ...structuredClone(releaseView),
      sourceAssets: [{ ...structuredClone(sourceAsset), drawingRevision: null }],
    };
    const { client } = apiHarness(noRevisionView);
    render(<ReleasePrintLabel releaseId={ids.release} client={client} />);
    expect(await screen.findByAltText(/QR code for part BR-100 knowledge base/i)).toBeVisible();
    expect(screen.queryByText('Drawing revision')).not.toBeInTheDocument();
    expect(qr.toDataURL).toHaveBeenCalledWith(partUrl, expect.any(Object));
  });

  it('keeps the QR actions and issued-address disclosure reachable by keyboard', async () => {
    const { client } = apiHarness();
    render(<ReleasePrintLabel releaseId={ids.release} client={client} />);
    expect(await screen.findByAltText(/QR code for part BR-100 knowledge base/i)).toBeVisible();

    const printLabel = screen.getByRole('button', { name: 'Print label' });
    const showAddress = screen.getByText('Show stable part address');
    expect(showAddress.tagName).toBe('SUMMARY');

    printLabel.focus();
    expect(document.activeElement).toBe(printLabel);
    showAddress.focus();
    expect(document.activeElement).toBe(showAddress);
  });
  it('keeps the address unchanged when another approved guide is printed', async () => {
    qr.toDataURL.mockClear();
    const first = apiHarness();
    const mounted = render(<ReleasePrintLabel releaseId={ids.release} client={first.client} />);
    await screen.findByAltText(/QR code for part BR-100 knowledge base/i);
    const updated = { ...structuredClone(releaseView), release: { ...structuredClone(releaseView.release), revisionNumber: 2 } };
    const second = apiHarness(updated);
    mounted.rerender(<ReleasePrintLabel releaseId={ids.release} client={second.client} />);
    await screen.findByText('#2');
    expect(qr.toDataURL.mock.calls.map(([url]) => url)).toEqual([partUrl, partUrl]);
  });

  it('rejects a release for another part before fetching sources or generating a QR', async () => {
    qr.toDataURL.mockClear();
    const { client, requests } = apiHarness();
    render(<ReleasePrintLabel jobId={ids.asset} releaseId={ids.release} client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('does not belong to the requested part');
    expect(requests).toHaveLength(1);
    expect(qr.toDataURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /Open sample/ })).not.toBeInTheDocument();
  });

});
