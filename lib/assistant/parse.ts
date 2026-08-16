/**
 * تحويل سؤال بالعربية الطبيعية إلى "نيّة" (Intent) منظّمة.
 *
 * دالة نقية بالكامل — لا شبكة ولا قاعدة بيانات — عشان تكون قابلة للاختبار
 * بشكل كامل ومستقل. طبقة الإجابة (answer.ts) هي اللي تنفّذ النيّة.
 *
 * أسلوب التحليل: تقسيم السؤال إلى كلمات، سحب المحدّدات المعروفة منها
 * (يوم، أسبوع، وجبة، نوع الكيان، فلاتر)، ثم تصنيف النيّة بالكلمات المفتاحية،
 * والباقي غير المعروف = "الموضوع" (اسم صنف أو اسم شخص).
 */

import type { EntityType, MealType } from '@/lib/types';
import type { Intent, WeekSpec } from './types';

// التشكيل والتطويل — نكتب النطاق بالهروب الصريح حتى ما يبتلع الأرقام
// العربية-الهندية (U+0660–U+0669) اللي تقع داخل النطاق المكتوب حرفياً.
const TASHKEEL_RE = new RegExp('[\\u064B-\\u065F\\u0670]', 'g');
const TATWEEL_RE = new RegExp('\\u0640', 'g');
const NON_WORD_RE = new RegExp('[^\\u0621-\\u064Aa-z0-9\\s]', 'g');

/**
 * تطبيع خفيف للتحليل النحوي: يوحّد الألف والياء والأرقام ويشيل التشكيل،
 * لكنه **يُبقي الهمزة والتاء المربوطة** — لأن التفريق بين «غداء» (وجبة)
 * و«غدا» (بكرة) يعتمد عليها.
 */
export function lightNorm(input: string): string {
  if (!input) return '';
  let s = input.normalize('NFKC').toLowerCase();
  // الأرقام أولاً — قبل أي حذف نطاقات
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(TASHKEEL_RE, '').replace(TATWEEL_RE, '');
  s = s.replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي');
  s = s.replace(NON_WORD_RE, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const set = (...words: string[]) => new Set(words);

/**
 * واو العطف الملتصقة: «والثاني» → «الثاني».
 * نُبقي الأصل ونجرّب المقشّر فقط عند البحث في قوائم الكلمات المعروفة — عشان
 * اسم مثل «والدة» ما ينكسر إلى «الدة» ويضيع من الموضوع.
 */
function deWaw(word: string): string {
  return word.length > 3 && word.startsWith('و') ? word.slice(1) : word;
}

/** هل الكلمة (أو صيغتها بلا واو العطف) موجودة في المجموعة؟ */
function inSet(s: Set<string>, word: string): boolean {
  return s.has(word) || s.has(deWaw(word));
}

// ── أيام الأسبوع ───────────────────────────────────────────────────────────
const DAY_WORDS: Array<{ day: number; words: Set<string> }> = [
  { day: 6, words: set('السبت', 'سبت') },
  { day: 0, words: set('الاحد', 'الاحاد') },
  { day: 1, words: set('الاثنين', 'الاتنين', 'اثنين', 'الإثنين') },
  { day: 2, words: set('الثلاثاء', 'الثلاثا', 'ثلاثاء', 'التلاتا', 'الثلوث') },
  { day: 3, words: set('الاربعاء', 'الاربعا', 'اربعاء', 'الاربع') },
  { day: 4, words: set('الخميس', 'خميس') },
  { day: 5, words: set('الجمعة', 'الجمعه', 'جمعة', 'جمعه') },
];

// ── الوجبات ────────────────────────────────────────────────────────────────
// ملاحظة: «الغدا/غداء» وجبة، بينما «غدا/بكرة» تعني اليوم التالي.
const MEAL_WORDS: Array<{ type: MealType; words: Set<string> }> = [
  { type: 'breakfast', words: set('فطور', 'الفطور', 'افطار', 'الافطار', 'ريوق', 'الريوق') },
  { type: 'lunch', words: set('غداء', 'الغداء', 'الغدا', 'غدائ') },
  { type: 'dinner', words: set('عشاء', 'العشاء', 'العشا', 'عشا') },
];

const TOMORROW_WORDS = set('بكرة', 'بكره', 'بكرا', 'غدا', 'غد');
const TODAY_WORDS = set('اليوم', 'النهارده', 'النهاردة');
const YESTERDAY_WORDS = set('امس', 'الامس', 'البارحة', 'البارحه');

// ── الأسابيع ───────────────────────────────────────────────────────────────
const WEEK_MARKER = set('اسبوع', 'الاسبوع', 'اسابيع', 'الاسابيع');
const ORDINALS: Array<{ week: number; words: Set<string> }> = [
  { week: 1, words: set('الاول', 'اول', 'الاولي', 'الاولى') },
  { week: 2, words: set('الثاني', 'ثاني', 'الثانيه', 'الثانية', 'التاني') },
  { week: 3, words: set('الثالث', 'ثالث', 'الثالثه', 'الثالثة', 'التالت') },
  { week: 4, words: set('الرابع', 'رابع', 'الرابعه', 'الرابعة') },
];
const NEXT_WORDS = set('الجاي', 'الجايه', 'الجاية', 'القادم', 'القادمه', 'القادمة', 'المقبل', 'المقبله', 'المقبلة', 'الجديد', 'الجديده');
const CURRENT_WORDS = set('الحالي', 'الحاليه', 'الحالية', 'هذا', 'هذه', 'هذي', 'الحالى');
const PREV_WORDS = set('الماضي', 'الماضيه', 'الماضية', 'السابق', 'السابقه', 'السابقة', 'الفايت', 'الفائت');

// ── نوع الكيان ─────────────────────────────────────────────────────────────
const COMPANION_WORDS = set('مرافق', 'المرافق', 'مرافقين', 'المرافقين', 'المرافقون', 'مرافقون', 'المرافقات');
const BENEFICIARY_WORDS = set('مستفيد', 'المستفيد', 'مستفيدين', 'المستفيدين', 'المستفيدون', 'مستفيدون', 'نزيل', 'النزيل', 'نزلاء', 'النزلاء', 'المستفيدات');

// ── الحالة (مفعّل / معطّل) ─────────────────────────────────────────────────
const ACTIVE_WORDS = set('نشط', 'نشطين', 'النشطين', 'فعال', 'الفعالين', 'مفعل', 'المفعلين', 'مفعلين');
const INACTIVE_WORDS = set('معطل', 'معطلين', 'المعطلين', 'موقوف', 'الموقوفين', 'متوقف', 'غير');

// ── محفّزات النيّة ─────────────────────────────────────────────────────────
const TRIG_EXCLUSION = set('ممنوع', 'الممنوع', 'ممنوعه', 'ممنوعات', 'الممنوعات', 'يمنع', 'ممنوعين', 'مستثني', 'المستثنين', 'استثناء', 'استثناءات', 'الاستثناءات', 'بديل', 'البديل', 'بدائل', 'البدائل', 'مايكل', 'ماياكل');
const TRIG_TOP = set('اكثر', 'الاكثر', 'اعلي', 'الاعلي', 'ترتيب', 'الترتيب', 'توب', 'اشهر', 'الاشهر', 'الاقل', 'اقل');
const TRIG_SCHEDULE = set('متي', 'متى', 'ايام', 'الايام', 'يقدم', 'تقدم', 'ينزل', 'جدول', 'الجدول', 'مواعيد', 'موعد', 'مجدول', 'يتكرر');
const TRIG_COUNT = set('كم', 'عدد', 'العدد', 'كميه', 'كمية', 'الكميه', 'الكمية', 'كميات', 'حصه', 'حصة', 'حصص', 'الحصص', 'ياكل', 'ياكلون', 'يتناول', 'يتناولون', 'استهلاك', 'الاستهلاك', 'يستهلك', 'بياكل', 'بياكلون', 'بيتناول', 'ياخذ', 'ياخذون', 'اجمالي', 'الاجمالي', 'مجموع');
const TRIG_MENU = set('القائمه', 'القائمة', 'قائمه', 'قائمة', 'المنيو', 'منيو', 'وجبات', 'الوجبات', 'المنو');
const TRIG_PROFILE = set('معلومات', 'بيانات', 'بطاقه', 'بطاقة', 'ملف', 'بروفايل', 'تفاصيل', 'كرت');
const TRIG_BREAKDOWN = set('توزيع', 'التوزيع', 'تقسيم', 'التقسيم', 'احصائيه', 'احصائية', 'احصائيات');

// كلمات لا تدخل في "الموضوع" أبداً
const STOP_WORDS = set(
  'في', 'فيه', 'فيها', 'من', 'الي', 'الى', 'على', 'علي', 'عليه', 'عليها', 'عن', 'مع', 'هل',
  'ما', 'مين', 'من', 'هو', 'هي', 'اللي', 'الذي', 'التي', 'و', 'او', 'أو', 'يا', 'لي', 'لنا',
  'كل', 'بس', 'ابي', 'ابغي', 'اريد', 'ودي', 'عطني', 'اعطني', 'ورني', 'وريني', 'قول', 'قولي',
  'ايش', 'وش', 'ايه', 'شنو', 'شو', 'كيف', 'لو', 'سمحت', 'ممكن', 'عندي', 'عندنا', 'عند',
  'يوم', 'ايام', 'الوجبه', 'الوجبة', 'وجبه', 'وجبة', 'الصنف', 'صنف', 'اصناف', 'الاصناف',
  'طبق', 'الطبق', 'اطباق', 'خلال', 'ضمن', 'كامل', 'كاملا', 'كامله', 'كاملة', 'كله', 'كلها',
  'ذا', 'دي', 'بكم', 'قد', 'مره', 'مرة', 'تقريبا', 'الان', 'حاليا', 'رجاء', 'رجاءا', 'شكرا',
  'اسبوع', 'الاسبوع', 'اسابيع', 'الاسابيع', 'الفلاني', 'فلان', 'الفلانيه',
);

interface Extracted {
  words: string[];
  days: number[];
  mealType?: MealType;
  entityType?: EntityType;
  weeks: WeekSpec;
  weekExplicit: boolean;
  date?: string;
  villa?: string;
  activeOnly: boolean | null;
  limit?: number;
  /** الكلمات اللي ما تعرّفنا عليها = اسم الصنف أو الشخص. */
  subject: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function extract(question: string): Extracted {
  const words = lightNorm(question).split(' ').filter(Boolean);
  const consumed = new Set<number>();
  const take = (i: number) => consumed.add(i);

  const days: number[] = [];
  let mealType: MealType | undefined;
  let entityType: EntityType | undefined;
  let date: string | undefined;
  let villa: string | undefined;
  let activeOnly: boolean | null = null;
  let limit: number | undefined;

  const weekOrdinals: number[] = [];
  let relWeek: 'current' | 'next' | 'prev' | null = null;
  // «هذا الأسبوع»: الإشارة تسبق الكلمة الدالة، فنمسح الجملة كلها قبل الحلقة.
  const hasWeekMarker = words.some((w) => inSet(WEEK_MARKER, w));
  let sawWeekMarker = false;
  let sawScheduleTrigger = false;

  for (let i = 0; i < words.length; i++) {
    if (TRIG_SCHEDULE.has(words[i])) sawScheduleTrigger = true;
  }

  for (let i = 0; i < words.length; i++) {
    const w = words[i];

    // تاريخ صريح ISO
    if (ISO_DATE.test(w)) {
      date = w;
      take(i);
      continue;
    }

    const dayHit = DAY_WORDS.find((d) => inSet(d.words, w));
    if (dayHit) {
      if (!days.includes(dayHit.day)) days.push(dayHit.day);
      take(i);
      continue;
    }

    const mealHit = MEAL_WORDS.find((m) => inSet(m.words, w));
    if (mealHit) {
      mealType = mealHit.type;
      take(i);
      continue;
    }

    if (inSet(TOMORROW_WORDS, w)) {
      date = 'tomorrow';
      take(i);
      continue;
    }
    // «اليوم» تعني «today» فقط لما ما يكون السؤال عن جدولة صنف
    // (في «متى اليوم اللي فيه كذا» هي مجرد حشو).
    if (inSet(TODAY_WORDS, w)) {
      if (!sawScheduleTrigger && !date) date = 'today';
      take(i);
      continue;
    }
    if (inSet(YESTERDAY_WORDS, w)) {
      date = 'yesterday';
      take(i);
      continue;
    }

    if (inSet(WEEK_MARKER, w)) {
      sawWeekMarker = true;
      take(i);
      continue;
    }

    const ordHit = ORDINALS.find((o) => inSet(o.words, w));
    if (ordHit && hasWeekMarker) {
      if (!weekOrdinals.includes(ordHit.week)) weekOrdinals.push(ordHit.week);
      take(i);
      continue;
    }
    if (inSet(NEXT_WORDS, w) && hasWeekMarker) {
      relWeek = 'next';
      take(i);
      continue;
    }
    if (inSet(PREV_WORDS, w) && hasWeekMarker) {
      relWeek = 'prev';
      take(i);
      continue;
    }
    if (inSet(CURRENT_WORDS, w) && hasWeekMarker) {
      relWeek = 'current';
      take(i);
      continue;
    }

    if (inSet(COMPANION_WORDS, w)) {
      entityType = 'companion';
      take(i);
      continue;
    }
    if (inSet(BENEFICIARY_WORDS, w)) {
      entityType = 'beneficiary';
      take(i);
      continue;
    }

    if (inSet(ACTIVE_WORDS, w)) {
      activeOnly = true;
      take(i);
      continue;
    }
    if (inSet(INACTIVE_WORDS, w)) {
      activeOnly = false;
      take(i);
      continue;
    }

    if (w === 'فيلا' || w === 'الفيلا' || w === 'فله' || w === 'الفله') {
      take(i);
      const next = words[i + 1];
      if (next && !inSet(STOP_WORDS, next)) {
        villa = next;
        take(i + 1);
        i++;
      }
      continue;
    }

    // رقم مجرّد: يخدم «أسبوع 3» و«أكثر 5 أصناف»
    if (/^\d+$/.test(w)) {
      const n = Number(w);
      if (hasWeekMarker && n >= 1 && n <= 4 && !weekOrdinals.includes(n)) {
        weekOrdinals.push(n);
      } else if (n >= 1 && n <= 50) {
        limit = n;
      }
      take(i);
      continue;
    }

    if (inSet(STOP_WORDS, w)) take(i);
  }

  // كل كلمة محفّزة تُستهلك ولا تدخل في الموضوع
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (
      inSet(TRIG_EXCLUSION, w) || inSet(TRIG_TOP, w) || inSet(TRIG_SCHEDULE, w) ||
      inSet(TRIG_COUNT, w) || inSet(TRIG_MENU, w) || inSet(TRIG_PROFILE, w) ||
      inSet(TRIG_BREAKDOWN, w)
    ) {
      take(i);
    }
  }

  let weeks: WeekSpec;
  if (weekOrdinals.length > 0) {
    weeks = { mode: 'explicit', weeks: weekOrdinals.sort((a, b) => a - b) };
  } else if (relWeek === 'next') {
    weeks = { mode: 'next' };
  } else if (relWeek === 'prev') {
    weeks = { mode: 'prev' };
  } else if (relWeek === 'current' || (sawWeekMarker && !date)) {
    weeks = { mode: 'current' };
  } else {
    weeks = { mode: 'all' };
  }

  const subject = words
    .filter((_, i) => !consumed.has(i))
    .join(' ')
    .trim();

  return {
    words,
    days,
    mealType,
    entityType,
    weeks,
    weekExplicit: weekOrdinals.length > 0 || relWeek !== null,
    date,
    villa,
    activeOnly,
    limit,
    subject: /^\d+$/.test(subject) ? '' : subject,
  };
}

function hasAny(words: string[], trig: Set<string>): boolean {
  return words.some((w) => inSet(trig, w));
}

/** يحوّل سؤالاً حرّاً إلى نيّة منظّمة. */
export function parseQuestion(question: string): Intent {
  if (!question || !question.trim()) return { kind: 'help', reason: 'empty' };

  const ex = extract(question);
  if (ex.words.length === 0) return { kind: 'help', reason: 'empty' };

  const { words, subject } = ex;
  const common = { entityType: ex.entityType, mealType: ex.mealType };

  // 1) الممنوعات والبدائل
  if (hasAny(words, TRIG_EXCLUSION) && subject) {
    return { kind: 'meal_exclusions', subject };
  }

  // 2) التوزيع الإحصائي
  if (hasAny(words, TRIG_BREAKDOWN)) {
    const by = words.some((w) => w.includes('حمي') || w.includes('دايت'))
      ? 'diet'
      : words.some((w) => w.includes('فئ') || w.includes('تصنيف'))
        ? 'category'
        : 'villa';
    return { kind: 'entity_breakdown', by, entityType: ex.entityType };
  }

  // 3) أكثر الأصناف استهلاكاً
  if (hasAny(words, TRIG_TOP)) {
    return { kind: 'top_meals', weeks: ex.weeks, limit: ex.limit ?? 10, ...common };
  }

  // 4) بطاقة شخص
  if (hasAny(words, TRIG_PROFILE) && subject) {
    return { kind: 'entity_profile', subject };
  }

  // 5) متى يُقدَّم الصنف
  if (hasAny(words, TRIG_SCHEDULE) && subject) {
    return { kind: 'meal_schedule', subject, ...common };
  }

  // 6) الأعداد والكميات
  if (hasAny(words, TRIG_COUNT)) {
    if (subject) {
      return {
        kind: 'meal_consumption',
        subject,
        weeks: ex.weeks,
        days: ex.days.length ? ex.days : undefined,
        ...common,
      };
    }
    return {
      kind: 'entity_count',
      entityType: ex.entityType,
      villa: ex.villa,
      activeOnly: ex.activeOnly,
    };
  }

  // 7) قائمة يوم
  if (hasAny(words, TRIG_MENU) || ((ex.days.length > 0 || ex.date) && !subject)) {
    return {
      kind: 'menu_day',
      weeks: ex.weeks,
      days: ex.days.length ? ex.days : undefined,
      date: ex.date,
      ...common,
    };
  }

  // 8) اسم مجرّد — نستكشف: صنف ولا شخص؟
  if (subject) return { kind: 'lookup', subject, weeks: ex.weeks };

  // 9) فلتر كيان بلا كلمة عدّ صريحة («المرافقون النشطون»)
  if (ex.entityType || ex.villa || ex.activeOnly !== null) {
    return {
      kind: 'entity_count',
      entityType: ex.entityType,
      villa: ex.villa,
      activeOnly: ex.activeOnly,
    };
  }

  return { kind: 'help', reason: 'unknown' };
}

/** مُصدَّر للاختبار — يكشف المحدّدات المستخرجة قبل التصنيف. */
export const __testing = { extract };
