# Supabase auth session integration

Team 1's Next.js proxy imports `updateSession` from
`@/lib/auth/proxy-session`:

```ts
import { updateSession } from "@/lib/auth/proxy-session";
```

The exported signature is:

```ts
updateSession(request: NextRequest): Promise<NextResponse>
```

It refreshes Supabase SSR cookies and calls `auth.getUser()` to verify the
request session. It does not grant workspace permissions. API handlers must
perform an explicit workspace membership or release-session check after
calling the server auth helper. The public key is safe for SSR; no service role
key is used in the browser or this helper.

Configuration failures are explicit. Supply
`NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` through the runtime environment.
