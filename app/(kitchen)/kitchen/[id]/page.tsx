import KitchenVoiceView from '@/components/kitchen/KitchenVoiceView';

export const metadata = { title: 'المطبخ — نطق الأصناف' };
export const dynamic = 'force-dynamic';

export default function KitchenOrderPage({ params }: { params: { id: string } }) {
  return <KitchenVoiceView orderId={params.id} />;
}
