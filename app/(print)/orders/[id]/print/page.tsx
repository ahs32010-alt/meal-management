import OrderPrintView from '@/components/orders/OrderPrintView';

export const metadata = { title: 'تصدير أمر التشغيل' };

interface Props {
  params: { id: string };
}

export default function PrintPage({ params }: Props) {
  return <OrderPrintView orderId={params.id} />;
}
