-- ============================================================================
-- Telegram Bot Migration
-- ربط حسابات النظام بمحادثات تليقرام، وحفظ حالة الحوار والخطط المعلّقة.
--
-- كل هذه الجداول تُقرأ وتُكتب من الخادم بمفتاح الخدمة فقط (المسارات تحت
-- /api/telegram). ولذلك RLS مفعّلة بلا أي سياسة سماح: العميل المتصفّح لا يصل
-- إليها إطلاقاً، ومفتاح الخدمة يتجاوز RLS بطبيعته.
-- ============================================================================

-- ── الربط: محادثة تليقرام ← مستخدم النظام ───────────────────────────────────
-- المفتاح هو chat_id لأن كل محادثة تتكلم بصوت مستخدم واحد. والمستخدم الواحد
-- يجوز أن يربط أكثر من محادثة (جواله وجهازه اللوحي) فلا قيد فريد على user_id.
create table if not exists public.telegram_links (
  chat_id            bigint primary key,
  user_id            uuid not null references public.app_users(id) on delete cascade,
  telegram_username  text,
  telegram_name      text,
  linked_at          timestamptz not null default now(),
  last_seen_at       timestamptz
);

create index if not exists telegram_links_user_idx on public.telegram_links(user_id);

-- ── أكواد الربط: تُولَّد من صفحة الإعدادات وتُستهلك مرة واحدة ────────────────
create table if not exists public.telegram_link_codes (
  code            text primary key,
  user_id         uuid not null references public.app_users(id) on delete cascade,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  used_by_chat_id bigint
);

create index if not exists telegram_link_codes_user_idx on public.telegram_link_codes(user_id);
create index if not exists telegram_link_codes_expiry_idx on public.telegram_link_codes(expires_at);

-- ── حالة الحوار: الخادم بلا حالة، وتليقرام لا يحمل التاريخ عنّا ─────────────
-- في الويب يعيد المتصفح إرسال الحوار مع كل طلب. تليقرام لا يفعل، فنحفظه هنا.
-- والتاريخ موسوم بمزوّده لأن شكل رسائل Claude لا يُمرَّر لـGemini والعكس.
create table if not exists public.telegram_sessions (
  chat_id          bigint primary key,
  history          jsonb not null default '[]'::jsonb,
  history_provider text,
  updated_at       timestamptz not null default now()
);

-- ── الخطط المعلّقة وأزرار التراجع ────────────────────────────────────────────
-- callback_data في تليقرام محدود بـ64 بايت، ورمز التراجع أطول من ذلك بكثير.
-- فنخزّن الحمولة هنا ونمرّر معرّفاً قصيراً في الزر.
create table if not exists public.telegram_pending (
  id           text primary key,
  chat_id      bigint not null,
  kind         text not null check (kind in ('plan', 'undo')),
  payload      jsonb not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz
);

create index if not exists telegram_pending_chat_idx on public.telegram_pending(chat_id);
create index if not exists telegram_pending_expiry_idx on public.telegram_pending(expires_at);

-- ── منع التكرار: تليقرام يعيد إرسال التحديث لو تأخّر ردّنا ───────────────────
-- جولة النموذج قد تتجاوز مهلة تليقرام، فيعيد المحاولة على نفس الرسالة. هذا
-- الجدول يجعل أول من يحجز update_id هو من ينفّذها، والباقي يُهمَل بصمت.
create table if not exists public.telegram_updates (
  update_id  bigint primary key,
  chat_id    bigint,
  created_at timestamptz not null default now()
);

create index if not exists telegram_updates_created_idx on public.telegram_updates(created_at);

alter table public.telegram_links      enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_sessions   enable row level security;
alter table public.telegram_pending    enable row level security;
alter table public.telegram_updates    enable row level security;

-- لا سياسات سماح: كل الوصول عبر مفتاح الخدمة من الخادم.
do $$
declare t text;
begin
  foreach t in array array[
    'telegram_links', 'telegram_link_codes', 'telegram_sessions',
    'telegram_pending', 'telegram_updates'
  ] loop
    execute format('drop policy if exists "Block direct access" on public.%I', t);
    execute format(
      'create policy "Block direct access" on public.%I for all using (false) with check (false)', t
    );
  end loop;
end $$;

-- ── تنظيف دوري خفيف ─────────────────────────────────────────────────────────
-- تُستدعى من الخادم بين حين وآخر؛ لا تحتاج cron.
create or replace function public.telegram_gc()
returns void language sql security definer set search_path = public as $$
  delete from public.telegram_link_codes where expires_at < now() - interval '1 day';
  delete from public.telegram_pending    where expires_at < now() - interval '1 day';
  delete from public.telegram_updates    where created_at < now() - interval '2 days';
$$;
