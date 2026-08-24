import type { BeneficiaryReportDetail, ItemCategory, Meal } from '@/lib/types';
import { CATEGORY_ORDER } from '@/lib/types';

/** ستيكر واحد: أصناف تصنيف واحد. `category = null` يعني «لا شيء يحدّد التصنيف». */
export interface LdStickerGroup {
  category: ItemCategory | null;
  excluded: { meal: Meal; alternative: Meal | null }[];
  fixed: { meal: Meal }[];
}

/**
 * يفصل تخصيصات مستفيد واحد إلى ستيكرات حسب التصنيف — **نفس آلية ستيكرات
 * الفطور بالضبط** (انظر `displayDetails` في `components/stickers/StickersView.tsx`):
 *
 *   • اتحاد التصنيفات يُبنى من المحظورات **والأصناف الثابتة** معاً، فالصنف
 *     الثابت يقود ستيكراً مثل المحظور تماماً — وإلا اختلط سناك ثابت بكيس حار.
 *   • بلا تصنيف نشط  → ستيكر واحد بلا وسم.
 *   • تصنيف واحد     → ستيكر واحد موسوم به.
 *   • أكثر من تصنيف  → ستيكر لكل تصنيف بترتيب حار ← بارد ← سناك.
 *   • البديل يركب مع الصنف المحظور الذي حلّ محلّه، لا مع تصنيفه هو: بديل بارد
 *     لصنف حار يبقى في كيس الحار، لأن الكيس يُبنى على ما يُستبدل لا على البديل.
 *
 * دالة نقيّة بلا React — لتُختبر وحدها ويبقى المكوّن عرضاً فقط.
 */
export function splitDetailByCategory(detail: BeneficiaryReportDetail): LdStickerGroup[] {
  const exItems = (detail.excludedItems ?? []).filter(i => i.meal?.name?.trim());
  const fxItems = (detail.fixedItems ?? []).filter(f => f.meal?.name?.trim());

  const build = (category: ItemCategory | null): LdStickerGroup => {
    const ex = category ? exItems.filter(i => i.category === category) : exItems;
    const fx = category ? fxItems.filter(f => f.category === category) : fxItems;
    return {
      category,
      excluded: ex.map(i => ({ meal: i.meal, alternative: i.alternative ?? null })),
      fixed: fx.map(f => ({ meal: f.meal })),
    };
  };

  const active = new Set<ItemCategory>([
    ...exItems.map(i => i.category),
    ...fxItems.map(f => f.category),
  ]);

  if (active.size === 0) return [build(null)];
  if (active.size === 1) return [build([...active][0])];
  return CATEGORY_ORDER.filter(c => active.has(c)).map(c => build(c));
}
