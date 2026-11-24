import type { SupabaseClient } from '@supabase/supabase-js';
import type { Meal } from '@/lib/types';

/**
 * «الحالات الغذائية» للصنف (meal-textures-migration.sql) — منطق مشترك بين
 * نافذة الصنف واستيراد ملف الأصناف.
 *
 * الحالة = صف في meals: texture_of = الأصل، texture_name، texture_diet_id.
 * الاسم والخصائص والربط بالنظام تكتبها القاعدة (triggers).
 */

export interface TextureSpec {
  /** اسم الحالة: مهروس / خلاط … */
  name: string;
  /** اسم النظام الغذائي المربوط — null = بدون نظام */
  diet: string | null;
}

const clean = (v: string) => v.replace(/\s+/g, ' ').trim();

/** «مهروس = شبه المهروس، خلاط» ← للخانة في ملف الأصناف */
export function formatTextures(list: TextureSpec[] | undefined | null): string {
  return (list ?? []).map(t => (t.diet ? `${t.name} = ${t.diet}` : t.name)).join('، ');
}

/**
 * يقرأ خانة الحالات: فواصل الحالات «، , ؛ ; سطر جديد»، وبين الحالة ونظامها «=».
 * يرجع خطأ عربي لو فيه حالة بلا اسم أو مكررة.
 */
export function parseTextures(raw: string | undefined | null): { textures: TextureSpec[]; error: string | null } {
  const text = String(raw ?? '').trim();
  if (!text) return { textures: [], error: null };
  const out: TextureSpec[] = [];
  for (const part of text.split(/[،,؛;\n]+/)) {
    if (!part.trim()) continue;
    const eq = part.indexOf('=');
    const name = clean(eq >= 0 ? part.slice(0, eq) : part);
    const diet = eq >= 0 ? clean(part.slice(eq + 1)) : '';
    if (!name) return { textures: [], error: `حالة بلا اسم في «${part.trim()}»` };
    if (out.some(t => t.name === name)) return { textures: [], error: `الحالة «${name}» مكررة` };
    out.push({ name, diet: diet || null });
  }
  return { textures: out, error: null };
}

export const textureMealName = (parentName: string, textureName: string) => `${parentName} (${textureName})`;

/**
 * يضيف حالة لصنف، أو يحدّث نظامها لو موجودة بنفس الاسم.
 * لو فيه صنف قديم مسوّى يدوياً بنفس الاسم («فول (مهروس)») يتبنّاه بدل ما
 * يسوي نسخة ثانية — فكل محظور/ثابت مربوط فيه يبقى شغّال.
 */
export async function saveMealTexture(
  supabase: SupabaseClient,
  parent: Pick<Meal, 'id' | 'name' | 'type' | 'is_snack' | 'entity_type'>,
  textureName: string,
  dietId: string | null,
): Promise<{ id: string | null; created: boolean; error: string | null }> {
  const tex = clean(textureName);
  const payload = { texture_of: parent.id, texture_name: tex, texture_diet_id: dietId };

  // حالة موجودة بنفس الاسم لهذا الصنف → تحديث النظام فقط
  const { data: mine, error: mineErr } = await supabase.from('meals')
    .select('id, texture_name, texture_diet_id').eq('texture_of', parent.id);
  if (mineErr) return { id: null, created: false, error: mineErr.message };
  const same = ((mine ?? []) as { id: string; texture_name: string; texture_diet_id: string | null }[])
    .find(r => clean(r.texture_name) === tex);
  if (same) {
    if (same.texture_diet_id === dietId) return { id: same.id, created: false, error: null };
    const { error } = await supabase.from('meals').update({ texture_diet_id: dietId }).eq('id', same.id);
    return { id: same.id, created: false, error: error?.message ?? null };
  }

  const variantName = textureMealName(parent.name, tex);
  let q = supabase.from('meals').select('id, texture_of')
    .eq('name', variantName).eq('type', parent.type).eq('is_snack', parent.is_snack);
  if (parent.entity_type) q = q.eq('entity_type', parent.entity_type);
  const { data: existing } = await q.limit(1);
  const adopt = ((existing ?? []) as { id: string; texture_of: string | null }[])[0];

  if (adopt && !adopt.texture_of) {
    const { error } = await supabase.from('meals').update(payload).eq('id', adopt.id);
    return { id: adopt.id, created: false, error: error?.message ?? null };
  }

  // الاسم والنوع تعيد القاعدة كتابتها من الأصل — نرسلها فقط لقيود NOT NULL
  const { data, error } = await supabase.from('meals').insert({
    ...payload,
    name: variantName,
    type: parent.type,
    is_snack: parent.is_snack,
    ...(parent.entity_type ? { entity_type: parent.entity_type } : {}),
  }).select('id').single();
  return { id: (data as { id: string } | null)?.id ?? null, created: true, error: error?.message ?? null };
}
