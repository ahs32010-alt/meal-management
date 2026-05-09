import PeriodPrintView from '@/components/reports/PeriodPrintView';
import type { MealType, EntityType } from '@/lib/types';

export const metadata = { title: 'تصدير تقرير الفترة الزمنية' };

interface Props {
  searchParams: { s?: string; meal?: string; entity?: string };
}

export default function PeriodPrintPage({ searchParams }: Props) {
  return (
    <PeriodPrintView
      selectionsParam={searchParams.s || '{}'}
      mealType={searchParams.meal as MealType | undefined}
      entityType={searchParams.entity as EntityType | undefined}
    />
  );
}
