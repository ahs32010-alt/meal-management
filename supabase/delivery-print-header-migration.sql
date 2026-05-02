-- ============================================================================
-- Delivery Print Header Migration
-- شغّل هذا الملف بعد delivery-meals-migration.sql
--
-- يضيف جدولاً ذا صفّ واحد فقط (single-row) يحتوي بيانات هيدر طباعة أمر التسليم:
--   - معلومات الشركة (يسار الهيدر)
--   - رابط الشعار (وسط الهيدر — يُرفع لـstorage signatures bucket)
--   - عنوان الورقة (يمين الهيدر)
--
-- التقييد `id = 1` يضمن أنه لا يوجد سوى صفّ واحد دائماً، فنحدّث بالـUPSERT.
-- ============================================================================

create table if not exists public.delivery_print_header (
  id smallint primary key default 1 check (id = 1),
  company_name_en text default 'Rawabi Alsham Co.',
  company_name_ar text default 'شركة مطاعم إطلالة روابي الشام',
  address_line1 text default 'Al Adama Dist.- P.Code 3145 - Dammam',
  address_line2 text default 'Dammam, Saudi Arabia',
  cr_number text default '2050039158',
  vat_number text default '300518401800003',
  logo_url text,
  title_ar text default 'أمر تسليم',
  title_en text default 'Delivery Note',
  updated_at timestamptz not null default timezone('utc', now())
);

-- ضمان وجود الصفّ الأوّل بالقيم الافتراضية
insert into public.delivery_print_header (id) values (1) on conflict (id) do nothing;

-- Trigger لتحديث updated_at تلقائياً
create or replace function public.delivery_print_header_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_delivery_print_header_updated_at on public.delivery_print_header;
create trigger trg_delivery_print_header_updated_at
  before update on public.delivery_print_header
  for each row execute function public.delivery_print_header_set_updated_at();

-- RLS — قراءة لكل authenticated، تعديل من السيرفر باستخدام نفس الـauth
alter table public.delivery_print_header enable row level security;

drop policy if exists "Authenticated users full access - delivery_print_header" on public.delivery_print_header;
create policy "Authenticated users full access - delivery_print_header"
  on public.delivery_print_header for all using (auth.role() = 'authenticated');
