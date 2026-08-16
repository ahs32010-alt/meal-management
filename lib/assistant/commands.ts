/**
 * تحليل **الأوامر التنفيذية** بالعربية إلى بنية منظّمة.
 *
 * دالة نقية بالكامل (بلا قاعدة بيانات) — تفصل الجملة إلى مقاطع، تسحب
 * المحدّدات المعروفة (فعل، يوم، أسبوع، وجبة، رقم)، والباقي = "مقاطع مجهولة"
 * تُوزَّع على الأدوار (شخص / صنف / بديل) حسب موقعها من الكلمات المفصلية.
 *
 * لا شيء ينفَّذ من هنا. المخرَج يمر على plan.ts (يحلّ الأسماء ويبني معاينة)
 * ثم ينتظر تأكيد المستخدم قبل التنفيذ.
 */

import type { EntityType, ItemCategory, MealType } from '@/lib/types';
import type { StickerFlagKey } from '@/lib/sticker-flags';

/** الحقول النصّية القابلة للتعديل على المستفيد/المرافق عبر المساعد. */
export type PersonField = 'villa' | 'diet_type' | 'notes' | 'name' | 'code' | 'english_name' | 'category';

/** استهداف مجموعة أشخاص بدل شخص واحد. */
export interface GroupTarget {
  villa?: string;
  diet?: string;
  entityType?: EntityType;
  /** كل من ينطبق عليه الفلتر — لو ما فيه فلتر فهم الجميع. */
  all?: boolean;
}
import { lightNorm } from './parse';

const set = (...w: string[]) => new Set(w);

/**
 * صيغ بديلة للكلمة بعد نزع السوابق الملتصقة (و، ف، ب، ك، ل، لل).
 * تُستخدم للبحث في قوائم الكلمات المعروفة فقط — فالإيجابيات الكاذبة غير مؤذية
 * لأن الكلمة تُستهلك فقط عند مطابقة فعلية.
 */
export function wordVariants(w: string): string[] {
  const out = [w];
  if (w.length > 3) {
    if (/^[وفبك]/.test(w)) out.push(w.slice(1));
    if (w.startsWith('لل')) out.push('ال' + w.slice(2), w.slice(2));
    else if (w.startsWith('ل')) out.push(w.slice(1), 'ال' + w.slice(1));
    if (w.startsWith('وال')) out.push(w.slice(1));
    if (w.startsWith('بال') || w.startsWith('فال') || w.startsWith('كال')) out.push(w.slice(1));
  }
  return out;
}

const has = (s: Set<string>, w: string) => wordVariants(w).some((v) => s.has(v));

// ── الأفعال ────────────────────────────────────────────────────────────────
const V_ASSIGN = set('خلي', 'خله', 'خليه', 'خليها', 'اجعل', 'اعمل', 'سو', 'سوي', 'حط', 'حطي', 'ضع', 'ضيف', 'اضف', 'ركب', 'عين', 'سجل', 'اربط');
const V_REMOVE = set('احذف', 'امسح', 'شيل', 'ازل', 'الغي', 'انزع', 'فك', 'احذفي', 'امسحي', 'اشطب', 'الغاء');
const V_BAN = set('امنع', 'منع', 'امنعي', 'حرم');
const V_ALLOW = set('اسمح', 'سامح', 'رجع', 'ارجع');
const V_ENABLE = set('فعل', 'نشط', 'شغل', 'فعّل');
const V_DISABLE = set('عطل', 'اوقف', 'وقف', 'جمد', 'عطّل');
const V_CHANGE = set('غير', 'عدل', 'حدث', 'غيّر', 'حول');

// ── الكلمات المفصلية ───────────────────────────────────────────────────────
const A_EAT = set('ياكل', 'ياكلون', 'تاكل', 'ياخذ', 'تاخذ', 'ياخذون', 'يتناول', 'تتناول', 'يشرب', 'تشرب', 'ياكله');
const A_SUBST = set('بدل', 'بدال', 'بديل', 'بديلا', 'بدلا', 'مكان', 'عوض', 'عوضا', 'محل');
const A_FIXED = set('ثابت', 'ثابته', 'ثابتة', 'الثابت', 'الثابته', 'الثابتة', 'ثوابت', 'الثوابت');
const A_FROM_PERSON = set('عن', 'من');
const A_TO = set('الي', 'الى', 'ل', 'يصير', 'تصير', 'يكون', 'تكون');
const A_MENU = set('القائمه', 'القائمة', 'قائمه', 'قائمة', 'المنيو', 'منيو', 'المنو');
const A_NEW = set('جديد', 'جديده', 'جديدة');
const A_MEAL_NOUN = set('صنف', 'الصنف', 'صنفا', 'وجبه', 'وجبة', 'الوجبه', 'الوجبة', 'طبق', 'الطبق');
const A_BANNED = set('ممنوع', 'ممنوعه', 'ممنوعة', 'يمنع', 'محرم');

// ── الحقول ─────────────────────────────────────────────────────────────────
const F_VILLA = set('فيلا', 'الفيلا', 'فله', 'الفله', 'سكن', 'السكن');
const F_DIET = set('حميه', 'حمية', 'الحميه', 'الحمية', 'دايت', 'الدايت', 'نظام', 'النظام');
const F_NOTES = set('ملاحظه', 'ملاحظة', 'الملاحظه', 'الملاحظة', 'ملاحظات', 'الملاحظات');

// ── محدّدات مشتركة ─────────────────────────────────────────────────────────
const DAY_WORDS: Array<{ day: number; words: Set<string> }> = [
  { day: 6, words: set('السبت', 'سبت') },
  { day: 0, words: set('الاحد', 'احد') },
  { day: 1, words: set('الاثنين', 'الاتنين', 'اثنين') },
  { day: 2, words: set('الثلاثاء', 'الثلاثا', 'ثلاثاء', 'التلاتا') },
  { day: 3, words: set('الاربعاء', 'الاربعا', 'اربعاء') },
  { day: 4, words: set('الخميس', 'خميس') },
  { day: 5, words: set('الجمعة', 'الجمعه', 'جمعه', 'جمعة') },
];

const MEAL_WORDS: Array<{ type: MealType; words: Set<string> }> = [
  { type: 'breakfast', words: set('فطور', 'الفطور', 'افطار', 'الافطار', 'ريوق', 'الريوق') },
  { type: 'lunch', words: set('غداء', 'الغداء', 'الغدا') },
  { type: 'dinner', words: set('عشاء', 'العشاء', 'العشا', 'عشا') },
];

const CATEGORY_WORDS: Array<{ cat: ItemCategory; words: Set<string> }> = [
  { cat: 'hot', words: set('حار', 'الحار', 'ساخن', 'الساخن') },
  { cat: 'cold', words: set('بارد', 'البارد') },
  { cat: 'snack', words: set('سناك', 'السناك', 'وجبه خفيفه', 'خفيف') },
];

const WEEK_MARKER = set('اسبوع', 'الاسبوع');
const ORDINALS: Array<{ week: number; words: Set<string> }> = [
  { week: 1, words: set('الاول', 'اول', 'الاولي') },
  { week: 2, words: set('الثاني', 'ثاني', 'الثانيه', 'الثانية', 'التاني') },
  { week: 3, words: set('الثالث', 'ثالث', 'الثالثه', 'الثالثة', 'التالت') },
  { week: 4, words: set('الرابع', 'رابع', 'الرابعه', 'الرابعة') },
];
const NEXT_WORDS = set('الجاي', 'الجايه', 'القادم', 'القادمه', 'المقبل', 'المقبله');
const CURRENT_WORDS = set('الحالي', 'الحاليه', 'هذا', 'هذي', 'هذه');

const COMPANION_WORDS = set('مرافق', 'المرافق', 'مرافقين', 'المرافقين', 'للمرافقين');
const BENEFICIARY_WORDS = set('مستفيد', 'المستفيد', 'مستفيدين', 'المستفيدين', 'نزيل', 'النزيل');

const QTY_WORDS = set('عدد', 'كميه', 'كمية', 'بكميه', 'حصه', 'حصة', 'حصص', 'مرات', 'قطعه', 'قطعة');

const STOP = set(
  'في', 'فيه', 'فيها', 'من', 'الي', 'الى', 'على', 'علي', 'عليه', 'عليها', 'مع', 'هل', 'ما',
  'اللي', 'الذي', 'التي', 'و', 'او', 'يا', 'لي', 'لنا', 'له', 'لها', 'كل', 'بس', 'ابي', 'ابغي',
  'اريد', 'ودي', 'لو', 'سمحت', 'ممكن', 'رجاء', 'شكرا', 'يوم', 'ايام', 'الايام', 'يومي', 'ايامي',
  'اسمه', 'اسمها', 'الاسم', 'اسم', 'مثلا', 'يعني', 'تمام', 'طيب', 'الان', 'حاليا', 'عندي',
  'انا', 'انت', 'هو', 'هي', 'ذا', 'دي', 'بتاريخ', 'تاريخ',
);

// ── أنواع الأوامر ──────────────────────────────────────────────────────────

export type Command =
  | { kind: 'set_exclusion'; person: string; meal: string; alternative?: string }
  | { kind: 'clear_exclusion'; person: string; meal: string }
  | {
      kind: 'add_fixed';
      person: string;
      meal: string;
      days: number[];
      mealType?: MealType;
      quantity: number;
    }
  | { kind: 'remove_fixed'; person: string; meal: string; days?: number[]; mealType?: MealType }
  | { kind: 'set_person_status'; person: string; active: boolean }
  | { kind: 'set_person_field'; person: string; field: PersonField; value: string }
  | { kind: 'create_person'; name: string; code: string; entityType: EntityType; villa?: string; dietType?: string }
  | { kind: 'delete_person'; person: string }
  | { kind: 'set_sticker_flag'; person: string; flag: StickerFlagKey; value: boolean }
  | { kind: 'update_meal'; meal: string; newName?: string; mealType?: MealType; category?: ItemCategory }
  | { kind: 'delete_meal'; meal: string }
  | { kind: 'set_menu_multiplier'; meal: string; week: number | 'current' | 'next'; days: number[]; mealType?: MealType; value: number }
  | { kind: 'clear_menu_slot'; week: number | 'current' | 'next'; days: number[]; mealType: MealType; entityType?: EntityType }
  | { kind: 'create_order'; date: string; mealType: MealType; entityType: EntityType }
  | { kind: 'delete_order'; date: string; mealType: MealType; entityType?: EntityType }
  | { kind: 'add_order_item'; date: string; mealType: MealType; meal: string; entityType?: EntityType }
  | { kind: 'remove_order_item'; date: string; mealType: MealType; meal: string; entityType?: EntityType }
  | { kind: 'bulk_exclusion'; group: GroupTarget; meal: string; alternative?: string }
  | { kind: 'bulk_status'; group: GroupTarget; active: boolean }
  | { kind: 'open_page'; href: string; label: string; permission: string | null }
  | {
      kind: 'add_menu_item';
      meal: string;
      week: number | 'current' | 'next';
      days: number[];
      mealType: MealType;
      entityType?: EntityType;
      category?: ItemCategory;
    }
  | {
      kind: 'remove_menu_item';
      meal: string;
      week: number | 'current' | 'next';
      days: number[];
      mealType?: MealType;
      entityType?: EntityType;
    }
  | { kind: 'create_meal'; name: string; mealType: MealType; category?: ItemCategory; entityType?: EntityType };

export type CommandKind = Command['kind'];

/** أمر ناقص محدّد — نسأل المستخدم بدل ما نخمّن. */
export interface CommandGap {
  kind: 'gap';
  /** أقرب أمر فهمناه. */
  intended: CommandKind;
  missing: string;
  hint: string;
}

export type CommandParse = Command | CommandGap | null;

// ── التفكيك ────────────────────────────────────────────────────────────────

type Role =
  | 'verb_assign' | 'verb_remove' | 'verb_ban' | 'verb_allow'
  | 'verb_enable' | 'verb_disable' | 'verb_change'
  | 'a_eat' | 'a_subst' | 'a_fixed' | 'a_from' | 'a_to' | 'a_menu' | 'a_new' | 'a_mealnoun'
  | 'a_banned' | 'f_villa' | 'f_diet' | 'f_notes'
  | 'day' | 'mealtype' | 'category' | 'week' | 'entity' | 'qty' | 'number' | 'stop';

interface Parsed {
  words: string[];
  roles: Array<Role | null>;
  days: number[];
  mealType?: MealType;
  category?: ItemCategory;
  entityType?: EntityType;
  week?: number | 'current' | 'next';
  quantity?: number;
  /** مقاطع الكلمات غير المعروفة، بترتيب ظهورها. */
  spans: Span[];
}

function dissect(input: string): Parsed {
  const words = lightNorm(input).split(' ').filter(Boolean);
  const roles: Array<Role | null> = new Array(words.length).fill(null);

  const days: number[] = [];
  let mealType: MealType | undefined;
  let category: ItemCategory | undefined;
  let entityType: EntityType | undefined;
  let week: number | 'current' | 'next' | undefined;
  let quantity: number | undefined;

  // كلمة «أسبوع» قد تجي بعد الإشارة («هذا الأسبوع») — فنمسح الجملة كاملة أولاً
  // بدل الاعتماد على ترتيب الظهور.
  const hasWeekMarker = words.some((w) => has(WEEK_MARKER, w));
  let sawQtyWord = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const mark = (r: Role) => { roles[i] = r; };

    if (has(V_ASSIGN, w)) { mark('verb_assign'); continue; }
    if (has(V_REMOVE, w)) { mark('verb_remove'); continue; }
    if (has(V_BAN, w)) { mark('verb_ban'); continue; }
    if (has(V_ALLOW, w)) { mark('verb_allow'); continue; }
    if (has(V_ENABLE, w)) { mark('verb_enable'); continue; }
    if (has(V_DISABLE, w)) { mark('verb_disable'); continue; }
    if (has(V_CHANGE, w)) { mark('verb_change'); continue; }

    if (has(A_EAT, w)) { mark('a_eat'); continue; }
    if (has(A_SUBST, w)) { mark('a_subst'); continue; }
    if (has(A_FIXED, w)) { mark('a_fixed'); continue; }
    if (has(A_BANNED, w)) { mark('a_banned'); continue; }
    if (has(A_MENU, w)) { mark('a_menu'); continue; }
    if (has(A_NEW, w)) { mark('a_new'); continue; }
    if (has(A_MEAL_NOUN, w)) { mark('a_mealnoun'); continue; }

    if (has(F_VILLA, w)) { mark('f_villa'); continue; }
    if (has(F_DIET, w)) { mark('f_diet'); continue; }
    if (has(F_NOTES, w)) { mark('f_notes'); continue; }

    const dayHit = DAY_WORDS.find((d) => has(d.words, w));
    if (dayHit) { if (!days.includes(dayHit.day)) days.push(dayHit.day); mark('day'); continue; }

    const mealHit = MEAL_WORDS.find((m) => has(m.words, w));
    if (mealHit) { mealType = mealHit.type; mark('mealtype'); continue; }

    const catHit = CATEGORY_WORDS.find((c) => has(c.words, w));
    if (catHit) { category = catHit.cat; mark('category'); continue; }

    if (has(WEEK_MARKER, w)) { mark('week'); continue; }

    const ordHit = ORDINALS.find((o) => has(o.words, w));
    if (ordHit && hasWeekMarker) { week = ordHit.week; mark('week'); continue; }
    if (has(NEXT_WORDS, w) && hasWeekMarker) { week = 'next'; mark('week'); continue; }
    if (has(CURRENT_WORDS, w) && hasWeekMarker) { week = 'current'; mark('week'); continue; }

    if (has(COMPANION_WORDS, w)) { entityType = 'companion'; mark('entity'); continue; }
    if (has(BENEFICIARY_WORDS, w)) { entityType = 'beneficiary'; mark('entity'); continue; }

    if (has(QTY_WORDS, w)) { sawQtyWord = true; mark('qty'); continue; }

    if (/^\d+$/.test(w)) {
      const n = Number(w);
      if (hasWeekMarker && week === undefined && n >= 1 && n <= 4) week = n;
      else if (n >= 1 && n <= 99) quantity = n;
      mark('number');
      continue;
    }

    // «عن/من فلان» تفصل الشخص عن الصنف
    if (has(A_FROM_PERSON, w)) { mark('a_from'); continue; }
    if (has(A_TO, w)) { mark('a_to'); continue; }
    if (has(STOP, w)) { mark('stop'); continue; }
  }

  void sawQtyWord;

  const spans: Parsed['spans'] = [];
  let start = -1;
  for (let i = 0; i <= words.length; i++) {
    const open = i < words.length && roles[i] === null;
    if (open && start === -1) start = i;
    if (!open && start !== -1) {
      spans.push({ start, end: i - 1, text: words.slice(start, i).join(' ') });
      start = -1;
    }
  }

  return { words, roles, days, mealType, category, entityType, week, quantity, spans };
}

export type Span = { start: number; end: number; text: string };

/** هل يبدأ المقطع بلام الجر الملتصقة («لأحمد»)؟ */
function startsWithLam(text: string): boolean {
  const first = text.split(' ')[0] ?? '';
  return first.length > 3 && first.startsWith('ل');
}

/** يشيل لام الجر من أول كلمة — تُجرَّب كصيغة بديلة عند حلّ الأسماء. */
export function stripLeadingLam(text: string): string {
  const parts = text.split(' ');
  if (parts.length && startsWithLam(parts[0])) parts[0] = parts[0].slice(1);
  return parts.join(' ');
}

const firstIndexOf = (roles: Array<Role | null>, r: Role) => roles.indexOf(r);
const hasRole = (roles: Array<Role | null>, r: Role) => roles.includes(r);

/** المقطع الأول الذي يقع بعد الفهرس المعطى. */
function spanAfter(p: Parsed, index: number) {
  return p.spans.find((s) => s.start > index);
}
/** المقطع الأخير الذي يقع قبل الفهرس المعطى. */
function spanBefore(p: Parsed, index: number) {
  const list = p.spans.filter((s) => s.end < index);
  return list.length ? list[list.length - 1] : undefined;
}

const gap = (intended: CommandKind, missing: string, hint: string): CommandGap => ({
  kind: 'gap',
  intended,
  missing,
  hint,
});

/**
 * يحلّل جملة أمر تنفيذي. يرجّع:
 *   Command    — أمر مكتمل جاهز للمعاينة
 *   CommandGap — فهمنا نوع الأمر لكن ينقصه محدّد، فنسأل
 *   null       — ليست جملة أمر أصلاً (تُعامل كسؤال استعلام)
 */
export function parseCommand(input: string): CommandParse {
  if (!input || !input.trim()) return null;
  const p = dissect(input);
  const { roles } = p;

  const isAssign = hasRole(roles, 'verb_assign');
  const isRemove = hasRole(roles, 'verb_remove');
  const isBan = hasRole(roles, 'verb_ban');
  const isAllow = hasRole(roles, 'verb_allow');
  const isEnable = hasRole(roles, 'verb_enable');
  const isDisable = hasRole(roles, 'verb_disable');
  const isChange = hasRole(roles, 'verb_change');
  const anyVerb = isAssign || isRemove || isBan || isAllow || isEnable || isDisable || isChange;

  if (!anyVerb) return null;

  // ── 1) تفعيل/تعطيل شخص ───────────────────────────────────────────────────
  if ((isEnable || isDisable) && !hasRole(roles, 'a_fixed')) {
    const person = p.spans.map((s) => s.text).join(' ').trim();
    if (!person) return gap('set_person_status', 'person', 'اذكر اسم المستفيد. مثال: «عطّل أحمد العلي»');
    return { kind: 'set_person_status', person, active: isEnable };
  }

  // ── 2) تعديل حقل على شخص ─────────────────────────────────────────────────
  const fieldRole = hasRole(roles, 'f_villa') ? 'villa' : hasRole(roles, 'f_diet') ? 'diet_type' : hasRole(roles, 'f_notes') ? 'notes' : null;
  if (fieldRole && (isChange || isAssign)) {
    const fIdx = firstIndexOf(roles, fieldRole === 'villa' ? 'f_villa' : fieldRole === 'diet_type' ? 'f_diet' : 'f_notes');
    const toIdx = firstIndexOf(roles, 'a_to');

    // «غيّر فيلا أحمد إلى 3»: الشخص بعد اسم الحقل، والقيمة بعد «إلى»
    let value = '';
    if (toIdx > -1) {
      const after = p.words.slice(toIdx + 1).filter((_, k) => roles[toIdx + 1 + k] !== 'stop');
      value = after.join(' ').trim();
    } else if (p.quantity !== undefined) {
      value = String(p.quantity);
    }

    const personSpan = p.spans.find((s) => s.start > fIdx && (toIdx === -1 || s.end < toIdx)) ?? spanAfter(p, fIdx);
    const person = personSpan?.text ?? '';
    if (!person) return gap('set_person_field', 'person', 'اذكر اسم المستفيد. مثال: «غيّر فيلا أحمد العلي إلى 3»');
    if (!value) return gap('set_person_field', 'value', 'اذكر القيمة الجديدة بعد كلمة «إلى». مثال: «غيّر فيلا أحمد إلى 3»');
    return { kind: 'set_person_field', person, field: fieldRole, value };
  }

  // ── 3) قائمة الطعام ──────────────────────────────────────────────────────
  const menuish = hasRole(roles, 'a_menu') || (p.week !== undefined && p.mealType !== undefined);
  if (menuish && (isAssign || isRemove)) {
    const meal = p.spans.map((s) => s.text).join(' ').trim();
    if (!meal) return gap(isRemove ? 'remove_menu_item' : 'add_menu_item', 'meal', 'اذكر اسم الصنف. مثال: «أضف بيض لفطور السبت الأسبوع الثاني»');
    if (p.days.length === 0) return gap(isRemove ? 'remove_menu_item' : 'add_menu_item', 'day', 'اذكر اليوم. مثال: «… يوم السبت»');
    const week = p.week ?? 'current';
    if (isRemove) {
      return { kind: 'remove_menu_item', meal, week, days: p.days, mealType: p.mealType, entityType: p.entityType };
    }
    if (!p.mealType) return gap('add_menu_item', 'mealType', 'اذكر الوجبة (فطور / غداء / عشاء).');
    return {
      kind: 'add_menu_item',
      meal,
      week,
      days: p.days,
      mealType: p.mealType,
      entityType: p.entityType,
      category: p.category,
    };
  }

  // ── 4) صنف جديد ──────────────────────────────────────────────────────────
  if (isAssign && hasRole(roles, 'a_new') && hasRole(roles, 'a_mealnoun') && !hasRole(roles, 'a_fixed')) {
    const name = p.spans.map((s) => s.text).join(' ').trim();
    if (!name) return gap('create_meal', 'name', 'اذكر اسم الصنف الجديد. مثال: «أضف صنف جديد اسمه شوربة عدس غداء»');
    if (!p.mealType) return gap('create_meal', 'mealType', 'اذكر نوع الوجبة (فطور / غداء / عشاء).');
    return { kind: 'create_meal', name, mealType: p.mealType, category: p.category, entityType: p.entityType };
  }

  // ── 5) الأصناف الثابتة ───────────────────────────────────────────────────
  if (hasRole(roles, 'a_fixed')) {
    const fIdx = firstIndexOf(roles, 'a_fixed');
    const fromIdx = firstIndexOf(roles, 'a_from');

    // «عن فلان» تحسم الدور: ما بعدها شخص وما قبلها صنف.
    // بدونها: ما قبل كلمة «ثابت» شخص وما بعدها صنف.
    let personSpan: Span | undefined;
    let mealSpan: Span | undefined;
    if (fromIdx > -1) {
      personSpan = spanAfter(p, fromIdx);
      mealSpan = p.spans.find((s) => s !== personSpan && s.end < fromIdx);
    } else {
      personSpan = spanBefore(p, fIdx);
      const after = p.spans.filter((s) => s.start > fIdx);
      mealSpan = after[0];
      // «حط صنف ثابت بيض لأحمد»: الشخص جا متأخراً بسابقة «لـ»
      if (!personSpan && after.length >= 2 && startsWithLam(after[1].text)) {
        personSpan = after[1];
      }
    }

    const person = personSpan?.text ?? '';
    const meal = mealSpan?.text ?? '';

    if (isRemove) {
      if (!person) return gap('remove_fixed', 'person', 'اذكر اسم المستفيد.');
      if (!meal) return gap('remove_fixed', 'meal', 'اذكر اسم الصنف الثابت المراد حذفه.');
      return {
        kind: 'remove_fixed',
        person,
        meal,
        days: p.days.length ? p.days : undefined,
        mealType: p.mealType,
      };
    }

    if (!person) return gap('add_fixed', 'person', 'اذكر اسم المستفيد. مثال: «حط لأحمد العلي صنف ثابت بيض يوم السبت فطور»');
    if (!meal) return gap('add_fixed', 'meal', 'اذكر اسم الصنف الثابت.');
    if (p.days.length === 0) return gap('add_fixed', 'days', 'اذكر الأيام. مثال: «… يوم السبت والثلاثاء»');
    return {
      kind: 'add_fixed',
      person,
      meal,
      days: p.days,
      mealType: p.mealType,
      quantity: p.quantity ?? 1,
    };
  }

  // ── 6) الاستبدال: «خلّي فلان ياكل بيض بدل الفول» ──────────────────────────
  const substIdx = firstIndexOf(roles, 'a_subst');
  if (substIdx > -1 && (isAssign || isChange)) {
    const oldSpan = spanAfter(p, substIdx);
    const eatIdx = firstIndexOf(roles, 'a_eat');
    const newSpan = eatIdx > -1
      ? p.spans.find((s) => s.start > eatIdx && s.end < substIdx)
      : spanBefore(p, substIdx);
    const personSpan = p.spans.find((s) => s !== oldSpan && s !== newSpan);

    if (!oldSpan) return gap('set_exclusion', 'meal', 'اذكر الصنف الممنوع بعد كلمة «بدل». مثال: «… ياكل بيض بدل الفول»');
    if (!personSpan) return gap('set_exclusion', 'person', 'اذكر اسم المستفيد. مثال: «خلّي أحمد العلي ياكل بيض بدل الفول»');

    return {
      kind: 'set_exclusion',
      person: personSpan.text,
      meal: oldSpan.text,
      alternative: newSpan?.text,
    };
  }

  // ── 7) المنع بلا بديل: «امنع الفول عن أحمد» ──────────────────────────────
  if ((isBan && !isRemove && !isAllow) || (isAssign && hasRole(roles, 'a_banned'))) {
    const fromIdx = firstIndexOf(roles, 'a_from');
    const mealSpan = fromIdx > -1 ? spanBefore(p, fromIdx) : p.spans[0];
    const personSpan = fromIdx > -1 ? spanAfter(p, fromIdx) : p.spans[1];
    if (!mealSpan) return gap('set_exclusion', 'meal', 'اذكر الصنف الممنوع. مثال: «امنع الفول عن أحمد»');
    if (!personSpan) return gap('set_exclusion', 'person', 'اذكر اسم المستفيد بعد كلمة «عن». مثال: «امنع الفول عن أحمد»');
    return { kind: 'set_exclusion', person: personSpan.text, meal: mealSpan.text };
  }

  // ── 8) رفع المنع: «احذف منع الفول عن أحمد» / «اسمح لأحمد بالفول» ─────────
  if (isRemove || isAllow) {
    const fromIdx = firstIndexOf(roles, 'a_from');
    const mealSpan = fromIdx > -1 ? spanBefore(p, fromIdx) : p.spans[0];
    const personSpan = fromIdx > -1 ? spanAfter(p, fromIdx) : p.spans[1];
    if (!mealSpan || !personSpan) {
      return gap('clear_exclusion', 'person', 'حدّد الصنف والشخص. مثال: «احذف منع الفول عن أحمد العلي»');
    }
    return { kind: 'clear_exclusion', person: personSpan.text, meal: mealSpan.text };
  }

  return null;
}
