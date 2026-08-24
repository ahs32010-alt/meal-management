import type { ItemCategory } from '@/lib/types';

/**
 * تسمية ولون كل تصنيف. نسخة محلية عمداً — صفحة الفطور لها نسختها في
 * `components/stickers/sticker-utils.ts`، وفصلهما يضمن أن أي تعديل هنا لا
 * يمسّ تلك الصفحة إطلاقاً.
 */
export const LD_CATEGORY: Record<ItemCategory, { ar: string; en: string; hex: string }> = {
  hot:   { ar: 'حار',  en: 'HOT',   hex: '#DC2626' },
  cold:  { ar: 'بارد', en: 'COLD',  hex: '#0284C7' },
  snack: { ar: 'سناك', en: 'SNACK', hex: '#F59E0B' },
};

/**
 * تخصيصات الوجبة لستيكر واحد داخل أمر تشغيل غداء/عشاء — تُطبع في آخر الستيكر
 * (تبويب «حسب الوجبة») بنفس أسلوب ستيكرات الفطور: محظور/NO ثم بديل/YES.
 *
 * المستفيد الواحد قد يكون له أكثر من ستيكر: واحد لكل تصنيف نشط (حار/بارد/سناك)
 * — نفس آلية فصل ستيكرات الفطور، فيبقى محتوى كل كيس في ستيكره.
 *
 * النوع هنا لا في ملف الكارت، لأن تصدير Word (`ld-word-export.ts`) يستهلكه
 * أيضاً وما ينفع يستورد ملف `.tsx` فيه React.
 */
export interface LdMealCustomization {
  /** اسم الوجبة عربي (غداء/عشاء) */
  mealAr: string;
  /** اسم الوجبة إنجليزي (LUNCH/DINNER) */
  mealEn: string;
  /** تصنيف هذا الستيكر — null حين لا يوجد ما يحدّده (لا تخصيصات أصلاً) */
  category: ItemCategory | null;
  /** الأصناف المحظورة — عربي + النقحرة اللاتينية */
  excluded: { ar: string; en: string }[];
  /** البدائل والأصناف الثابتة — عربي + النقحرة اللاتينية */
  alternatives: { ar: string; en: string }[];
}

export const hasCustomization = (c?: LdMealCustomization | null): boolean =>
  !!c && (c.excluded.length > 0 || c.alternatives.length > 0);
