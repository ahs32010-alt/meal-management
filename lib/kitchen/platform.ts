'use client';

/**
 * تمييز المنصّة لعرض خطوات التثبيت الصحيحة.
 *
 * خطوات تثبيت الصوت العربي تختلف جذرياً بين أندرويد وiOS، وعرض الاثنين معاً
 * يُربك من يقف أمام التابلت. نستنتج المنصّة ونعرض خطواتها وحدها.
 *
 * الاستنتاج من `userAgent` تقريبي بطبعه — فنترك للمستخدم تبديل المنصّة يدوياً
 * حين نخطئ، بدل أن نحبسه على تخمينٍ خاطئ.
 */

export type Platform = 'android' | 'ios' | 'desktop';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;

  if (/android/i.test(ua)) return 'android';
  // آيباد الحديث يعلن نفسه ماك — نميّزه بوجود لمس متعدّد.
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
    return 'ios';
  }
  return 'desktop';
}

export interface SetupGuide {
  title: string;
  steps: string[];
  note?: string;
}

export const SETUP_GUIDES: Record<Platform, SetupGuide> = {
  android: {
    title: 'أندرويد',
    steps: [
      'افتح «الإعدادات»',
      'ابحث عن «تحويل النص إلى كلام» (أو: النظام ← اللغات والإدخال ← تحويل النص إلى كلام)',
      'اختر محرّك «Google» ثم اضغط ⚙️ بجانبه',
      'اضغط «تثبيت بيانات الصوت» ← «العربية»',
      'نزّل الصوت، ثم ارجع لهذه الصفحة وأعد تحميلها',
    ],
    note: 'بعض الأجهزة تسمّيها «تركيب الكلام» أو «Text-to-speech output».',
  },
  ios: {
    title: 'آيفون / آيباد',
    steps: [
      'افتح «الإعدادات»',
      'اضغط «تسهيلات الاستخدام»',
      'اضغط «المحتوى المنطوق» ← «الأصوات»',
      'اختر «العربية» ونزّل صوتاً منها',
      'ارجع لهذه الصفحة وأعد تحميلها',
    ],
    note: 'الأصوات المعلَّمة بـ«محسّن» أو «مميّز» أوضح — نزّلها إن توفّرت.',
  },
  desktop: {
    title: 'الحاسب',
    steps: [
      'ويندوز: الإعدادات ← الوقت واللغة ← اللغة ← إضافة العربية مع حزمة الكلام',
      'ماك: إعدادات النظام ← تسهيلات الاستخدام ← المحتوى المنطوق ← أصوات النظام ← العربية',
      'أعد تحميل هذه الصفحة بعد التثبيت',
    ],
    note: 'أصوات الجوال والتابلت عادةً أوضح من أصوات الحاسب — جرّبها من الجهاز الذي سيُستخدم في المطبخ.',
  },
};
