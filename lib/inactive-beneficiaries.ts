import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * يرجّع مجموعة معرّفات المستفيدين/المرافقين المعطّلين مؤقتاً (is_active = false).
 * هؤلاء يجب استبعادهم من أوامر التشغيل والستيكرات والتقارير.
 *
 * آمن قبل تشغيل الـmigration: لو عمود is_active غير موجود يرجّع مجموعة فارغة
 * (نعتبر الجميع مفعّلين).
 */
export async function fetchInactiveBeneficiaryIds(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('beneficiaries')
      .select('id')
      .eq('is_active', false);
    if (error || !data) return new Set();
    return new Set((data as { id: string }[]).map(r => r.id));
  } catch {
    return new Set();
  }
}
