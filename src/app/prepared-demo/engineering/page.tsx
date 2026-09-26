import type { Metadata } from 'next';
import { PreparedEngineeringDemo } from '@/features/prepared-demo/prepared-demo';
export const metadata: Metadata = { title: 'Engineering Test Block · Engineer desk', robots: { index: false, follow: false } };
export default function PreparedEngineeringPage() { return <PreparedEngineeringDemo />; }
