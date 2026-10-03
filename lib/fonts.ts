/**
 * خط التطبيق الموحّد: ثمانية سانس (thmanyah sans).
 *
 * مصدر واحد لاسم الخط في كل مكان — الواجهة، صفحات الطباعة، ملفات PDF،
 * و Word/Excel — فلا يرجع أي جزء لخط قديم عند تغيير الخط مستقبلاً.
 *
 * ⚠️ الترخيص: ملفات الخط في app/fonts وتُضمَّن عبر next/font داخل البناء.
 * لا تنقلها إلى public/ ولا تضمّنها base64 داخل ملفات مُصدَّرة — الترخيص
 * يمنع إتاحة الخط كملف قابل للتنزيل أو الاستخراج.
 */

/** اسم عائلة الخط كما هو مسجّل داخل ملفاته — تستعمله البرامج المثبّت فيها الخط. */
export const APP_FONT_NAME = 'thmanyah sans';

const FALLBACK = 'Tahoma, Arial, sans-serif';

/**
 * داخل التطبيق: متغير next/font أولاً (الخط المضمَّن مع الموقع)، ثم اسم
 * الخط لو كان مثبّتاً على الجهاز، ثم بدائل النظام.
 */
export const APP_FONT_STACK = `var(--font-thmanyah), '${APP_FONT_NAME}', ${FALLBACK}`;

/**
 * للملفات التي تُفتح خارج التطبيق (HTML/Word مُنزَّل): لا يوجد متغير CSS
 * هناك، فيظهر الخط إن كان مثبّتاً على الجهاز وإلا بديل النظام.
 */
export const FILE_FONT_STACK = `'${APP_FONT_NAME}', ${FALLBACK}`;

/**
 * قواعد @font-face للخط + قيمة متغيره، لنقلها إلى نافذة طباعة/معاينة تُكتب
 * يدوياً (window.open + document.write أو blob:) — تلك النوافذ لا ترث CSS
 * التطبيق فترجع لخط النظام. الروابط تُحوَّل لمطلقة لتعمل خارج مسار الصفحة.
 *
 * للنوافذ الحيّة فقط — لا تُضمَّن في ملف يُنزَّل (الترخيص، راجع أعلاه).
 */
export function appFontFaceCss(): string {
  if (typeof document === 'undefined') return '';
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try { list = sheet.cssRules; } catch { continue; } // ورقة من نطاق آخر
    const base = sheet.href ?? document.baseURI;
    for (const rule of Array.from(list)) {
      if (rule.type !== CSSRule.FONT_FACE_RULE || !/thmanyah/i.test(rule.cssText)) continue;
      rules.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g,
        (_m, _q, u: string) => `url("${new URL(u, base).href}")`));
    }
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-thmanyah').trim();
  if (value) rules.push(`:root { --font-thmanyah: ${value}; }`);
  return rules.join('\n');
}
