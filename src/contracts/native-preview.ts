import { z } from 'zod';
export const NativePreviewSchema = z.object({
  mimeType: z.literal('image/png'),
  imageBase64: z.string().min(1).max(2_800_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  label: z.string().min(1),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
}).strict();
export type NativePreview = z.infer<typeof NativePreviewSchema>;
