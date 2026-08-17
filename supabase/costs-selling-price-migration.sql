-- ============================================================================
-- Costs Selling Price Migration — أسعار بيع الأصناف
-- شغّل هذا الملف بعد costs-units-migration.sql
--
-- جدول مستقل عن `meals` بدل عمود إضافي عليه: التسعير شأن صفحة الأسعار
-- والتكاليف، وفصله يبقي جدول الأصناف نظيفاً ويسمح بصلاحيات مختلفة لاحقاً.
--
-- المعادلات (انظر lib/costs.ts — نفس الحساب بالضبط):
--   الربح للحصة    = سعر البيع − تكلفة الحصة
--   نسبة الهامش %  = الربح ÷ سعر البيع × 100
--   نسبة التكلفة % = التكلفة ÷ سعر البيع × 100      (مكمّلة للهامش)
-- ============================================================================

create table if not exists public.meal_pricing (
  meal_id uuid primary key references public.meals(id) on delete cascade,
  -- 4 خانات عشرية اتساقاً مع أسعار المواد وتكلفة الحصة
  selling_price numeric(14, 4) not null default 0 check (selling_price >= 0),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists meal_pricing_touch_updated_at on public.meal_pricing;
create trigger meal_pricing_touch_updated_at
  before update on public.meal_pricing
  for each row execute function public.costs_touch_updated_at();

alter table public.meal_pricing enable row level security;

drop policy if exists "Authenticated users full access - meal_pricing" on public.meal_pricing;
create policy "Authenticated users full access - meal_pricing"
  on public.meal_pricing for all using (auth.role() = 'authenticated');
