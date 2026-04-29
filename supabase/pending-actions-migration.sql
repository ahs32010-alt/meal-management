-- جدول طلبات الموافقة: لما مستخدم غير أدمن يضيف/يحذف، الطلب ينحفظ هنا
-- ويراجعه الأدمن (يقبل أو يرفض). للحماية: التطبيق يفرض admin check؛ RLS يفتح
-- القراءة/الكتابة لكل من هو authenticated، تماشياً مع نمط بقية الجداول.

create table if not exists pending_actions (
  id            uuid default gen_random_uuid() primary key,
  user_id       uuid references auth.users(id) on delete cascade,
  user_name     text,
  action        text not null,
  entity_type   text not null check (entity_type in ('beneficiary', 'companion')),
  entity_id     uuid,             -- لطلبات الحذف/التعديل
  entity_name   text,             -- عنوان للعرض في لوحة الإشعارات
  payload       jsonb,            -- لطلبات الإنشاء/التعديل: كل بيانات النموذج
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by   uuid references auth.users(id),
  reviewed_at   timestamptz,
  reject_reason text,
  created_at    timestamptz default timezone('utc', now()) not null
);

-- نضمن قيد action يقبل 'create' و'update' و'delete' (idempotent)
alter table pending_actions drop constraint if exists pending_actions_action_check;
alter table pending_actions add constraint pending_actions_action_check
  check (action in ('create', 'update', 'delete'));

-- entity_type يقبل: مستفيد، مرافق، صنف، بند منيو (idempotent)
alter table pending_actions drop constraint if exists pending_actions_entity_type_check;
alter table pending_actions add constraint pending_actions_entity_type_check
  check (entity_type in ('beneficiary', 'companion', 'meal', 'menu_item'));

alter table pending_actions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'authenticated read pending') then
    create policy "authenticated read pending"
      on pending_actions for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policy where polname = 'authenticated insert pending') then
    create policy "authenticated insert pending"
      on pending_actions for insert with check (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policy where polname = 'authenticated update pending') then
    create policy "authenticated update pending"
      on pending_actions for update using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policy where polname = 'authenticated delete pending') then
    create policy "authenticated delete pending"
      on pending_actions for delete using (auth.role() = 'authenticated');
  end if;
end $$;

create index if not exists idx_pending_actions_status on pending_actions(status);
create index if not exists idx_pending_actions_user on pending_actions(user_id);
create index if not exists idx_pending_actions_created on pending_actions(created_at desc);

-- نضيف الجدول لـrealtime publication عشان أي تغيير (insert/update/delete) ينعكس
-- فوراً عند المستخدمين بدون refresh للصفحة. idempotent — ما يكسر إذا مضاف مسبقاً.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'pending_actions'
  ) then
    alter publication supabase_realtime add table pending_actions;
  end if;
end $$;
