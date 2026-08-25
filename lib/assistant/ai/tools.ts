/**
 * الأدوات التي يستدعيها Claude.
 *
 * القاعدة الحاكمة: **الأدوات هنا للقراءة فقط**. أي تعديل على البيانات يمر
 * حصراً عبر `propose_change` التي لا تكتب شيئاً — تبني خطة بالمحرّك الحالي
 * (runTurn) وترجّعها للمعاينة، ثم ينتظر المستخدم ويؤكّد، فينفّذ مسار
 * `/api/assistant/execute` القديم بكل ما فيه من فحص صلاحيات وتراجع وسجل نشاط.
 *
 * فلو أخطأ النموذج أو حاول أحد التلاعب بمخرجاته، أقصى ما يصل إليه هو اقتراح
 * يظهر على الشاشة — لا كتابة بلا ضغطة المستخدم.
 *
 * والعميل الممرَّر هنا هو عميل المستخدم نفسه (RLS)، لا مفتاح خدمة، فما يقرأه
 * النموذج محدود بما يقرأه المستخدم أصلاً.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { runTurn } from '@/lib/assistant/plan';
import type { Plan } from '@/lib/assistant/plan';
import { PAGE_CATALOG } from '@/lib/assistant/pages';
import { buildOrderReport } from '@/lib/order-report';
import { todayISO } from '@/lib/date-utils';
import { MEAL_TYPE_LABELS, DAY_LABELS, CATEGORY_LABELS } from '@/lib/types';
import { validateToolInput } from './schema';

/**
 * أعمدة أمر التشغيل بلا `snapshot`.
 *
 * اللقطة ٨٢ كيلوبايت للأمر الواحد — فـ`select('*')` على ١٥ أمراً كان ينقل
 * ١.٢ ميجابايت ويحشرها في سياق النموذج بلا فائدة. من يحتاجها يقرأها وحدها.
 */
const ORDER_COLS = 'id, date, meal_type, created_at, week_number, snapshot_at, day_of_week, entity_type';

/** حدّ أعلى للصفوف في أي أداة — سقف تكلفة قبل أن يكون سقف أداء. */
const MAX_ROWS = 40;

const clampLimit = (n: unknown, fallback: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.min(Math.max(v, 1), MAX_ROWS);
};

/** نتيجة أداة: إمّا بيانات يُكمل بها النموذج، أو مخرَج جانبي يوقف الحلقة. */
export type ToolOutcome =
  | { kind: 'data'; data: unknown }
  | { kind: 'plan'; plan: Plan; commandText: string }
  | { kind: 'navigate'; href: string; label: string; permission: string | null };

// ── تعريفات الأدوات المرسَلة للنموذج ────────────────────────────────────────

export const TOOL_DEFS = [
  {
    name: 'search_people',
    description:
      'ابحث عن مستفيدين أو مرافقين بالاسم أو الكود أو الفيلا. استخدمها أولاً كلما ذكر المستخدم شخصاً، ' +
      'لأن الأسماء تُكتب بإملاءات مختلفة. ترجّع قائمة مختصرة — استخدم get_person للتفاصيل.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'جزء من الاسم أو الكود أو الفيلا. اتركه فارغاً لجلب أول النتائج.' },
        entity_type: { type: 'string', enum: ['beneficiary', 'companion'], description: 'نوع الشخص' },
        active_only: { type: 'boolean', description: 'النشطون فقط (الافتراضي: الجميع)' },
        limit: { type: 'integer', description: 'عدد النتائج (حتى 40، الافتراضي 15)' },
      },
      required: [],
    },
  },
  {
    name: 'get_person',
    description:
      'بطاقة شخص كاملة: بياناته، الأصناف الممنوعة عليه مع بدائلها، وأصنافه الثابتة. ' +
      'مرّر المعرّف (id) الذي رجّعته search_people.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'معرّف الشخص (UUID)' } },
      required: ['id'],
    },
  },
  {
    name: 'search_meals',
    description: 'ابحث عن أصناف بالاسم. استخدمها كلما ذكر المستخدم صنفاً لتتأكد من اسمه ومعرّفه.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'جزء من اسم الصنف' },
        type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'], description: 'نوع الوجبة' },
        limit: { type: 'integer', description: 'عدد النتائج (حتى 40، الافتراضي 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_menu',
    description:
      'قائمة الطعام الدورية (٤ أسابيع × ٧ أيام). ضيّق بالأسبوع واليوم ونوع الوجبة قدر ما تستطيع ' +
      'حتى لا ترجع القائمة كاملة.',
    input_schema: {
      type: 'object',
      properties: {
        week_number: { type: 'integer', description: 'رقم الأسبوع 1–4' },
        day_of_week: { type: 'integer', description: 'اليوم 0=الأحد … 6=السبت' },
        meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] },
      },
      required: [],
    },
  },
  {
    name: 'list_orders',
    description: 'أوامر التشغيل، الأحدث أولاً. استخدمها لإيجاد معرّف أمر قبل get_order.',
    input_schema: {
      type: 'object',
      properties: {
        meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] },
        from_date: { type: 'string', description: 'من تاريخ YYYY-MM-DD' },
        to_date: { type: 'string', description: 'إلى تاريخ YYYY-MM-DD' },
        limit: { type: 'integer', description: 'العدد (حتى 40، الافتراضي 15)' },
      },
      required: [],
    },
  },
  {
    name: 'get_order',
    description: 'تفاصيل أمر تشغيل واحد مع أصنافه وكمياتها.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'معرّف الأمر (UUID)' } },
      required: ['id'],
    },
  },
  {
    name: 'count_people',
    description:
      'إحصاء وتوزيع الأشخاص. بلا group_by يرجّع العدد فقط؛ ومعه يرجّع التوزيع حسب الفيلا أو ' +
      'النظام الغذائي أو الفئة. أرخص وأدق من جلب الصفوف وعدّها بنفسك.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: ['beneficiary', 'companion'] },
        active_only: { type: 'boolean' },
        group_by: { type: 'string', enum: ['villa', 'diet_type', 'category'] },
      },
      required: [],
    },
  },
  {
    name: 'list_fixed_meals',
    description:
      'الأصناف الثابتة: من عنده صنف يُصرف له دائماً بغضّ النظر عن القائمة، وأي يوم ووجبة وكمية. ' +
      'بلا فلاتر ترجّع كل من عنده أصناف ثابتة. استخدمها لأسئلة مثل «مين عنده وجبات ثابتة؟».',
    input_schema: {
      type: 'object',
      properties: {
        person: { type: 'string', description: 'تصفية باسم الشخص أو كوده' },
        meal: { type: 'string', description: 'تصفية باسم الصنف' },
        day_of_week: { type: 'integer', description: 'اليوم 0=الأحد … 6=السبت' },
        meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] },
        entity_type: { type: 'string', enum: ['beneficiary', 'companion'] },
        limit: { type: 'integer', description: 'عدد الصفوف (حتى 40، الافتراضي 25)' },
      },
      required: [],
    },
  },
  {
    name: 'order_summary',
    description:
      'ملخص أمر التشغيل ليوم ووجبة: كميات كل صنف، والأصناف **البديلة** المطلوبة وكمياتها، ' +
      'والأصناف الثابتة. الأرقام هنا هي نفسها المطبوعة في تقرير الأمر — لا تحسبها بنفسك. ' +
      'استخدمها لأسئلة مثل «ملخص تشغيل اليوم» و«كم نحتاج وجبة بديلة؟». ' +
      'بلا تاريخ تستخدم تاريخ اليوم.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'التاريخ YYYY-MM-DD (الافتراضي: اليوم)' },
        meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner'] },
        entity_type: { type: 'string', enum: ['beneficiary', 'companion'] },
      },
      required: [],
    },
  },
  {
    name: 'list_pages',
    description: 'صفحات النظام ومساراتها — استخدمها قبل open_page لو ما كنت متأكداً من المسار.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'propose_change',
    description:
      'اقترح تعديلاً على البيانات. **لا ينفّذ شيئاً** — يبني معاينة تُعرض على المستخدم وينتظر ' +
      'تأكيده. استدعها فقط بعدما تتأكد من أسماء الأشخاص والأصناف عبر أدوات البحث.\n\n' +
      'الأمر يُكتب بالعربية بصيغة قياسية. الأنماط المدعومة:\n' +
      '• منع/بديل: «امنع أحمد من الفول» · «خلّي أحمد ياكل بيض بدل الفول» · «اسمح لأحمد بالفول»\n' +
      '• صنف ثابت: «حط لأحمد بيض ثابت» · «احذف الصنف الثابت بيض من أحمد»\n' +
      '• حقول الشخص: «غيّر فيلا أحمد إلى ٣» · «غيّر نظام أحمد الغذائي إلى حمية»\n' +
      '• الحالة: «عطّل أحمد» · «فعّل أحمد»\n' +
      '• القائمة: «أضف بيض لفطور السبت الأسبوع الثاني» · «احذف البيض من فطور السبت الأسبوع الثاني»\n' +
      '• المضاعف: «ضاعف البيض ×2 فطور السبت الأسبوع الثاني»\n' +
      '• الأصناف: «أضف صنف جديد اسمه شوفان فطور» · «احذف صنف الشوفان»\n' +
      '• الأشخاص: «أضف مستفيد اسمه خالد كود 55» · «احذف المستفيد خالد»\n' +
      '• أوامر التشغيل: «أنشئ أمر تشغيل غداء بكرة» · «احذف أمر تشغيل الغداء بكرة» · ' +
      '«أضف رز لأمر تشغيل الغداء بكرة» · «احذف الرز من أمر تشغيل الغداء بكرة»\n' +
      '  اليوم يُكتب «اليوم» أو «بكرة» أو تاريخاً مثل 2026-08-21. وللمرافقين أضف كلمة «المرافقين».\n\n' +
      '**صِغ الأمر بالصيغة أعلاه حرفياً مهما كانت صياغة المستخدم.** «جهّز/سوّ/اعمل/رتّب أمر ' +
      'تشغيل الغداء لبكرة» كلها تُكتب هنا «أنشئ أمر تشغيل غداء بكرة» — المحلّل يعرف أفعالاً ' +
      'محدودة، وترجمة كلام المستخدم إليها **شغلك أنت**.\n' +
      'ولو أراد المستخدم إنشاء أمر تشغيل، لا تكتفِ بعرض ملخّصه: order_summary تقرأ أمراً ' +
      'قائماً، وpropose_change تقترح إنشاء أمر جديد. اقرأ أولاً لو شككت أنه موجود، ثم اقترح.\n\n' +
      'لو رجّعت الأداة أن الصيغة غير مفهومة أو ناقصة، أعد الصياغة بأقرب نمط أعلاه وحاول مرة ثانية. ' +
      'لا تخترع أنماطاً غير مذكورة.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'الأمر بالعربية بصيغة قياسية كما في الأنماط أعلاه' },
      },
      required: ['command'],
    },
  },
  {
    name: 'open_page',
    description: 'انقل المستخدم إلى صفحة في النظام. استدعها فقط لو طلب ذلك صراحة.',
    input_schema: {
      type: 'object',
      properties: { href: { type: 'string', description: 'المسار، مثل /reports' } },
      required: ['href'],
    },
  },
] as const;

// ── التنفيذ ────────────────────────────────────────────────────────────────

type Args = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** بحث نصّي آمن — نهرب `%` و `_` و `,` حتى لا يكسر المستخدمُ نمطَ ilike. */
const likeSafe = (q: string) => q.replace(/[%_,]/g, (c) => '\\' + c);

/**
 * علاقة many-to-one في supabase-js تُكتَب نوعياً كمصفوفة وتصل وقت التشغيل ككائن.
 * نوحّدها هنا بدل تكرار الحيلة في كل استدعاء.
 */
function rel<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return (v as T) ?? null;
}

async function selectPeople(supabase: SupabaseClient, args: Args) {
  let q = supabase.from('beneficiaries').select('*');
  const entity = str(args.entity_type);
  if (entity) q = q.eq('entity_type', entity);
  if (args.active_only === true) q = q.eq('is_active', true);
  const { data, error } = await q;
  // العمود قد لا يكون موجوداً لو ما اتشغّل الـmigration الاختياري — نعيد بلا فلتر
  if (error && /column|schema cache/i.test(error.message)) {
    const retry = await supabase.from('beneficiaries').select('*');
    return { rows: (retry.data ?? []) as Array<Record<string, unknown>>, degraded: true };
  }
  return { rows: (data ?? []) as Array<Record<string, unknown>>, degraded: false };
}

export async function runTool(
  supabase: SupabaseClient,
  name: string,
  rawArgs: Args,
): Promise<ToolOutcome> {
  // بوّابة واحدة لكل المزوّدين: لا تصل أي أداة معاملاتٍ لم تُفحَص.
  // الفشل يرجع للنموذج كبيانات لا كاستثناء، فيصحّح نفسه في الدورة التالية.
  const checked = validateToolInput(name, rawArgs);
  if (!checked.ok) {
    return {
      kind: 'data',
      data: {
        invalid_arguments: true,
        error: checked.error,
        hint: 'راجع وصف الأداة وأعد النداء بمعاملات مطابقة لمخططها.',
      },
    };
  }
  const args = checked.args as Args;

  switch (name) {
    case 'search_people': {
      const { rows } = await selectPeople(supabase, args);
      const query = str(args.query)?.toLowerCase();
      const matched = query
        ? rows.filter((r) =>
            ['name', 'english_name', 'code', 'villa'].some((k) =>
              String(r[k] ?? '').toLowerCase().includes(query),
            ),
          )
        : rows;
      const limit = clampLimit(args.limit, 15);
      return {
        kind: 'data',
        data: {
          total_matched: matched.length,
          showing: Math.min(matched.length, limit),
          people: matched.slice(0, limit).map((r) => ({
            id: r.id,
            name: r.name,
            code: r.code,
            villa: r.villa ?? null,
            diet_type: r.diet_type ?? null,
            entity_type: r.entity_type ?? 'beneficiary',
            is_active: r.is_active ?? true,
          })),
        },
      };
    }

    case 'get_person': {
      const id = str(args.id);
      if (!id) return { kind: 'data', data: { error: 'المعرّف مفقود' } };

      const [personRes, exclRes, fixedRes] = await Promise.all([
        supabase.from('beneficiaries').select('*').eq('id', id).maybeSingle(),
        supabase.from('exclusions').select('meal_id, meals(id, name, type)').eq('beneficiary_id', id),
        supabase
          .from('beneficiary_fixed_meals')
          .select('*, meals(id, name, type)')
          .eq('beneficiary_id', id),
      ]);
      if (!personRes.data) return { kind: 'data', data: { error: 'ما لقيت شخصاً بهذا المعرّف' } };

      const excluded = ((exclRes.data ?? []) as Array<Record<string, unknown>>).map((e) => ({
        meal_id: String(e.meal_id),
        meal: rel<{ name: string }>(e.meals),
      }));
      // البدائل تُحلّ لكل صنف ممنوع حتى يعرف النموذج ماذا يأكل الشخص بدلاً منه
      const altRes = excluded.length
        ? await supabase
            .from('meal_alternatives')
            .select('meal_id, alternative_id, alt:meals!meal_alternatives_alternative_id_fkey(id, name)')
            .in('meal_id', excluded.map((e) => e.meal_id))
        : { data: [] };
      const altByMeal = new Map<string, string[]>();
      for (const row of (altRes.data ?? []) as Array<Record<string, unknown>>) {
        const mealId = String(row.meal_id);
        const alt = rel<{ name: string }>(row.alt);
        const list = altByMeal.get(mealId) ?? [];
        if (alt?.name) list.push(alt.name);
        altByMeal.set(mealId, list);
      }

      return {
        kind: 'data',
        data: {
          person: personRes.data,
          excluded_meals: excluded.map((e) => ({
            meal: e.meal?.name ?? null,
            alternatives: altByMeal.get(e.meal_id) ?? [],
          })),
          fixed_meals: ((fixedRes.data ?? []) as Array<Record<string, unknown>>).map((f) => ({
            meal: rel<{ name: string }>(f.meals)?.name ?? null,
            quantity: f.quantity ?? 1,
            category: f.category ? CATEGORY_LABELS[f.category as 'hot' | 'cold' | 'snack'] : null,
          })),
        },
      };
    }

    case 'search_meals': {
      let q = supabase.from('meals').select('*');
      const type = str(args.type);
      if (type) q = q.eq('type', type);
      const query = str(args.query);
      if (query) q = q.ilike('name', `%${likeSafe(query)}%`);
      const { data } = await q.limit(clampLimit(args.limit, 20));
      return { kind: 'data', data: { meals: data ?? [] } };
    }

    case 'get_menu': {
      let q = supabase.from('menu_items').select('*, meals(id, name, type)');
      if (typeof args.week_number === 'number') q = q.eq('week_number', args.week_number);
      if (typeof args.day_of_week === 'number') q = q.eq('day_of_week', args.day_of_week);
      const mt = str(args.meal_type);
      if (mt) q = q.eq('meal_type', mt);
      const { data } = await q.order('position').limit(200);
      return {
        kind: 'data',
        data: {
          items: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
            week: r.week_number,
            day: DAY_LABELS[r.day_of_week as number] ?? r.day_of_week,
            meal_type: MEAL_TYPE_LABELS[r.meal_type as 'breakfast'] ?? r.meal_type,
            meal: rel<{ name: string }>(r.meals)?.name ?? null,
            category: r.category ? CATEGORY_LABELS[r.category as 'hot' | 'cold' | 'snack'] : null,
            multiplier: r.multiplier ?? 1,
          })),
        },
      };
    }

    case 'list_orders': {
      let q = supabase.from('daily_orders').select(ORDER_COLS);
      const mt = str(args.meal_type);
      if (mt) q = q.eq('meal_type', mt);
      const from = str(args.from_date);
      const to = str(args.to_date);
      if (from) q = q.gte('date', from);
      if (to) q = q.lte('date', to);
      const { data } = await q.order('date', { ascending: false }).limit(clampLimit(args.limit, 15));
      return { kind: 'data', data: { orders: data ?? [] } };
    }

    case 'get_order': {
      const id = str(args.id);
      if (!id) return { kind: 'data', data: { error: 'المعرّف مفقود' } };
      const [orderRes, itemsRes] = await Promise.all([
        supabase.from('daily_orders').select(ORDER_COLS).eq('id', id).maybeSingle(),
        supabase.from('order_items').select('*, meals(id, name, type)').eq('order_id', id),
      ]);
      if (!orderRes.data) return { kind: 'data', data: { error: 'ما لقيت أمراً بهذا المعرّف' } };
      return {
        kind: 'data',
        data: {
          order: orderRes.data,
          items: ((itemsRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
            meal: rel<{ name: string }>(r.meals)?.name ?? null,
            quantity: r.quantity ?? null,
            multiplier: r.multiplier ?? 1,
          })),
        },
      };
    }

    case 'count_people': {
      const { rows } = await selectPeople(supabase, args);
      const groupBy = str(args.group_by);
      if (!groupBy) return { kind: 'data', data: { count: rows.length } };
      const tally: Record<string, number> = {};
      for (const r of rows) {
        const key = String(r[groupBy] ?? '').trim() || '(غير محدّد)';
        tally[key] = (tally[key] ?? 0) + 1;
      }
      return {
        kind: 'data',
        data: {
          count: rows.length,
          grouped_by: groupBy,
          groups: Object.entries(tally)
            .sort((a, b) => b[1] - a[1])
            .map(([key, count]) => ({ key, count })),
        },
      };
    }

    case 'list_fixed_meals': {
      // العمودان category/is_alternative اختياريان (migrations لاحقة) — نجرّب
      // بهما ثم نسقط بدونهما بدل أن تنهار الأداة على قاعدة لم تُرقَّ.
      const select = (withCategory: boolean) =>
        supabase
          .from('beneficiary_fixed_meals')
          .select(
            `beneficiary_id, meal_id, day_of_week, meal_type, quantity${withCategory ? ', category' : ''}, ` +
              'beneficiaries(id, name, code, villa, entity_type, is_active), meals(id, name, type)',
          );

      let res = await select(true);
      if (res.error && /column|schema cache/i.test(res.error.message)) res = await select(false);
      if (res.error) return { kind: 'data', data: { error: 'تعذّرت قراءة الأصناف الثابتة' } };

      const day = typeof args.day_of_week === 'number' ? args.day_of_week : undefined;
      const wantedMealType = str(args.meal_type);
      const wantedEntity = str(args.entity_type);
      const personQuery = str(args.person)?.toLowerCase();
      const mealQuery = str(args.meal)?.toLowerCase();

      const rows = ((res.data ?? []) as unknown as Array<Record<string, unknown>>)
        .map((r) => ({
          person: rel<{ name: string; code: string | null; villa: string | null; entity_type: string | null; is_active: boolean | null }>(r.beneficiaries),
          meal: rel<{ name: string; type: string | null }>(r.meals),
          day_of_week: r.day_of_week as number,
          meal_type: r.meal_type as string,
          quantity: (r.quantity as number) ?? 1,
          category: r.category as string | null,
        }))
        .filter((r) => r.person && r.meal)
        .filter((r) => (day === undefined ? true : r.day_of_week === day))
        .filter((r) => (wantedMealType ? r.meal_type === wantedMealType : true))
        .filter((r) =>
          wantedEntity ? (r.person!.entity_type ?? 'beneficiary') === wantedEntity : true,
        )
        .filter((r) =>
          personQuery
            ? [r.person!.name, r.person!.code].some((v) =>
                String(v ?? '').toLowerCase().includes(personQuery),
              )
            : true,
        )
        .filter((r) => (mealQuery ? r.meal!.name.toLowerCase().includes(mealQuery) : true));

      const limit = clampLimit(args.limit, 25);
      const people = new Set(rows.map((r) => r.person!.name));

      return {
        kind: 'data',
        data: {
          total_rows: rows.length,
          distinct_people: people.size,
          showing: Math.min(rows.length, limit),
          fixed_meals: rows.slice(0, limit).map((r) => ({
            person: r.person!.name,
            code: r.person!.code ?? null,
            villa: r.person!.villa ?? null,
            entity_type: r.person!.entity_type ?? 'beneficiary',
            is_active: r.person!.is_active ?? true,
            meal: r.meal!.name,
            day: DAY_LABELS[r.day_of_week] ?? r.day_of_week,
            meal_type: MEAL_TYPE_LABELS[r.meal_type as 'breakfast'] ?? r.meal_type,
            quantity: r.quantity,
            category: r.category ? CATEGORY_LABELS[r.category as 'hot' | 'cold' | 'snack'] : null,
          })),
        },
      };
    }

    case 'order_summary': {
      const date = str(args.date) ?? todayISO();
      let q = supabase.from('daily_orders').select('id, date, meal_type, entity_type').eq('date', date);
      const mt = str(args.meal_type);
      if (mt) q = q.eq('meal_type', mt);
      const { data: orders, error } = await q;
      if (error) return { kind: 'data', data: { error: 'تعذّرت قراءة أوامر التشغيل' } };

      const wantedEntity = str(args.entity_type);
      const matched = ((orders ?? []) as Array<Record<string, unknown>>).filter((o) =>
        wantedEntity ? ((o.entity_type as string) ?? 'beneficiary') === wantedEntity : true,
      );

      if (matched.length === 0) {
        return {
          kind: 'data',
          data: { date, orders: [], note: 'ما فيه أمر تشغيل محفوظ لهذا اليوم بهذه المواصفات.' },
        };
      }

      // نمرّ على نفس الدالة التي يبني بها النظام تقرير الأمر المطبوع — فالأرقام
      // التي يقولها المساعد هي حرفياً أرقام المطبخ، لا حساباً موازياً.
      const summaries = await Promise.all(
        matched.map(async (o) => {
          const report = await buildOrderReport(supabase, String(o.id));
          if (!report) {
            return {
              meal_type: MEAL_TYPE_LABELS[o.meal_type as 'breakfast'] ?? o.meal_type,
              entity_type: (o.entity_type as string) ?? 'beneficiary',
              empty: true,
            };
          }
          const named = (list: unknown) =>
            ((list ?? []) as Array<{ meal?: { name?: string }; qty?: number; gets?: number }>)
              .filter((x) => x.meal?.name)
              .map((x) => ({ meal: x.meal!.name!, quantity: x.gets ?? x.qty ?? 0 }));

          const alternatives = [
            ...named((report as Record<string, unknown>).altSummary),
            ...named((report as Record<string, unknown>).snackAltSummary),
          ];

          return {
            meal_type: MEAL_TYPE_LABELS[o.meal_type as 'breakfast'] ?? o.meal_type,
            entity_type: (o.entity_type as string) ?? 'beneficiary',
            people_count: ((report as Record<string, unknown>).beneficiaryDetails as unknown[] | undefined)?.length ?? 0,
            main_meals: named((report as Record<string, unknown>).mainMealsSummary),
            snacks: named((report as Record<string, unknown>).snackMealsSummary),
            alternatives,
            alternatives_total: alternatives.reduce((sum, a) => sum + a.quantity, 0),
            fixed_meals: named((report as Record<string, unknown>).fixedSummary),
          };
        }),
      );

      return { kind: 'data', data: { date, orders: summaries } };
    }

    case 'list_pages':
      return {
        kind: 'data',
        data: { pages: PAGE_CATALOG.map((p) => ({ label: p.label, href: p.href })) },
      };

    case 'open_page': {
      const href = str(args.href);
      const page = PAGE_CATALOG.find((p) => p.href === href);
      if (!page) return { kind: 'data', data: { error: 'ما فيه صفحة بهذا المسار. استدعِ list_pages.' } };
      return { kind: 'navigate', href: page.href, label: page.label, permission: page.permission };
    }

    case 'propose_change': {
      const command = str(args.command);
      if (!command) return { kind: 'data', data: { error: 'نص الأمر مفقود' } };

      // نمرّ بنفس الدالة التي يستخدمها مسار التنفيذ، وبلا سياق حواري — فتوقيع
      // الخطة هنا يطابق ما سيُعاد اشتقاقه عند التأكيد. أي اختلاف يوقف التنفيذ.
      const turn = await runTurn(supabase, { text: command });

      if (turn.kind === 'plan') return { kind: 'plan', plan: turn.plan, commandText: command };
      if (turn.kind === 'navigate') {
        return { kind: 'navigate', href: turn.href, label: turn.label, permission: turn.permission };
      }
      // ما نجح — نرجّع السبب للنموذج ليعيد الصياغة بدل أن نفشل أمام المستخدم
      if (turn.kind === 'ask') {
        return {
          kind: 'data',
          data: {
            not_planned: true,
            reason: `الأمر ناقص: ${turn.question}`,
            hint: 'أعد كتابة الأمر كاملاً مع المعلومة الناقصة بدل تركها للحوار.',
          },
        };
      }
      if (turn.kind === 'problem') {
        return {
          kind: 'data',
          data: { not_planned: true, reason: turn.problem.summary, options: turn.problem.options ?? [] },
        };
      }
      return {
        kind: 'data',
        data: {
          not_planned: true,
          reason: 'الصيغة ما تطابق أي نمط أمر مدعوم — قُرئت كسؤال لا كأمر.',
          hint: 'راجع الأنماط في وصف الأداة وأعد الصياغة بأقربها حرفياً.',
        },
      };
    }

    default:
      return { kind: 'data', data: { error: `أداة غير معروفة: ${name}` } };
  }
}
