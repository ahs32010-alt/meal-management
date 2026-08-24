/**
 * تخصيصات الوجبة لمستفيد واحد داخل أمر تشغيل غداء/عشاء — تُطبع في آخر
 * الستيكر (تبويب «حسب الوجبة») بنفس أسلوب ستيكرات الفطور: محظور/NO ثم بديل/YES.
 *
 * النوع هنا لا في ملف الكارت، لأن تصدير Word (`ld-word-export.ts`) يستهلكه
 * أيضاً وما ينفع يستورد ملف `.tsx` فيه React.
 */
export interface LdMealCustomization {
  /** اسم الوجبة عربي (غداء/عشاء) */
  mealAr: string;
  /** اسم الوجبة إنجليزي (LUNCH/DINNER) */
  mealEn: string;
  /** الأصناف المحظورة — عربي + النقحرة اللاتينية */
  excluded: { ar: string; en: string }[];
  /** البدائل والأصناف الثابتة — عربي + النقحرة اللاتينية */
  alternatives: { ar: string; en: string }[];
}

export const hasCustomization = (c?: LdMealCustomization | null): boolean =>
  !!c && (c.excluded.length > 0 || c.alternatives.length > 0);
