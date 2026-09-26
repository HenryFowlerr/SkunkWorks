import { IdSchema } from '@/contracts';

/** A job is the demo's stable part identity. Never encode a release or access token. */
export function partPath(jobId: string): string {
  return `/parts/${IdSchema.parse(jobId)}`;
}

export function isPartPath(path: string): boolean {
  const match = /^\/parts\/([^/?#]+)$/.exec(path);
  return match !== null && IdSchema.safeParse(match[1]).success;
}
