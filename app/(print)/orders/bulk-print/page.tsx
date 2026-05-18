import BulkOrderPrintView from '@/components/orders/BulkOrderPrintView';

export const metadata = { title: 'تصدير أوامر التشغيل' };

interface Props {
  searchParams: { ids?: string };
}

export default function BulkPrintPage({ searchParams }: Props) {
  const ids = (searchParams.ids ?? '').split(',').filter(Boolean);
  return <BulkOrderPrintView orderIds={ids} />;
}
