-- ============================================================================
-- Lunch & Dinner Sticker — Diet Colors Migration
-- يحفظ لون كل نظام غذائي (diet_type) المستخدم لتلوين ستيكرات الغداء والعشاء.
-- صفّ لكل نظام: diet_type (مفتاح) + color (hex). يبقى محفوظاً دائماً حتى يُغيَّر/يُحذف.
-- ============================================================================

create table if not exists public.lunch_dinner_diet_colors (
  diet_type text primary key,
  color text not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.lunch_dinner_diet_colors enable row level security;

drop policy if exists "Authenticated full access - ld_diet_colors" on public.lunch_dinner_diet_colors;
create policy "Authenticated full access - ld_diet_colors"
  on public.lunch_dinner_diet_colors for all using (auth.role() = 'authenticated');
