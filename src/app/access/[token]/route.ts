import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/server/auth/service-client';
import { createVisitorSessionToken, hashReleaseToken, TOKEN_PATTERN, VISITOR_COOKIE } from '@/server/auth/release-token';

/** Exchange a printed QR bearer for a scoped HttpOnly session, then remove it from the URL. */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await context.params;
  if (!TOKEN_PATTERN.test(token)) return Response.json({ error: 'This release link is invalid.' }, { status: 404, headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  const sessionToken = createVisitorSessionToken();
  const { data, error } = await createSupabaseServiceClient().rpc('exchange_release_access_link_internal', {
    p_token_hash: hashReleaseToken(token),
    p_session_hash: hashReleaseToken(sessionToken),
  });
  if (error || !data || typeof data.releaseId !== 'string') {
    const revoked = error?.message?.includes('RELEASE_REVOKED');
    const missing = error?.code === 'P0002' || error?.message?.includes('NOT_FOUND');
    return Response.json({ error: revoked ? 'This release link has been revoked.' : missing ? 'This release link is unavailable.' : 'Release access is temporarily unavailable.' }, {
      status: revoked ? 410 : missing ? 404 : 503,
      headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  }
  const location = new URL(`/floor/${data.releaseId}`, request.url);
  const response = NextResponse.redirect(location, { status: 303 });
  response.cookies.set(VISITOR_COOKIE, sessionToken, {
    httpOnly: true,
    secure: location.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60,
  });
  response.headers.set('cache-control', 'no-store');
  response.headers.set('referrer-policy', 'no-referrer');
  return response;
}
