-- ============================================================================
-- Beneficiary Menu Overrides Migration
--
-- قرارات المستفيد على **خانة محددة** من المنيو (أسبوع + يوم + وجبة):
--   replace → يستبدل صنفاً أساسياً ببديل في هذه الخانة وحدها
--   remove  → يحذف صنفاً أساسياً من هذه الخانة وحدها (بلا بديل)
--   add     → يضيف صنفاً في هذه الخانة وحدها (بكمية، وقد يُحتسب مع البدائل)
--
-- الفرق عن الجدولين القديمين — وسبب وجود هذا الجدول:
--   • exclusions             : قرار **عام** للمستفيد (unique على meal_id) — ما
--                              يقدر يعطي بديلاً مختلفاً لنفس الصنف في يومين.
--   • beneficiary_fixed_meals: قرار **لكل يوم أسبوعي** بلا رقم أسبوع — الإضافة
--                              تتكرر في الأسابيع الأربعة.
--
-- الجدولان القديمان يبقيان كما هما ويعملان كما هما. عند التعارض في خانة
-- معيّنة، قرار هذا الجدول (الأخص) يتقدّم على المحظور العام.
--
-- ⚠️ أمان: أوامر التشغيل التي لا تحمل week_number (أوامر قديمة) لا تتأثر بهذا
-- الجدول أبداً — تُحسب بالمنطق القديم حرفياً. انظر lib/order-report.ts.
--
-- شغّله مرة واحدة في Supabase SQL Editor. آمن للتكرار (idempotent).
-- ============================================================================

create table if not exists public.beneficiary_menu_overrides (
  id uuid primary key default gen_random_uuid(),
  beneficiary_id uuid not null references public.beneficiaries(id) on delete cascade,

  -- الخانة: نفس مفتاح menu_items بالضبط
  week_number smallint not null check (week_number between 1 and 4),
  day_of_week smallint not null check (day_of_week between 0 and 6),
  meal_type   text     not null check (meal_type in ('breakfast', 'lunch', 'dinner')),

  action text not null check (action in ('replace', 'remove', 'add')),

  -- الصنف الأساسي في المنيو — مطلوب في replace/remove، ويكون null في add
  base_meal_id   uuid references public.meals(id) on delete cascade,
  -- الصنف البديل أو المضاف — مطلوب في replace/add، ويكون null في remove
  target_meal_id uuid references public.meals(id) on delete cascade,

  -- كمية الصنف المضاف (لا معنى لها في replace/remove)
  quantity smallint not null default 1 check (quantity between 1 and 99),
  -- الصنف المضاف يُحتسب في أمر التشغيل ضمن جدول الأصناف البديلة بدل الثابتة
  is_alternative boolean not null default false,

  created_at timestamptz not null default now(),

  -- كل حركة تحمل أعمدتها الصحيحة فقط — يمنع صفوفاً نصف مكتوبة تُفسد الحساب
  constraint beneficiary_menu_overrides_shape check (
    (action = 'replace' and base_meal_id is not null and target_meal_id is not null) or
    (action = 'remove'  and base_meal_id is not null and target_meal_id is null)     or
    (action = 'add'     and base_meal_id is null     and target_meal_id is not null)
  )
);

-- قرار واحد فقط لكل صنف أساسي في الخانة — ما يمكن تبديله وحذفه في نفس الوقت،
-- ولا تبديله ببديلين مختلفين.
create unique index if not exists beneficiary_menu_overrides_base_uniq
  on public.beneficiary_menu_overrides (beneficiary_id, week_number, day_of_week, meal_type, base_meal_id)
  where action in ('replace', 'remove');

-- الصنف المضاف ما يتكرر في نفس الخانة
create unique index if not exists beneficiary_menu_overrides_add_uniq
  on public.beneficiary_menu_overrides (beneficiary_id, week_number, day_of_week, meal_type, target_meal_id)
  where action = 'add';

-- قراءة أمر التشغيل تجلب قرارات كل المستفيدين لخانة واحدة
create index if not exists beneficiary_menu_overrides_slot_idx
  on public.beneficiary_menu_overrides (week_number, day_of_week, meal_type);

-- وشاشة المستفيد تجلب كل قرارات مستفيد واحد
create index if not exists beneficiary_menu_overrides_ben_idx
  on public.beneficiary_menu_overrides (beneficiary_id);

alter table public.beneficiary_menu_overrides enable row level security;

drop policy if exists "Authenticated users full access - beneficiary_menu_overrides"
  on public.beneficiary_menu_overrides;
create policy "Authenticated users full access - beneficiary_menu_overrides"
  on public.beneficiary_menu_overrides for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
