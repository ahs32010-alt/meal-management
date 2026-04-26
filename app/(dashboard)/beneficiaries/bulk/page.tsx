import BulkCustomization from '@/components/beneficiaries/BulkCustomization';

export const metadata = { title: 'تخصيص جماعي — المستفيدون - مركز خطوة أمل' };

export default function BeneficiariesBulkPage() {
  return <BulkCustomization entityType="beneficiary" />;
}
