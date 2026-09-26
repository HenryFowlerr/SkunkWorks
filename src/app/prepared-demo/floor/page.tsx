import type { Metadata } from 'next';
import { PreparedFloorDemo } from '@/features/prepared-demo/prepared-demo';
export const metadata: Metadata = { title: 'Engineering Test Block · Floor chat', robots: { index: false, follow: false } };
export default function PreparedFloorPage() { return <PreparedFloorDemo />; }
