/**
 * توحيد أسماء الأنظمة الغذائية.
 *
 * المشكلة: `diet_type` نص حر، فيدخل الاسم نفسه بإملاءات مختلفة («حمية» و«حميه»)
 * فيتفرّق المستفيدون على مجموعتين، وتتضاعف صفوف الألوان في ستيكرات الغداء
 * والعشاء لأنها مفهرسة بالنص حرفياً.
 *
 * الحل هنا: مفتاح مقارنة موحّد يجمع الإملاءات المتكافئة، وقائمة أسماء نظيفة
 * تُبنى من البيانات الموجودة نفسها — بلا جدول جديد ولا migration ولا اختراع
 * مسمّيات من عندنا.
 *
 * دالّتان نقيّتان لا تعرفان قاعدة البيانات، فتُختبران بالكامل.
 */

// التشكيل U+064B–U+065F والألف الخنجرية U+0670 — بالهروب الصريح حتى لا يبتلع
// النطاق المكتوب حرفياً الأرقامَ العربية-الهندية.
const TASHKEEL = new RegExp('[\\u064B-\\u065F\\u0670]', 'g');
const TATWEEL = new RegExp('\\u0640', 'g');

/**
 * مفتاح المقارنة: نظامان يتشاركانه هما نفس النظام مهما اختلف الإملاء.
 * يوحّد الألف والياء والتاء المربوطة والهمزات، ويسقط التشكيل والترقيم.
 */
export function normalizeDietKey(input: string | null | undefined): string {
  if (!input) return '';
  const cleaned = input
    .normalize('NFKC')
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ء/g, '')
    .replace(/[^ء-يa-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // «قليل الملح» و«قليل ملح» نظام واحد — نسقط «ال» التعريف من كل كلمة،
  // بشرط أن يبقى بعدها ٣ أحرف فأكثر حتى لا نمسخ الكلمات القصيرة.
  return cleaned
    .split(' ')
    .map((w) => (w.length >= 5 && w.startsWith('ال') ? w.slice(2) : w))
    .join(' ');
}

/** هل الاسمان نظام غذائي واحد؟ */
export function isSameDiet(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = normalizeDietKey(a);
  return ka !== '' && ka === normalizeDietKey(b);
}

/**
 * يبني قائمة أسماء نظيفة من القيم المسجَّلة.
 *
 * لكل مجموعة إملاءات متكافئة نختار **الأكثر تكراراً** ممثّلاً لها (وعند
 * التساوي: الأطول ثم الأسبق أبجدياً) — فيبقى الاسم الشائع في النظام هو
 * المعروض، ولا نفرض إملاءً من عندنا.
 */
export function canonicalDietList(values: Array<string | null | undefined>): string[] {
  const groups = new Map<string, Map<string, number>>();

  for (const raw of values) {
    const label = (raw ?? '').trim();
    if (!label) continue;
    const key = normalizeDietKey(label);
    if (!key) continue;
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(label, (spellings.get(label) ?? 0) + 1);
    groups.set(key, spellings);
  }

  const picked: string[] = [];
  for (const spellings of groups.values()) {
    let best = '';
    let bestCount = -1;
    for (const [label, count] of spellings) {
      if (
        count > bestCount ||
        (count === bestCount && label.length > best.length) ||
        (count === bestCount && label.length === best.length && label.localeCompare(best, 'ar') < 0)
      ) {
        best = label;
        bestCount = count;
      }
    }
    picked.push(best);
  }

  return picked.sort((a, b) => a.localeCompare(b, 'ar'));
}

/**
 * يطابق اسماً مُدخَلاً على القائمة الموجودة.
 * يرجّع الاسم الموحّد إن كان مكافئاً لواحد منها، وإلا يرجّع المُدخَل منظّفاً —
 * وهذي هي النقطة التي تمنع تولّد نسخة جديدة من نظام موجود.
 */
export function matchDiet(input: string, existing: string[]): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const key = normalizeDietKey(trimmed);
  return existing.find((e) => normalizeDietKey(e) === key) ?? trimmed;
}
