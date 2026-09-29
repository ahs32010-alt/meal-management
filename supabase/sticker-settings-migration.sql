-- ============================================================================
-- Sticker Settings Migration — إعدادات ستيكرات الغداء والعشاء المشتركة
--
-- صفّ واحد (id = 1) يحفظ لكل المستخدمين:
--   • diet_order       — ترتيب الأنظمة الغذائية الذي تُفرز به الستيكرات
--                        (كان محفوظاً في متصفح كل مستخدم على حدة)
--   • show_diet_order  — إظهار قسم «ترتيب الأنظمة الغذائية» في صفحة الستيكرات؛
--                        عند false يُخفى القسم ويُعدَّل الترتيب من الإعدادات فقط
--
-- ⚠️ آمن للتشغيل أكثر من مرة. لا يمسّ أي بيانات موجودة.
-- شغّله مرة واحدة في Supabase SQL Editor.
-- ============================================================================

create table if not exists public.sticker_settings (
  id              smallint primary key default 1 check (id = 1),
  diet_order      text[] not null default '{}',
  show_diet_order boolean not null default true,
  updated_at      timestamptz not null default now()
);

insert into public.sticker_settings (id) values (1) on conflict (id) do nothing;

alter table public.sticker_settings enable row level security;
drop policy if exists "Authenticated users full access - sticker_settings" on public.sticker_settings;
create policy "Authenticated users full access - sticker_settings"
  on public.sticker_settings for all to authenticated using (true) with check (true);
