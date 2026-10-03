import type { PostgrestError } from '@supabase/supabase-js';

/**
 * سقف Supabase/PostgREST الافتراضي لعدد الصفوف في الاستعلام الواحد.
 * أي استعلام يتجاوزه يرجع مقصوصاً **بدون أي خطأ** — وهذا كان سبب اختلاف
 * الأعداد بين صفحة قائمة الطعام/إنشاء أمر التشغيل وبين تقرير أمر التشغيل:
 * جدول exclusions تعدّى ١٠٠٠ صف، فالصفحات اللي تقرأه كاملاً كانت تشوف جزءاً
 * منه فقط → محظورات ناقصة → أعداد مضخّمة.
 */
export const PAGE_SIZE = 1000;

/**
 * يقرأ كل صفوف استعلام على دفعات ويجمعها، ويرجّع نفس شكل نتيجة supabase
 * ({ data, error }) عشان يبقى منطق الـfallback عند الأعمدة الناقصة كما هو.
 *
 * مهم: لازم الاستعلام يكون مُرتَّباً بعمود ثابت (id مثلاً) وإلا قد تتكرر أو
 * تُفقد صفوف بين الدفعات.
 *
 * @example
 * const res = await fetchAllRows<Row>((from, to) =>
 *   supabase.from('exclusions').select(cols).order('id').range(from, to));
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  pageSize: number = PAGE_SIZE,
): Promise<{ data: T[] | null; error: PostgrestError | null }> {
  // الدفعة الأولى وحدها — أغلب الجداول تنتهي فيها.
  const first = await page(0, pageSize - 1);
  if (first.error) return { data: null, error: first.error };
  const all: T[] = [...(first.data ?? [])];
  if (all.length < pageSize) return { data: all, error: null };

  // ما بعدها على موجات متوازية بدل رحلة شبكة بعد رحلة: كل رحلة ~٤٠٠ms، فجدول
  // من ٥ آلاف صف كان ينتظر ٥ رحلات متتالية. الترتيب محفوظ لأننا نجمع النتائج
  // بترتيب الإزاحة، والموجة تتوقف عند أول دفعة ناقصة.
  const WAVE = 4;
  for (let from = pageSize; ; from += pageSize * WAVE) {
    const wave = await Promise.all(
      Array.from({ length: WAVE }, (_, i) => {
        const start = from + i * pageSize;
        return page(start, start + pageSize - 1);
      }),
    );
    for (const { data, error } of wave) {
      // نرجّع الخطأ بنفس شكله (data = null) عشان المستدعي يقدر يجرّب استعلاماً
      // بديلاً عند نقص عمود اختياري.
      if (error) return { data: null, error };
      const rows = data ?? [];
      all.push(...rows);
      // دفعة ناقصة = وصلنا النهاية
      if (rows.length < pageSize) return { data: all, error: null };
    }
  }
}
