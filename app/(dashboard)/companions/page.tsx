import BeneficiaryList from '@/components/beneficiaries/BeneficiaryList';

export const metadata = { title: 'المرافقون - مركز خطوة أمل' };

export default function CompanionsPage() {
  return <BeneficiaryList entityType="companion" />;
}
