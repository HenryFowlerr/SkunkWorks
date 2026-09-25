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
const issuedUrl = 'https://factory.example.test/access/issued-secret-token?scope=release';

function apiHarness(view = releaseView) {
  const requests: ApiTransportRequest[] = [];
  const transport: ApiTransport = {
    async request(request) {
      requests.push(request);
      if (request.method === 'GET' && request.path === `/api/releases/${ids.release}`) return { data: view, meta };
      if (request.method === 'GET' && request.path === `/api/assets/${ids.asset}/link`) {
        return { data: { url: 'https://storage.example.test/drawing.pdf?authorized=source', expiresAt: '2026-09-27T00:00:00Z' }, meta };
      }
      if (request.method === 'POST' && request.path === `/api/releases/${ids.release}/share-links`) return { data: { linkId: ids.flag, accessUrl: issuedUrl }, meta };
      throw new Error(`Unexpected print API request: ${request.method} ${request.path}`);
    },
    async upload() { throw new Error('The print label should not upload files.'); },
  };
  return { client: createApiClient(transport), requests };
}

describe('release print label', () => {
  it('creates the QR only from the issued share URL and prints release/source details', async () => {
    qr.toDataURL.mockClear();
    const { client, requests } = apiHarness();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<ReleasePrintLabel releaseId={ids.release} client={client} />);

    expect(await screen.findByAltText(/authorized factory access to release 1/i)).toBeVisible();
    expect(qr.toDataURL).toHaveBeenCalledTimes(1);
    expect(qr.toDataURL).toHaveBeenCalledWith(issuedUrl, expect.objectContaining({ errorCorrectionLevel: 'M' }));
    expect(requests.some((request) => request.method === 'GET' && request.path === `/api/releases/${ids.release}`)).toBe(true);
    expect(requests.some((request) => request.method === 'POST' && request.path === `/api/releases/${ids.release}/share-links`)).toBe(true);
    expect(requests.some((request) => request.method === 'GET' && request.path === `/api/assets/${ids.asset}/link`)).toBe(true);
    expect(screen.getByRole('heading', { name: 'BR-100' })).toBeVisible();
    expect(screen.getByText('A')).toBeVisible();
    expect(screen.getByText('App release')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open sample-bracket.pdf' })).toHaveAttribute('href', 'https://storage.example.test/drawing.pdf?authorized=source');
    fireEvent.click(screen.getByRole('button', { name: 'Print label' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('says when the revision is unprovided and does not invent a QR when the API is unavailable', async () => {
    qr.toDataURL.mockClear();
    render(<ReleasePrintLabel releaseId={ids.release} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/endpoint is not available/i);
    expect(screen.queryByRole('img', { name: /QR code/i })).not.toBeInTheDocument();
    expect(qr.toDataURL).not.toHaveBeenCalled();
  });

  it('prints the revision as unprovided when the released drawing has no revision value', async () => {
    qr.toDataURL.mockClear();
    const noRevisionView = {
      ...structuredClone(releaseView),
      sourceAssets: [{ ...structuredClone(sourceAsset), drawingRevision: null }],
    };
    const { client } = apiHarness(noRevisionView);
    render(<ReleasePrintLabel releaseId={ids.release} client={client} />);
    expect(await screen.findByAltText(/authorized factory access to release 1/i)).toBeVisible();
    expect(screen.getAllByText('Not provided')).toHaveLength(1);
    expect(screen.getByText('Drawing revision not provided')).toBeVisible();
  });

  it('keeps the QR actions and issued-address disclosure reachable by keyboard', async () => {
    const { client } = apiHarness();
    render(<ReleasePrintLabel releaseId={ids.release} client={client} />);
    expect(await screen.findByAltText(/authorized factory access to release 1/i)).toBeVisible();

    const issueLink = screen.getByRole('button', { name: 'Issue a new QR link' });
    const printLabel = screen.getByRole('button', { name: 'Print label' });
    const showAddress = screen.getByText('Show issued access address');
    expect(showAddress.tagName).toBe('SUMMARY');

    issueLink.focus();
    expect(document.activeElement).toBe(issueLink);
    printLabel.focus();
    expect(document.activeElement).toBe(printLabel);
    showAddress.focus();
    expect(document.activeElement).toBe(showAddress);
  });
});
