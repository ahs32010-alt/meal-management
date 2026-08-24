import KitchenOrderPicker from '@/components/kitchen/KitchenOrderPicker';

export const metadata = { title: 'المطبخ — الأوامر الصوتية' };
export const dynamic = 'force-dynamic';

export default function KitchenPage() {
  return <KitchenOrderPicker />;
}
