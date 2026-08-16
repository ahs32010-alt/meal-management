/**
 * محرّك الفهم — الارتساء بالكيانات بدل مطابقة القوالب.
 *
 * الفكرة: أسماء الأشخاص والأصناف موجودة في قاعدة بياناتك، فهي أقوى دليل في
 * الجملة. نمسح الجملة أولاً بحثاً عنها، ثم نقرأ بقية الكلمات حولها (فعل،
 * أيام، أسبوع، وجبة، كمية). النتيجة أن ترتيب الكلمات لم يعد مهماً، وأن
 * الأخطاء الإملائية والمدّ («خلييييه») والسوابق الملتصقة تُحتمل.
 *
 * وإذا نقصت معلومة، لا نرفض الأمر — نسأل عنها ونحتفظ بالباقي (حوار متعدد
 * الخطوات)، ونتذكّر آخر شخص/صنف حتى تُفهم الضمائر: «وحط له بيض السبت».
 */

import type { EntityType, ItemCategory, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import { STICKER_FLAGS, type StickerFlagKey } from '@/lib/sticker-flags';
import { PAGE_CATALOG, type PageEntry } from './pages';
import type { PersonField } from './commands';
import { matchKey as matchKeyOf, scoreMatch } from './normalize';
import { lightNorm } from './parse';
import { buildIndex, scanMentions, type EntityIndex, type Mention } from './lexicon';
import type { Command } from './commands';

// ── أشكال الصفوف المطلوبة ──────────────────────────────────────────────────

export interface LexMeal {
  id: string;
  name: string;
  english_name?: string | null;
  type?: MealType | null;
  is_snack?: boolean | null;
  category?: ItemCategory | null;
  entity_type?: string | null;
}

export interface LexPerson {
  id: string;
  name: string;
  english_name?: string | null;
  code?: string | null;
  entity_type?: string | null;
}

// ── المفردات الوظيفية ──────────────────────────────────────────────────────

const V = {
  add: ['اضف', 'اضيف', 'حط', 'حطه', 'ضع', 'ضيف', 'زد', 'ركب', 'سجل', 'عين', 'اعطي', 'اعطه', 'خل', 'خلي', 'خله', 'خليه', 'اجعل', 'اعمل', 'سوي', 'ابي', 'يدخل', 'ادخل', 'ادخله', 'يبي', 'يبغي'],
  remove: ['احذف', 'امسح', 'شيل', 'شل', 'ازل', 'الغي', 'انزع', 'فك', 'اشطب', 'حذف', 'الغاء', 'كنسل'],
  ban: ['امنع', 'ممنوع', 'يمنع', 'حرم', 'ماياكل', 'مايبي', 'ماياخذ', 'منع', 'ممنوعه', 'مايحب', 'مايتناول', 'مايشرب', 'ماياكله', 'مابيه', 'مايبغي', 'ماله', 'يكره', 'تكره', 'ماتاكل', 'ماتبي', 'ماتحب'],
  allow: ['اسمح', 'سامح', 'يقدر', 'مسموح'],
  subst: ['بدل', 'بدال', 'بديل', 'بدله', 'بدلها', 'بدلا', 'مكان', 'عوض', 'عوضا', 'محل', 'نقل', 'انقل', 'حول', 'استبدل', 'استبدال', 'تبديل', 'بدلاً'],
  fixed: ['ثابت', 'ثابته', 'ثوابت', 'دايم', 'دائم', 'مستمر', 'يومي', 'ثبت', 'ثبته', 'تثبيت', 'الثابت', 'الثوابت'],
  menu: ['قائمه', 'قائمة', 'منيو', 'المنو', 'جدول'],
  disable: ['عطل', 'اوقف', 'وقف', 'جمد', 'تعطيل', 'ايقاف', 'موقوف', 'معطل'],
  enable: ['فعل', 'نشط', 'شغل', 'تفعيل', 'تنشيط', 'مفعل', 'شغال', 'شغاله', 'فعال', 'نشيط', 'يشتغل'],
  change: ['غير', 'عدل', 'حدث', 'حول', 'تعديل', 'تغيير'],
  isNew: ['جديد', 'جديده', 'جديدة'],
  eat: ['ياكل', 'ياخذ', 'يتناول', 'يشرب', 'تاكل', 'تاخذ', 'تتناول', 'ياكلون'],
  villa: ['فيلا', 'الفيلا', 'سكن', 'السكن', 'فله'],
  diet: ['حميه', 'حمية', 'دايت', 'نظام', 'الحميه', 'الحمية'],
  notes: ['ملاحظه', 'ملاحظة', 'ملاحظات', 'الملاحظات'],
  mealNoun: ['صنف', 'الصنف', 'وجبه', 'وجبة', 'طبق', 'الطبق', 'اكل'],
  to: ['الي', 'الى', 'يصير', 'تصير', 'يكون', 'تكون'],
  from: ['عن', 'من'],
  qty: ['عدد', 'كميه', 'كمية', 'حصه', 'حصة', 'حصص', 'قطعه', 'قطعة'],
  navigate: ['افتح', 'ودني', 'وديني', 'روح', 'انتقل', 'خذني', 'فتح', 'اذهب', 'انقلني'],
  page: ['صفحه', 'صفحة', 'شاشه', 'شاشة', 'قسم', 'القسم'],
  create: ['انشئ', 'انشي', 'سجل', 'اضف', 'اضيف', 'ادخل', 'اعتمد'],
  multiplier: ['مضاعف', 'المضاعف', 'ضاعف', 'مضروب'],
  clear: ['فرغ', 'فضي', 'نظف', 'افرغ', 'خلي فاضي', 'فاضي'],
  rename: ['سم', 'سمه', 'اسمه', 'يسمي', 'تسميه'],
  personNoun: ['مستفيد', 'المستفيد', 'مرافق', 'المرافق', 'شخص', 'الشخص', 'نزيل'],
  order: ['امر', 'الامر', 'اوامر', 'الاوامر', 'تشغيل', 'التشغيل'],
  everyone: ['الجميع', 'الكل', 'كلهم', 'جميع', 'كافة', 'كافه'],
} as const;

/** كلمات التواريخ النسبية. */
const TODAY_WORDS = ['اليوم', 'النهارده'];
const TOMORROW_WORDS = ['بكره', 'بكرة', 'بكرا', 'غدا', 'غد'];
const YESTERDAY_WORDS = ['امس', 'الامس', 'البارحه', 'البارحة'];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** خيارات الستيكر: «لا يفضل السمك» وأخواتها. */
const STICKER_WORDS: Array<{ flag: StickerFlagKey; words: string[] }> = [
  { flag: 'no_fish', words: ['سمك', 'السمك'] },
  { flag: 'no_pasta_sandwich', words: ['مكرونه', 'مكرونة', 'باستا', 'ساندويش', 'سندويش'] },
  { flag: 'low_carb', words: ['كاربوهيدرات', 'كارب', 'نشويات', 'الكارب'] },
];
const STICKER_MARK = ['يفضل', 'تفضل', 'يحب', 'قليل', 'خفف'];

/** الحقول النصّية على الشخص وكلماتها. */
const PERSON_FIELDS: Array<{ field: PersonField; words: string[] }> = [
  { field: 'villa', words: ['فيلا', 'الفيلا', 'سكن', 'السكن', 'فله'] },
  { field: 'diet_type', words: ['حميه', 'حمية', 'دايت', 'نظام', 'الحميه', 'الحمية'] },
  { field: 'notes', words: ['ملاحظه', 'ملاحظة', 'ملاحظات', 'الملاحظات'] },
  { field: 'code', words: ['كود', 'الكود', 'رقم', 'الرقم'] },
  { field: 'category', words: ['فئه', 'فئة', 'الفئه', 'الفئة', 'تصنيف'] },
  { field: 'english_name', words: ['انجليزي', 'الانجليزي', 'انقلش'] },
  { field: 'name', words: ['الاسم', 'اسم'] },
];

const PRONOUNS = ['له', 'لها', 'عليه', 'عليها', 'عنه', 'عنها', 'نفسه', 'نفسها', 'هو', 'هي', 'ذا'];

const DAYS: Array<{ day: number; words: string[] }> = [
  { day: 6, words: ['السبت', 'سبت'] },
  { day: 0, words: ['الاحد', 'احد'] },
  { day: 1, words: ['الاثنين', 'الاتنين', 'اثنين'] },
  { day: 2, words: ['الثلاثاء', 'الثلاثا', 'ثلاثاء', 'التلاتا'] },
  { day: 3, words: ['الاربعاء', 'الاربعا', 'اربعاء'] },
  { day: 4, words: ['الخميس', 'خميس'] },
  { day: 5, words: ['الجمعه', 'الجمعة', 'جمعه'] },
];

const MEAL_TYPES: Array<{ type: MealType; words: string[] }> = [
  { type: 'breakfast', words: ['فطور', 'الفطور', 'افطار', 'الافطار', 'ريوق'] },
  { type: 'lunch', words: ['غداء', 'الغداء', 'الغدا'] },
  { type: 'dinner', words: ['عشاء', 'العشاء', 'العشا', 'عشا'] },
];

const CATEGORIES: Array<{ cat: ItemCategory; words: string[] }> = [
  { cat: 'hot', words: ['حار', 'ساخن'] },
  { cat: 'cold', words: ['بارد'] },
  { cat: 'snack', words: ['سناك', 'خفيف'] },
];

/** عبارات تعني «كل أيام الأسبوع» — تُوسَّع إلى الأيام السبعة. */
const EVERYDAY_WORDS = ['يوميا', 'يومي', 'يوميه', 'دايم', 'دايما', 'دائما', 'دائم', 'باستمرار'];

/**
 * عبارات نهاية الأسبوع — الجمعة والسبت.
 *
 * مقصورة على «ويكند» عمداً: «عطلة» و«إجازة» تتصادمان بعد التطبيع مع «عطّله»
 * (أمر تعطيل شخص) وهو أشيع في هذا النظام، وعبارة «نهاية الأسبوع» مغطّاة
 * كعبارة مستقلة أدناه.
 */
const WEEKEND_WORDS = ['ويكند', 'الويكند'];

const WEEK_MARK = ['اسبوع', 'الاسبوع', 'اسابيع'];
const ORDINALS: Array<{ week: number; words: string[] }> = [
  { week: 1, words: ['الاول', 'اول', 'الاولي'] },
  { week: 2, words: ['الثاني', 'ثاني', 'الثانيه', 'التاني'] },
  { week: 3, words: ['الثالث', 'ثالث', 'الثالثه', 'التالت'] },
  { week: 4, words: ['الرابع', 'رابع', 'الرابعه'] },
];
const WEEK_NEXT = ['الجاي', 'الجايه', 'القادم', 'القادمه', 'المقبل', 'الجديد'];
const WEEK_CURR = ['الحالي', 'الحاليه', 'هذا', 'هذي', 'هذه'];

const COMPANION = ['مرافق', 'المرافق', 'مرافقين', 'المرافقين'];
const BENEFICIARY = ['مستفيد', 'المستفيد', 'مستفيدين', 'المستفيدين', 'نزيل'];

/** يقصّ المدّ الكتابي: «خليييه» → «خلييه». */
function collapse(w: string): string {
  return w.replace(/(.)\1{2,}/g, '$1$1');
}

/** اللواحق الضميرية المتصلة بالأفعال: «عطّله»، «حطها»، «امنعهم». */
const PRONOUN_SUFFIX = /(ها|هم|هن|كم|ه)$/;

/** ينزع السوابق (و، ف، ب، ك، ل، لل، وال) واللواحق الضميرية. */
function bases(w: string): string[] {
  const out = [w];
  const add = (x: string) => { if (x.length >= 2 && !out.includes(x)) out.push(x); };
  if (w.length > 3) {
    if (/^[وفبك]/.test(w)) add(w.slice(1));
    if (w.startsWith('لل')) add('ال' + w.slice(2));
    else if (w.startsWith('ل')) { add(w.slice(1)); add('ال' + w.slice(1)); }
    if (/^[وفبك]ال/.test(w)) add(w.slice(1));
  }
  // اللاحقة تُجرَّب على كل صيغة سابقة
  for (const form of [...out]) {
    if (form.length > 3 && PRONOUN_SUFFIX.test(form)) add(form.replace(PRONOUN_SUFFIX, ''));
  }
  return out;
}

/** هل الكلمة تحمل ضميراً متصلاً يشير لشخص سابق؟ */
function carriesPronoun(w: string): boolean {
  return w.length > 3 && PRONOUN_SUFFIX.test(w);
}

/**
 * مطابقة تامة على صيغة lightNorm (الهمزة محفوظة).
 * ضرورية لكلمات التاريخ: «غداء» (وجبة) و«غدا» (بكرة) تتطابقان بعد حذف الهمزة
 * في المطابقة الضبابية، فنقارنهما حرفياً هنا.
 */
function exactWord(word: string, list: readonly string[]): boolean {
  const w = collapse(word);
  return list.includes(w) || (w.startsWith('و') && list.includes(w.slice(1)));
}

/** أدوات الاستفهام — وجودها بلا فعل أمر يعني أن الجملة سؤال لا أمر. */
const INTERROGATIVES = ['مين', 'وش', 'ايش', 'شنو', 'كم', 'متي', 'وين', 'ليش', 'لماذا', 'هل', 'كيف', 'ايهم', 'شلون', 'اشلون'];

/**
 * يضغط كل تكرار حرفي إلى حرف واحد — للمقارنة فقط.
 *
 * collapse() تعالج المطّ الطويل («امنععع») لأنها تضغط ٣ فأكثر، لكنها تترك
 * التكرار المزدوج الذي يخلّفه المطّ القصير («شييل») وازدواج الضغط على
 * المفتاح («اححذف»)، وهما أشيع من المطّ الطويل.
 */
function squeeze(w: string): string {
  return w.replace(/(.)\1+/g, '$1');
}

/**
 * مطابقة متسامحة: تطابق تام، أو تكرار حرفي، أو بعد نزع السوابق، أو تشابه
 * إملائي عالٍ.
 *
 * مسار التكرار مشروط بوجود حرف مكرّر فعلاً في الكلمة المدخلة — فالكلمات
 * السليمة تسلك نفس المسار القديم تماماً ولا تتأثر عتبات المطابقة الصارمة
 * (٠.٩٤ لحجب بدايات الأسماء مثلاً).
 */
function hits(word: string, lexicon: readonly string[], min = 0.84): boolean {
  const w = collapse(word);
  const repeated = /(.)\1/.test(w);
  for (const form of bases(w)) {
    const sq = repeated ? squeeze(form) : '';
    for (const l of lexicon) {
      if (form === l) return true;
      if (repeated && sq.length >= 3 && sq === squeeze(l)) return true;
      if (form.length >= 4 && scoreMatch(form, l) >= min) return true;
    }
  }
  return false;
}

/** أدوات النفي المنفصلة في العامية: «ما يبي»، «مو ياكل»، «مب حاب». */
const NEGATORS = ['ما', 'مو', 'مب', 'مهو', 'ماهو'];

/**
 * يلصق أداة النفي بالفعل الذي بعدها: «ما يبي» → «مايبي».
 *
 * الناس تكتب النفي موصولاً ومفصولاً بلا قاعدة، والمعجم يحمل الصيغة الموصولة.
 * الدمج مشروط بأن يبدأ ما بعدها بحرف مضارعة (ي/ت/ا/ن) حتى لا نبتلع «ما» في
 * موضع الاستفهام أو الاسم الموصول.
 */
function mergeNegation(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    if (NEGATORS.includes(words[i]) && next && /^[يتان]/.test(next) && next.length >= 3) {
      out.push(words[i] + next);
      i++;
      continue;
    }
    out.push(words[i]);
  }
  return out;
}

// ── الفتحات (Slots) ────────────────────────────────────────────────────────

export type SlotName = 'person' | 'meal' | 'altMeal' | 'days' | 'week' | 'mealType' | 'value';

export type GroupTargetSlot = { villa?: string; diet?: string; entityType?: EntityType; all?: boolean };

export type ActionKind =
  | 'substitute' | 'ban' | 'unban'
  | 'add_fixed' | 'remove_fixed'
  | 'disable' | 'enable'
  | 'set_field' | 'create_person' | 'delete_person' | 'set_sticker'
  | 'add_menu' | 'remove_menu' | 'set_multiplier' | 'clear_slot'
  | 'create_meal' | 'update_meal' | 'delete_meal'
  | 'create_order' | 'delete_order' | 'add_order_item' | 'remove_order_item'
  | 'bulk_exclusion' | 'bulk_status'
  | 'navigate';

/** ما يُحمل بين الأدوار في الحوار — معرّفات فقط، لا كائنات. */
export interface Pending {
  action: ActionKind;
  personId?: string;
  mealId?: string;
  altMealId?: string;
  days?: number[];
  week?: number | 'current' | 'next';
  mealType?: MealType;
  quantity?: number;
  field?: PersonField;
  value?: string;
  newMealName?: string;
  flag?: StickerFlagKey;
  flagValue?: boolean;
  pageHref?: string;
  pageLabel?: string;
  date?: string;
  group?: GroupTargetSlot;
  entityType?: EntityType;
  category?: ItemCategory;
  missing: SlotName;
}

/** ذاكرة قصيرة تُمرَّر بين الأدوار لتفسير الضمائر. */
export interface DialogContext {
  personId?: string;
  mealId?: string;
  days?: number[];
  week?: number | 'current' | 'next';
  mealType?: MealType;
}

export interface AskOption {
  label: string;
  /** النص الذي يُرسَل عند اختيار هذا الخيار. */
  value: string;
}

export type Interpretation =
  | { kind: 'command'; command: Command; context: DialogContext; usedContext: string[] }
  | {
      kind: 'ask';
      question: string;
      field: SlotName;
      options: AskOption[];
      pending: Pending;
      context: DialogContext;
    }
  | { kind: 'query' };

// ── التفكيك ────────────────────────────────────────────────────────────────

interface Scan {
  words: string[];
  people: Array<Mention<LexPerson>>;
  meals: Array<Mention<LexMeal>>;
  days: number[];
  mealType?: MealType;
  category?: ItemCategory;
  entityType?: EntityType;
  week?: number | 'current' | 'next';
  quantity?: number;
  /** فهرس أول كلمة استبدال («بدل») إن وُجدت. */
  substAt: number;
  fromAt: number;
  toAt: number;
  sig: Record<keyof typeof V, boolean>;
  personField?: PersonField;
  sticker?: { flag: StickerFlagKey; value: boolean };
  page?: PageEntry;
  /** فهارس الكلمات المستهلَكة كمحدّدات (يوم/وجبة/تصنيف/أسبوع/رقم). */
  modifierIdx: Set<number>;
  /** تاريخ صريح أو نسبي إن ذُكر. */
  date?: string;
  /** استهداف مجموعة (فيلا/حمية/الكل). */
  group?: GroupTargetSlot;
  hasPronoun: boolean;
  /** الجملة تحمل أداة استفهام. */
  isQuestion: boolean;
  /** الكلمات التي لم تُستهلك — تصلح قيمةً لحقل نصّي أو اسم صنف جديد. */
  leftover: string;
}

function scan(text: string, peopleIdx: EntityIndex<LexPerson>, mealIdx: EntityIndex<LexMeal>): Scan {
  // التاريخ الصريح يُسحب من النص الخام: التطبيع يحذف الشرطات فيتفتّت لثلاثة أرقام
  let explicitDate: string | undefined;
  const isoText = text.replace(/(\d{4})[/.](\d{2})[/.](\d{2})/g, '$1-$2-$3');
  const isoHit = /\d{4}-\d{2}-\d{2}/.exec(isoText);
  if (isoHit) explicitDate = isoHit[0];

  const words = mergeNegation(
    lightNorm(isoHit ? isoText.replace(isoHit[0], ' ') : isoText)
      .split(' ')
      .filter(Boolean),
  );

  // 1) الكلمات الوظيفية القوية لا تصلح بداية اسم
  const allVocab: string[] = [
    ...Object.values(V).flat(),
    ...DAYS.flatMap((d) => d.words),
    ...MEAL_TYPES.flatMap((m) => m.words),
    ...WEEK_MARK, ...WEEK_NEXT, ...WEEK_CURR,
    ...ORDINALS.flatMap((o) => o.words),
    ...PRONOUNS, ...COMPANION, ...BENEFICIARY,
  ];
  const blocked = new Set<number>();
  words.forEach((w, i) => {
    if (hits(w, allVocab, 0.94)) blocked.add(i);
  });

  // 2) الكيانات أولاً — أقوى دليل في الجملة
  const people = scanMentions(words, peopleIdx, { blocked, threshold: 0.74 });
  const usedByPeople = new Set<number>();
  people.forEach((m) => { for (let i = m.start; i <= m.end; i++) usedByPeople.add(i); });

  const mealsRaw = scanMentions(words, mealIdx, { blocked, threshold: 0.74 });
  const meals = mealsRaw.filter((m) => {
    for (let i = m.start; i <= m.end; i++) if (usedByPeople.has(i)) return false;
    return true;
  });

  const consumed = new Set(usedByPeople);
  meals.forEach((m) => { for (let i = m.start; i <= m.end; i++) consumed.add(i); });

  // 3) المحدّدات على ما تبقّى
  const days: number[] = [];
  let mealType: MealType | undefined;
  let category: ItemCategory | undefined;
  let entityType: EntityType | undefined;
  let week: number | 'current' | 'next' | undefined;
  let quantity: number | undefined;
  let substAt = -1;
  let fromAt = -1;
  let toAt = -1;
  let hasPronoun = false;
  const isQuestion = words.some((w, i) => !consumed.has(i) && hits(w, INTERROGATIVES, 0.95));

  const hasWeekMark = words.some((w, i) => !consumed.has(i) && hits(w, WEEK_MARK));
  const free = (lex: readonly string[], min?: number) =>
    words.some((w, i) => !consumed.has(i) && hits(w, lex, min));

  // الحقول والخيارات والصفحات تُرصد قبل الحلقة — استهلاك الكلمات لا يخفيها
  const personField = PERSON_FIELDS.find((f) => free(f.words))?.field;

  const stickerHit = free(STICKER_MARK) ? STICKER_WORDS.find((x) => free(x.words)) : undefined;
  const negated = words.some((w) => w === 'لا' || w === 'ما' || w === 'مو' || w === 'ماهو');
  const sticker = stickerHit
    ? { flag: stickerHit.flag, value: negated || !free(V.remove) }
    : undefined;

  // اسم الصفحة يُطابَق كلمةً كلمة عبر hits — فتُحتمل «للاصناف» و«لقائمة الطعام».
  // ونرجّح **الأخصّ**: «أوامر التسليم» تغلب «الأوامر» وإلا فتحنا الصفحة الخطأ.
  let page: PageEntry | undefined;
  let pageScore = 0;
  for (const pg of PAGE_CATALOG) {
    for (const alias of pg.aliases) {
      const toks = matchKeyOf(alias).split(' ').filter((x) => x.length >= 3);
      if (toks.length === 0) continue;
      if (!toks.every((tk) => words.some((w) => hits(w, [tk], 0.9)))) continue;
      const specificity = toks.join('').length + toks.length * 2;
      if (specificity > pageScore) { pageScore = specificity; page = pg; }
    }
  }

  const leftoverIdx: number[] = [];
  const modifierIdx = new Set<number>();

  // التاريخ: صريح ISO (سُحب من النص الخام) أو نسبي («اليوم»، «بكرة»، «أمس»)
  let date: string | undefined = explicitDate;
  words.forEach((w, i) => {
    if (consumed.has(i) || date) return;
    if (ISO_DATE_RE.test(w)) { date = w; consumed.add(i); modifierIdx.add(i); return; }
    if (exactWord(w, TODAY_WORDS)) { date = 'today'; consumed.add(i); modifierIdx.add(i); return; }
    if (exactWord(w, TOMORROW_WORDS)) { date = 'tomorrow'; consumed.add(i); modifierIdx.add(i); return; }
    if (exactWord(w, YESTERDAY_WORDS)) { date = 'yesterday'; consumed.add(i); modifierIdx.add(i); return; }
  });

  // نوع الكيان يُرصد مبكراً: «المستفيدين» تطابق أيضاً الاسم العام «مستفيد»
  // في قائمة الأفعال فتُستهلك قبل أن تُقرأ كنوع.
  const entityTypePre: EntityType | undefined = words.some((w, i) => !consumed.has(i) && hits(w, COMPANION))
    ? 'companion'
    : words.some((w, i) => !consumed.has(i) && hits(w, BENEFICIARY))
      ? 'beneficiary'
      : undefined;

  // المجموعة: «كل المستفيدين في فيلا 3» / «الجميع»
  let group: GroupTargetSlot | undefined;
  const villaAt = words.findIndex((w, i) => !consumed.has(i) && hits(w, ['فيلا', 'الفيلا', 'فله'], 0.92));
  if (villaAt > -1) {
    const next = words[villaAt + 1];
    if (next && !consumed.has(villaAt + 1)) {
      group = { villa: next };
      consumed.add(villaAt);
      consumed.add(villaAt + 1);
      modifierIdx.add(villaAt);
      modifierIdx.add(villaAt + 1);
    }
  }
  if (!group && words.some((w, i) => !consumed.has(i) && hits(w, V.everyone, 0.92))) {
    group = { all: true };
  }
  // «كل المرافقين» — «كل» وحدها لا تكفي (تتصادم مع «كل خميس»)، فنشترط أن
  // يصحبها اسم نوع الكيان، وعندها يصير الاستهداف جماعياً مقيّداً بذلك النوع.
  if (!group && entityTypePre && words.some((w, i) => !consumed.has(i) && ['كل', 'جميع', 'كافه', 'كافة'].includes(w))) {
    group = { all: true, entityType: entityTypePre };
  }

  const sig = Object.fromEntries(Object.keys(V).map((k) => [k, false])) as Record<keyof typeof V, boolean>;

  // عبارات التكرار تُقرأ قبل حلقة الأفعال: «يومياً» تطابق أيضاً كلمة «يومي»
  // في معجم الثوابت، فلو تُركت للحلقة لاستُهلكت كإشارة «ثابت» بلا أيام —
  // فيسأل المستخدم «في أي أيام؟» وهو قد قالها.
  const addDay = (d: number) => { if (!days.includes(d)) days.push(d); };
  const takeAsDays = (i: number) => { consumed.add(i); modifierIdx.add(i); sig.fixed = true; };

  words.forEach((w, i) => {
    if (consumed.has(i)) return;
    if (hits(w, EVERYDAY_WORDS, 0.9)) {
      for (let d = 0; d < 7; d++) addDay(d);
      takeAsDays(i);
      return;
    }
    if (hits(w, WEEKEND_WORDS, 0.9)) {
      addDay(5);
      addDay(6);
      takeAsDays(i);
    }
  });

  // «كل يوم» و«نهاية الأسبوع» — عبارتان لا كلمتان
  for (let i = 0; i < words.length - 1; i++) {
    if (consumed.has(i) || consumed.has(i + 1)) continue;
    const pair = `${words[i]} ${words[i + 1]}`;
    if (/^كل (يوم|الايام|ايام)$/.test(pair)) {
      for (let d = 0; d < 7; d++) addDay(d);
      takeAsDays(i);
      takeAsDays(i + 1);
    } else if (/^(نهايه|نهاية|اخر) الاسبوع$/.test(pair)) {
      addDay(5);
      addDay(6);
      takeAsDays(i);
      takeAsDays(i + 1);
    }
  }

  words.forEach((w, i) => {
    if (consumed.has(i)) return;

    for (const key of Object.keys(V) as Array<keyof typeof V>) {
      if (hits(w, V[key])) {
        sig[key] = true;
        // «عطّله» = فعل + ضمير يعود لآخر شخص في الحوار
        if (carriesPronoun(w) && !V[key].some((l) => l === collapse(w))) hasPronoun = true;
        if (key === 'subst' && substAt === -1) substAt = i;
        if (key === 'from' && fromAt === -1) fromAt = i;
        if (key === 'to' && toAt === -1) toAt = i;
        consumed.add(i);
      }
    }
    if (consumed.has(i)) return;

    const d = DAYS.find((x) => hits(w, x.words));
    if (d) { if (!days.includes(d.day)) days.push(d.day); consumed.add(i); modifierIdx.add(i); return; }

    const mt = MEAL_TYPES.find((x) => hits(w, x.words));
    if (mt) { mealType = mt.type; consumed.add(i); modifierIdx.add(i); return; }

    const c = CATEGORIES.find((x) => hits(w, x.words));
    if (c) { category = c.cat; consumed.add(i); modifierIdx.add(i); return; }

    if (hits(w, WEEK_MARK)) { consumed.add(i); modifierIdx.add(i); return; }

    const ord = ORDINALS.find((x) => hits(w, x.words));
    if (ord && hasWeekMark) { week = ord.week; consumed.add(i); modifierIdx.add(i); return; }
    if (hasWeekMark && hits(w, WEEK_NEXT)) { week = 'next'; consumed.add(i); modifierIdx.add(i); return; }
    if (hasWeekMark && hits(w, WEEK_CURR)) { week = 'current'; consumed.add(i); modifierIdx.add(i); return; }

    if (hits(w, COMPANION)) { entityType = 'companion'; consumed.add(i); return; }
    if (hits(w, BENEFICIARY)) { entityType = 'beneficiary'; consumed.add(i); return; }

    if (hits(w, PRONOUNS, 0.95)) { hasPronoun = true; consumed.add(i); return; }

    if (/^\d+$/.test(w)) {
      const n = Number(w);
      // «ضاعف البيض 2 … الأسبوع الثاني»: الرقم للمضاعف، والأسبوع من الترتيب
      if (sig.multiplier && quantity === undefined) quantity = n;
      else if (hasWeekMark && week === undefined && n >= 1 && n <= 4) week = n;
      else quantity = n;
      consumed.add(i);
      return;
    }

    leftoverIdx.push(i);
  });

  return {
    words,
    people,
    meals,
    days,
    mealType,
    category,
    entityType: entityType ?? entityTypePre,
    week,
    quantity,
    substAt,
    fromAt,
    toAt,
    sig,
    modifierIdx,
    date,
    group,
    personField,
    sticker,
    page,
    hasPronoun,
    isQuestion,
    leftover: leftoverIdx.map((i) => words[i]).join(' ').trim(),
  };
}

// ── الترجيح والقرار ────────────────────────────────────────────────────────

const ask = (
  field: SlotName,
  question: string,
  options: AskOption[],
  pending: Omit<Pending, 'missing'>,
  context: DialogContext,
): Interpretation => ({
  kind: 'ask',
  field,
  question,
  options,
  pending: { ...pending, missing: field },
  context,
});

const DAY_OPTIONS: AskOption[] = [
  { label: 'السبت', value: 'السبت' },
  { label: 'الأحد', value: 'الأحد' },
  { label: 'الإثنين', value: 'الإثنين' },
  { label: 'الثلاثاء', value: 'الثلاثاء' },
  { label: 'الأربعاء', value: 'الأربعاء' },
  { label: 'الخميس', value: 'الخميس' },
  { label: 'الجمعة', value: 'الجمعة' },
];

const MEAL_TYPE_OPTIONS: AskOption[] = (['breakfast', 'lunch', 'dinner'] as MealType[]).map((t) => ({
  label: MEAL_TYPE_LABELS[t],
  value: MEAL_TYPE_LABELS[t],
}));

const WEEK_OPTIONS: AskOption[] = [
  { label: 'الأسبوع الأول', value: 'الأسبوع الأول' },
  { label: 'الأسبوع الثاني', value: 'الأسبوع الثاني' },
  { label: 'الأسبوع الثالث', value: 'الأسبوع الثالث' },
  { label: 'الأسبوع الرابع', value: 'الأسبوع الرابع' },
  { label: 'الأسبوع الحالي', value: 'هذا الأسبوع' },
];

export interface InterpretInput {
  text: string;
  people: LexPerson[];
  meals: LexMeal[];
  context?: DialogContext;
  pending?: Pending;
}

/**
 * الفهم الكامل لدور واحد: يدمج جواب سؤال سابق إن وُجد، ويستعين بالسياق
 * للضمائر، ويرجّع إما أمراً جاهزاً، أو سؤالاً، أو إحالة لمحرّك الاستعلام.
 */
export function interpret(input: InterpretInput): Interpretation {
  const { text, people, meals } = input;
  const peopleIdx = buildIndex(people, (p) => [p.name, p.english_name, p.code]);
  const mealIdx = buildIndex(meals, (m) => [m.name, m.english_name]);

  const s = scan(text, peopleIdx, mealIdx);
  const ctx: DialogContext = { ...(input.context ?? {}) };
  const usedContext: string[] = [];

  const byId = <T extends { id: string }>(list: T[], id?: string) => (id ? list.find((x) => x.id === id) : undefined);

  // ── دمج جواب السؤال السابق ───────────────────────────────────────────────
  let pending = input.pending;
  if (pending) {
    const filled: Pending = { ...pending };
    switch (pending.missing) {
      case 'person':
        if (s.people[0]) filled.personId = s.people[0].item.id;
        break;
      case 'meal':
        if (s.meals[0]) filled.mealId = s.meals[0].item.id;
        break;
      case 'altMeal':
        if (s.meals[0]) filled.altMealId = s.meals[0].item.id;
        break;
      case 'days':
        if (s.days.length) filled.days = s.days;
        break;
      case 'week':
        if (s.week !== undefined) filled.week = s.week;
        break;
      case 'mealType':
        if (s.mealType) filled.mealType = s.mealType;
        break;
      case 'value':
        if (s.leftover || s.quantity !== undefined) filled.value = s.leftover || String(s.quantity);
        break;
    }
    // لو ما جاب الجواب المطلوب، ما نعتبره متابعة — نحلّل الجملة من جديد
    const answered = JSON.stringify(filled) !== JSON.stringify(pending);
    if (answered) pending = filled;
    else pending = undefined;
  }

  // ── تجميع الفتحات ────────────────────────────────────────────────────────
  // لما يكون هذا الدور **جواباً** لسؤال سابق، تُؤخذ كل الفتحات من الطلب
  // المعلّق (وقد دُمج فيه الجواب للتوّ) — لأن جملة الجواب قصيرة وقد تحتوي
  // اسماً يخصّ فتحة أخرى فيطيح على ما فُهم سابقاً.
  const answering = Boolean(pending);

  let person = answering
    ? byId(people, pending?.personId)
    : (s.people[0]?.item ?? byId(people, pending?.personId));
  if (!person && (s.hasPronoun || s.people.length === 0) && ctx.personId) {
    const fromCtx = byId(people, ctx.personId);
    if (fromCtx) { person = fromCtx; usedContext.push(`الشخص: ${fromCtx.name}`); }
  }

  // في الاستبدال: ما بعد «بدل» هو الممنوع، وما قبلها هو البديل
  let target: LexMeal | undefined;
  let alternative: LexMeal | undefined;
  if (answering) {
    target = byId(meals, pending?.mealId);
    alternative = byId(meals, pending?.altMealId);
  } else if (s.substAt > -1 && s.meals.length >= 2) {
    // «بيض بدل الفول»: ما بعد «بدل» هو الممنوع، وما قبلها هو البديل.
    // ولو جا الاثنان بعدها («بدل الفول حط له بيض») فالأول ممنوع والثاني بديل.
    const after = s.meals.filter((m) => m.start > s.substAt);
    const before = [...s.meals].reverse().find((m) => m.end < s.substAt);
    target = after[0]?.item ?? s.meals[0].item;
    alternative = before?.item ?? after[1]?.item ?? s.meals.find((m) => m.item.id !== target?.id)?.item;
  } else if (s.substAt > -1 && s.meals.length === 1) {
    const only = s.meals[0];
    if (only.start > s.substAt) target = only.item;
    else alternative = only.item;
  } else if (s.toAt > -1 && s.meals.length >= 2) {
    // «غيّر الفول إلى بيض»: أداة الانتقال تعكس ترتيب «بدل» — ما قبلها هو
    // المستبدَل وما بعدها هو البديل.
    const before = [...s.meals].reverse().find((m) => m.end < s.toAt);
    const after = s.meals.find((m) => m.start > s.toAt);
    target = before?.item ?? s.meals[0].item;
    alternative = after?.item ?? s.meals.find((m) => m.item.id !== target?.id)?.item;
  } else {
    target = s.meals[0]?.item;
  }

  if (!answering) {
    target ??= byId(meals, pending?.mealId);
    alternative ??= byId(meals, pending?.altMealId);
  }
  if (!target && ctx.mealId && s.hasPronoun) {
    const fromCtx = byId(meals, ctx.mealId);
    if (fromCtx) { target = fromCtx; usedContext.push(`الصنف: ${fromCtx.name}`); }
  }

  const pick = <T>(fromPending: T | undefined, fromSentence: T | undefined): T | undefined =>
    answering ? (fromPending ?? fromSentence) : (fromSentence ?? fromPending);

  const days = answering ? (pending?.days ?? s.days) : (s.days.length ? s.days : (pending?.days ?? []));
  const week = pick(pending?.week, s.week);
  const mealType = pick(pending?.mealType, s.mealType);
  const quantity = pick(pending?.quantity, s.quantity) ?? 1;
  const field = pick(pending?.field, s.personField);
  // الفيلا تصلح فلتر مجموعة أو قيمةً لحقل — لو الحقل مقصود فليست مجموعة
  const groupSlot = field === 'villa' && person ? undefined : s.group;
  const entityType = pick(pending?.entityType, s.entityType);
  const category = pick(pending?.category, s.category);

  const nextCtx: DialogContext = {
    personId: person?.id ?? ctx.personId,
    mealId: target?.id ?? ctx.mealId,
    days: days.length ? days : ctx.days,
    week: week ?? ctx.week,
    mealType: mealType ?? ctx.mealType,
  };

  const sig = s.sig;
  const action: ActionKind | undefined = pending?.action ?? decideAction(s, { person, target, alternative, days, field });

  if (!action) return { kind: 'query' };

  const base = {
    personId: person?.id,
    mealId: target?.id,
    altMealId: alternative?.id,
    days,
    week,
    mealType,
    quantity,
    field,
    entityType,
    category,
    flag: pending?.flag ?? s.sticker?.flag,
    flagValue: pending?.flagValue ?? s.sticker?.value,
    pageHref: pending?.pageHref ?? s.page?.href,
    pageLabel: pending?.pageLabel ?? s.page?.label,
    date: pick(pending?.date, s.date),
    group: pick(pending?.group, groupSlot),
  };

  const done = (command: Command): Interpretation => ({ kind: 'command', command, context: nextCtx, usedContext });

  const personOptions = () => people.slice(0, 6).map((p) => ({ label: p.name, value: p.name }));
  const mealOptions = () => meals.slice(0, 8).map((m) => ({ label: m.name, value: m.name }));

  switch (action) {
    case 'substitute': {
      if (!person) return ask('person', 'مين المستفيد؟', personOptions(), { ...base, action }, nextCtx);
      if (!target) return ask('meal', 'أي صنف تبي تمنعه؟', mealOptions(), { ...base, action }, nextCtx);
      if (!alternative) {
        return ask('altMeal', `وش البديل اللي ياخذه ${person.name} بدل «${target.name}»؟`, mealOptions(), { ...base, action }, nextCtx);
      }
      return done({ kind: 'set_exclusion', person: person.name, meal: target.name, alternative: alternative.name });
    }

    case 'ban': {
      if (!person) return ask('person', 'مين المستفيد؟', personOptions(), { ...base, action }, nextCtx);
      if (!target) return ask('meal', 'أي صنف تبي تمنعه؟', mealOptions(), { ...base, action }, nextCtx);
      return done({ kind: 'set_exclusion', person: person.name, meal: target.name, alternative: alternative?.name });
    }

    case 'unban': {
      if (!person) return ask('person', 'مين المستفيد؟', personOptions(), { ...base, action }, nextCtx);
      if (!target) return ask('meal', 'أي صنف تبي ترفع منعه؟', mealOptions(), { ...base, action }, nextCtx);
      return done({ kind: 'clear_exclusion', person: person.name, meal: target.name });
    }

    case 'add_fixed': {
      if (!person) return ask('person', 'لمن تبي تضيف الصنف الثابت؟', personOptions(), { ...base, action }, nextCtx);
      if (!target) return ask('meal', `أي صنف ثابت تبي تضيفه لـ${person.name}؟`, mealOptions(), { ...base, action }, nextCtx);
      if (days.length === 0) {
        return ask('days', `في أي أيام يتكرر «${target.name}»؟`, DAY_OPTIONS, { ...base, action }, nextCtx);
      }
      return done({ kind: 'add_fixed', person: person.name, meal: target.name, days, mealType, quantity });
    }

    case 'remove_fixed': {
      if (!person) return ask('person', 'من أي مستفيد تبي تحذف الصنف الثابت؟', personOptions(), { ...base, action }, nextCtx);
      if (!target) return ask('meal', 'أي صنف ثابت تبي تحذفه؟', mealOptions(), { ...base, action }, nextCtx);
      return done({ kind: 'remove_fixed', person: person.name, meal: target.name, days: days.length ? days : undefined, mealType });
    }

    case 'disable':
    case 'enable': {
      if (!person) {
        return ask('person', action === 'disable' ? 'مين تبي تعطّل؟' : 'مين تبي تفعّل؟', personOptions(), { ...base, action }, nextCtx);
      }
      return done({ kind: 'set_person_status', person: person.name, active: action === 'enable' });
    }

    case 'set_field': {
      if (!person) return ask('person', 'مين المستفيد؟', personOptions(), { ...base, action }, nextCtx);
      if (!field) return { kind: 'query' };
      const value = pending?.value ?? valueFrom(s);
      if (!value) {
        const label = field === 'villa' ? 'الفيلا' : field === 'diet_type' ? 'نوع الحمية' : 'الملاحظة';
        return ask('value', `وش ${label} الجديدة لـ${person.name}؟`, [], { ...base, action }, nextCtx);
      }
      return done({ kind: 'set_person_field', person: person.name, field, value });
    }

    case 'add_menu': {
      if (!target) return ask('meal', 'أي صنف تبي تضيفه للقائمة؟', mealOptions(), { ...base, action }, nextCtx);
      if (days.length === 0) return ask('days', `في أي يوم تضيف «${target.name}»؟`, DAY_OPTIONS, { ...base, action }, nextCtx);
      if (!mealType) return ask('mealType', 'أي وجبة؟', MEAL_TYPE_OPTIONS, { ...base, action }, nextCtx);
      if (week === undefined) return ask('week', 'أي أسبوع في الدورة؟', WEEK_OPTIONS, { ...base, action }, nextCtx);
      return done({ kind: 'add_menu_item', meal: target.name, week, days, mealType, entityType, category });
    }

    case 'remove_menu': {
      if (!target) return ask('meal', 'أي صنف تبي تحذفه من القائمة؟', mealOptions(), { ...base, action }, nextCtx);
      if (days.length === 0) return ask('days', `من أي يوم تحذف «${target.name}»؟`, DAY_OPTIONS, { ...base, action }, nextCtx);
      if (week === undefined) return ask('week', 'أي أسبوع في الدورة؟', WEEK_OPTIONS, { ...base, action }, nextCtx);
      return done({ kind: 'remove_menu_item', meal: target.name, week, days, mealType, entityType });
    }

    case 'create_person': {
      const name = pending?.value ?? s.leftover;
      if (!name) return ask('value', 'وش اسم المستفيد الجديد؟', [], { ...base, action }, nextCtx);
      const code = String(s.quantity ?? pending?.quantity ?? '');
      if (!code) {
        return ask('value', `وش كود «${name}»؟`, [], { ...base, action, value: name }, nextCtx);
      }
      return done({
        kind: 'create_person',
        name,
        code,
        entityType: entityType ?? 'beneficiary',
      });
    }

    case 'delete_person': {
      if (!person) return ask('person', 'مين تبي تحذف؟', personOptions(), { ...base, action }, nextCtx);
      return done({ kind: 'delete_person', person: person.name });
    }

    case 'set_sticker': {
      if (!person) return ask('person', 'مين المستفيد؟', personOptions(), { ...base, action }, nextCtx);
      const flag = base.flag;
      if (!flag) {
        return ask('value', 'أي خيار ستيكر؟', STICKER_FLAGS.map((f) => ({ label: f.label, value: f.label })), { ...base, action }, nextCtx);
      }
      return done({ kind: 'set_sticker_flag', person: person.name, flag, value: base.flagValue !== false });
    }

    case 'update_meal': {
      if (!target) return ask('meal', 'أي صنف تبي تعدّله؟', mealOptions(), { ...base, action }, nextCtx);
      const newName = pending?.newMealName ?? ((s.toAt > -1 ? valueFrom(s) : s.leftover) || undefined);
      if (!newName && !mealType && !category) {
        return ask('value', `وش التعديل على «${target.name}»؟ (اسم جديد، أو نوع الوجبة، أو التصنيف)`, [], { ...base, action }, nextCtx);
      }
      return done({ kind: 'update_meal', meal: target.name, newName, mealType, category });
    }

    case 'delete_meal': {
      if (!target) return ask('meal', 'أي صنف تبي تحذفه؟', mealOptions(), { ...base, action }, nextCtx);
      return done({ kind: 'delete_meal', meal: target.name });
    }

    case 'set_multiplier': {
      if (!target) return ask('meal', 'أي صنف تبي تغيّر مضاعفه؟', mealOptions(), { ...base, action }, nextCtx);
      if (days.length === 0) return ask('days', `في أي يوم؟`, DAY_OPTIONS, { ...base, action }, nextCtx);
      if (week === undefined) return ask('week', 'أي أسبوع في الدورة؟', WEEK_OPTIONS, { ...base, action }, nextCtx);
      const value = s.quantity ?? pending?.quantity;
      if (!value) return ask('value', `كم يصير مضاعف «${target.name}»؟`, [], { ...base, action }, nextCtx);
      return done({ kind: 'set_menu_multiplier', meal: target.name, week, days, mealType, value });
    }

    case 'clear_slot': {
      if (days.length === 0) return ask('days', 'أي يوم تبي تفرّغه؟', DAY_OPTIONS, { ...base, action }, nextCtx);
      if (!mealType) return ask('mealType', 'أي وجبة؟', MEAL_TYPE_OPTIONS, { ...base, action }, nextCtx);
      if (week === undefined) return ask('week', 'أي أسبوع في الدورة؟', WEEK_OPTIONS, { ...base, action }, nextCtx);
      return done({ kind: 'clear_menu_slot', week, days, mealType, entityType });
    }

    case 'create_order':
    case 'delete_order':
    case 'add_order_item':
    case 'remove_order_item': {
      const date = base.date;
      if (!date) {
        return ask('value', 'لأي يوم؟ (اليوم / بكرة / تاريخ مثل 2026-08-10)', [
          { label: 'اليوم', value: 'اليوم' },
          { label: 'بكرة', value: 'بكرة' },
          { label: 'أمس', value: 'أمس' },
        ], { ...base, action }, nextCtx);
      }
      if (!mealType) return ask('mealType', 'أي وجبة؟', MEAL_TYPE_OPTIONS, { ...base, action }, nextCtx);

      if (action === 'create_order') {
        return done({ kind: 'create_order', date, mealType, entityType: entityType ?? 'beneficiary' });
      }
      if (action === 'delete_order') {
        return done({ kind: 'delete_order', date, mealType, entityType });
      }
      if (!target) {
        return ask('meal', action === 'add_order_item' ? 'أي صنف تضيفه للأمر؟' : 'أي صنف تحذفه من الأمر؟', mealOptions(), { ...base, action }, nextCtx);
      }
      return done(
        action === 'add_order_item'
          ? { kind: 'add_order_item', date, mealType, meal: target.name, entityType }
          : { kind: 'remove_order_item', date, mealType, meal: target.name, entityType },
      );
    }

    case 'bulk_exclusion': {
      const g = base.group;
      if (!g) return { kind: 'query' };
      if (!target) return ask('meal', 'أي صنف تبي تمنعه عن المجموعة؟', mealOptions(), { ...base, action }, nextCtx);
      return done({
        kind: 'bulk_exclusion',
        group: { ...g, entityType: entityType ?? g.entityType },
        meal: target.name,
        alternative: alternative?.name,
      });
    }

    case 'bulk_status': {
      const g = base.group;
      if (!g) return { kind: 'query' };
      return done({
        kind: 'bulk_status',
        group: { ...g, entityType: entityType ?? g.entityType },
        active: !s.sig.disable,
      });
    }

    case 'navigate': {
      if (!base.pageHref || !base.pageLabel) {
        return ask('value', 'أي صفحة تبي تفتح؟', PAGE_CATALOG.map((pg) => ({ label: pg.label, value: pg.label })), { ...base, action }, nextCtx);
      }
      const entry = PAGE_CATALOG.find((pg) => pg.href === base.pageHref);
      return done({
        kind: 'open_page',
        href: base.pageHref,
        label: base.pageLabel,
        permission: entry?.permission ?? null,
      });
    }

    case 'create_meal': {
      const name = pending?.newMealName ?? s.leftover;
      if (!name) return ask('value', 'وش اسم الصنف الجديد؟', [], { ...base, action }, nextCtx);
      if (!mealType) {
        return ask('mealType', `«${name}» يتبع أي وجبة؟`, MEAL_TYPE_OPTIONS, { ...base, action, newMealName: name }, nextCtx);
      }
      return done({ kind: 'create_meal', name, mealType, category, entityType });
    }
  }

  void sig;
  return { kind: 'query' };
}

/** القيمة النصّية لتعديل حقل: ما بعد «إلى»، أو المتبقّي، أو رقم. */
function valueFrom(s: Scan): string {
  if (s.toAt > -1) {
    const after = s.words
      .filter((_, i) => i > s.toAt && !s.modifierIdx.has(i))
      .join(' ')
      .trim();
    if (after) return after;
  }
  if (s.quantity !== undefined && !s.leftover) return String(s.quantity);
  if (s.leftover) return s.leftover;
  if (s.quantity !== undefined) return String(s.quantity);
  return '';
}

/**
 * اختيار الإجراء من الإشارات الموجودة. الترتيب من الأخصّ إلى الأعمّ، وكل
 * قاعدة تشترط دليلاً حقيقياً — فالجمل الاستعلامية تسقط كلها إلى 'query'.
 */
function decideAction(
  s: Scan,
  slots: { person?: LexPerson; target?: LexMeal; alternative?: LexMeal; days: number[]; field?: string },
): ActionKind | undefined {
  const g = s.sig;
  const anyWriteVerb =
    g.add || g.create || g.remove || g.ban || g.allow || g.disable || g.enable || g.change;
  const personish = Boolean(slots.person) || s.hasPronoun;

  // سؤال بلا فعل أمر صريح = استعلام. «ممنوع» وصف حالة لا أمر، فلا يُحتسب هنا
  // وإلا صار «مين ممنوع عليه السمك» أمراً بالمنع.
  const imperative = g.add || g.remove || g.disable || g.enable || g.change || g.allow || g.subst;
  if (s.isQuestion && !imperative) return undefined;

  // التنقّل: فعل فتح + اسم صفحة معروف
  if (g.navigate && (s.page || g.page)) return 'navigate';

  // الأوامر الجماعية: مجموعة مستهدَفة بدل شخص واحد
  if (s.group && !slots.person) {
    if (g.disable || g.enable) return 'bulk_status';
    if (g.ban || g.subst || (g.add && slots.target)) return 'bulk_exclusion';
  }

  // أوامر التشغيل: كلمة «أمر تشغيل» أو تاريخ + وجبة مع فعل كتابة
  const orderish = g.order || (s.date !== undefined && s.mealType !== undefined);
  if (orderish && !personish && anyWriteVerb) {
    if (slots.target) return g.remove ? 'remove_order_item' : 'add_order_item';
    if (g.remove) return 'delete_order';
    if (g.add || g.create) return 'create_order';
  }

  // خيارات الستيكر: «أحمد لا يفضل السمك»
  if (s.sticker && personish) return 'set_sticker';

  // الاستبدال: كلمة «بدل» مع صنف — أقوى إشارة وأوضحها
  if (g.subst && (slots.target || slots.alternative)) return 'substitute';

  // «غيّر فول أحمد إلى بيض» — تغيير على شخص بصنفين وأداة انتقال = استبدال.
  // نشترط الشخص حتى لا تُخطف أوامر تعديل الصنف نفسه («غيّر اسم الفول إلى…»).
  if ((g.change || g.to) && personish && slots.target && slots.alternative && !slots.field) {
    return 'substitute';
  }

  // المضاعف وتفريغ الخانة
  if (g.multiplier && !personish) return 'set_multiplier';
  if (g.clear && (g.menu || s.week !== undefined || s.mealType !== undefined) && !personish) return 'clear_slot';

  // إنشاء صنف/شخص جديد
  if (g.isNew && g.mealNoun && (g.add || s.leftover)) return 'create_meal';
  if (g.isNew && g.personNoun && (g.add || g.create)) return 'create_person';

  // تعديل/حذف صنف — بلا شخص في الجملة ولا خانة قائمة (أسبوع/يوم)
  if (slots.target && !personish) {
    const slotless = s.week === undefined && s.days.length === 0 && !g.menu;
    if (g.remove && slotless) return 'delete_meal';
    if (g.rename || (g.change && s.week === undefined && !g.menu)) return 'update_meal';
    // «خل بيض مسلوق يصير غداء» — تغيير نوع الوجبة أو التصنيف
    if (slotless && (s.mealType !== undefined || s.category !== undefined) && (anyWriteVerb || g.to)) {
      return 'update_meal';
    }
  }

  // حذف شخص
  if (g.remove && g.personNoun && personish) return 'delete_person';

  // الأصناف الثابتة
  if (g.fixed && (g.remove ? true : g.add || slots.target || personish)) {
    return g.remove ? 'remove_fixed' : 'add_fixed';
  }

  // رفع المنع قبل فرضه — «احذف منع» و«اسمح»
  if ((g.remove && g.ban) || g.allow) return 'unban';
  if (g.ban && !g.remove) return 'ban';

  // الحالة
  if (g.disable && personish) return 'disable';
  if (g.enable && personish) return 'enable';

  // الحقول: «غيّر فيلا أحمد إلى 5» و«خل فيلا سارة 7» سواء
  if (slots.field && personish && (g.change || g.add || s.toAt > -1 || s.quantity !== undefined || s.leftover)) {
    return 'set_field';
  }

  // القائمة: لا شخص فيها، ويكفي دليل واحد (كلمة «قائمة» أو أسبوع/وجبة+يوم)
  const menuish = g.menu || s.week !== undefined || (s.mealType !== undefined && s.days.length > 0);
  if (menuish && !personish && slots.target && (anyWriteVerb || s.days.length > 0)) {
    return g.remove ? 'remove_menu' : 'add_menu';
  }

  // شخص + صنف + أيام + فعل إضافة = صنف ثابت («حط له بيض السبت»)
  if (g.add && personish && slots.target && slots.days.length > 0 && !g.menu) return 'add_fixed';

  // «أحمد ياخذ أرز يوم الاثنين» — الإخبار بفعل الأكل مع أيام محدّدة تثبيتٌ
  // للصنف، ولو خلت الجملة من فعل أمر صريح.
  if (g.eat && personish && slots.target && slots.days.length > 0 && !g.menu) return 'add_fixed';

  // أمر كتابة واضح مع شخص وصنف بلا سياق آخر → منع
  if (g.remove && personish && slots.target) return 'unban';
  if (g.add && personish && slots.target && g.eat) return 'ban';

  return undefined;
}
