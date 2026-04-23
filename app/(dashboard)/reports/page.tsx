import ReportView from '@/components/reports/ReportView';

export const metadata = { title: 'التقارير - نظام إدارة الوجبات' };

interface Props {
  searchParams: { orderId?: string };
}

export default function ReportsPage({ searchParams }: Props) {
  return <ReportView initialOrderId={searchParams.orderId} />;
}
