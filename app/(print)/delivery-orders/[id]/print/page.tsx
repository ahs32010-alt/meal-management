import DeliveryOrderPrintView from '@/components/delivery-orders/DeliveryOrderPrintView';

export const metadata = { title: 'أمر تسليم — طباعة' };

interface Props {
  params: { id: string };
}

export default function DeliveryOrderPrintPage({ params }: Props) {
  return <DeliveryOrderPrintView deliveryOrderId={params.id} />;
}
