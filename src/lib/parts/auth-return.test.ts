import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/auth/sign-up/route';
import { ids } from '../../../tests/contracts/fixtures';

const signup = vi.hoisted(() => vi.fn(async () => ({ data: { session: null }, error: null })));
vi.mock('@/lib/auth/server', () => ({ createSupabaseServerClient: async () => ({ auth: { signUp: signup } }) }));
afterEach(() => signup.mockClear());

describe('part sign-up callback', () => {
  it.each([
    [`/parts/${ids.job}`, `/parts/${ids.job}`],
    ['/parts/not-a-uuid', '/studio'],
    [`/parts/${ids.job}/extra`, '/studio'],
  ])('uses a safe callback for %s', async (returnPath, expected) => {
    const response = await POST(new Request('https://chappe.example/api/auth/sign-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://chappe.example' },
      body: JSON.stringify({ email: 'floor@example.test', password: 'long-enough-password', returnPath }),
    }));
    expect(response.status).toBe(200);
    expect(signup).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: `https://chappe.example/auth/callback?next=${encodeURIComponent(expected)}` }) }));
  });
});
