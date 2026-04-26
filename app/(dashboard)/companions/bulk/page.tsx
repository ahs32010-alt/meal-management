import BulkCustomization from '@/components/beneficiaries/BulkCustomization';

export const metadata = { title: 'تخصيص جماعي — المرافقون - مركز خطوة أمل' };

export default function CompanionsBulkPage() {
  return <BulkCustomization entityType="companion" />;
}
