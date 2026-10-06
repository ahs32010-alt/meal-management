'use client';

import Link from 'next/link';
import type { MealType } from '@/lib/types';
import { ENTITY_TYPE_LABELS, type EntityType } from '@/lib/types';
import { ACTION_STYLES, ACTION_LABELS_AR, ENTITY_LABELS, type ActivityAction, type ActivityEntityType } from '@/lib/activity-log';
import { operationLabel, pageLabel, pageOf } from '@/lib/activity-describe';
import { TYPE_META } from './widgets';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface RecentPerson {
  id: string;
  name: string;
  code: string | null;
  entity_type: EntityType;
  is_active: boolean;
  created_at: string;
}

export interface RecentMeal {
  id: string;
  name: string;
  type: MealType;
  is_snack: boolean;
  entity_type: EntityType;
  created_at: string;
}

export interface RecentActivity {
  id: string;
  user_name: string | null;
  user_email: string | null;
  action: ActivityAction;
  entity_type: ActivityEntityType | string;
  entity_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface InactivePerson { id: string; name: string; entity_type: EntityType }

export interface LastBackup { created_at: string; trigger_type: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** «قبل ٥ دقائق» — أوضح من تاريخ كامل لمعرفة حداثة الشي بنظرة */
export function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'الآن';
  if (min < 60) return min === 1 ? 'قبل دقيقة' : min === 2 ? 'قبل دقيقتين' : `قبل ${min} ${min <= 10 ? 'دقائق' : 'دقيقة'}`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? 'قبل ساعة' : h === 2 ? 'قبل ساعتين' : `قبل ${h} ${h <= 10 ? 'ساعات' : 'ساعة'}`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'أمس';
  if (d === 2) return 'قبل يومين';
  if (d < 30) return `قبل ${d} ${d <= 10 ? 'أيام' : 'يوماً'}`;
  return new Date(iso).toLocaleDateString('ar', { day: 'numeric', month: 'short', year: 'numeric' });
}

const isNew = (iso: string) => Date.now() - new Date(iso).getTime() < 48 * 3600_000;

function personHref(p: { id: string; entity_type: EntityType }) {
  return `${p.entity_type === 'companion' ? '/companions' : '/beneficiaries'}?edit=${p.id}`;
}

// ─── يحتاج انتباهك ───────────────────────────────────────────────────────────
interface AttentionProps {
  /** null = المستخدم ما يشوف أوامر التشغيل */
  missingMealTypes: MealType[] | null;
  canAddOrders: boolean;
  /** null = ما يشوف المستفيدين */
  inactive: InactivePerson[] | null;
  /** undefined = مو مدير (ما نعرض)، null = ما فيه ولا نسخة */
  lastBackup?: LastBackup | null;
}

type Tone = 'ok' | 'warn' | 'danger' | 'info';
const TONE: Record<Tone, { box: string; dot: string }> = {
  ok:     { box: 'border-emerald-200 bg-emerald-50/60', dot: 'bg-emerald-500' },
  warn:   { box: 'border-amber-200 bg-amber-50/70',     dot: 'bg-amber-500' },
  danger: { box: 'border-red-200 bg-red-50/70',         dot: 'bg-red-500' },
  info:   { box: 'border-slate-200 bg-slate-50',        dot: 'bg-slate-400' },
};

function AttentionItem({ tone, title, sub, href, cta }: {
  tone: Tone; title: string; sub?: React.ReactNode; href?: string; cta?: string;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${TONE[tone].box}`}>
      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TONE[tone].dot}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {sub && <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{sub}</div>}
      </div>
      {href && cta && (
        <Link href={href} className="shrink-0 text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-emerald-50 transition-colors">
          {cta}
        </Link>
      )}
    </div>
  );
}

export function AttentionPanel({ missingMealTypes, canAddOrders, inactive, lastBackup }: AttentionProps) {
  const items: React.ReactNode[] = [];

  if (missingMealTypes) {
    if (missingMealTypes.length === 0) {
      items.push(<AttentionItem key="orders" tone="ok" title="أوامر تشغيل اليوم مكتملة" sub="الفطور والغداء والعشاء كلها جاهزة" />);
    } else {
      items.push(
        <AttentionItem
          key="orders"
          tone={missingMealTypes.length === 3 ? 'danger' : 'warn'}
          title={`لم يُنشأ أمر تشغيل اليوم لـ: ${missingMealTypes.map(t => TYPE_META[t].label).join('، ')}`}
          sub="بدون أمر تشغيل ما تطلع التقارير ولا الستيكرات لهذي الوجبة"
          href="/orders"
          cta={canAddOrders ? 'إنشاء الآن' : 'فتح الأوامر'}
        />,
      );
    }
  }

  if (inactive && inactive.length > 0) {
    const bens = inactive.filter(p => p.entity_type !== 'companion').length;
    const comps = inactive.length - bens;
    const parts = [bens && `${bens} مستفيد`, comps && `${comps} مرافق`].filter(Boolean).join(' و');
    items.push(
      <AttentionItem
        key="inactive"
        tone="info"
        title={`${parts} معطّل مؤقتاً — غير محسوبين في الأوامر`}
        sub={
          <span className="flex flex-wrap gap-1 mt-1">
            {inactive.slice(0, 8).map(p => (
              <Link key={p.id} href={personHref(p)} className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 transition-colors">
                {p.name}
              </Link>
            ))}
            {inactive.length > 8 && <span className="px-2 py-0.5 text-slate-400">+{inactive.length - 8}</span>}
          </span>
        }
      />,
    );
  }

  if (lastBackup !== undefined) {
    const ageH = lastBackup ? (Date.now() - new Date(lastBackup.created_at).getTime()) / 3600_000 : Infinity;
    items.push(
      ageH <= 36 ? (
        <AttentionItem key="backup" tone="ok" title="النسخ الاحتياطي سليم" sub={`آخر نسخة ${timeAgo(lastBackup!.created_at)}`} />
      ) : (
        <AttentionItem
          key="backup"
          tone={lastBackup ? 'warn' : 'danger'}
          title={lastBackup ? `آخر نسخة احتياطية ${timeAgo(lastBackup.created_at)}` : 'ما فيه ولا نسخة احتياطية'}
          sub="النسخة اليومية التلقائية ما اشتغلت — خذ نسخة يدوية للأمان"
          href="/settings?tab=backup"
          cta="النسخ الاحتياطي"
        />
      ),
    );
  }

  if (items.length === 0) return null;
  return (
    <div className="card p-5">
      <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
        </svg>
        يحتاج انتباهك
      </h3>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">{items}</div>
    </div>
  );
}

// ─── بطاقة قائمة عامة ────────────────────────────────────────────────────────
function FeedCard({ title, href, hrefLabel = 'عرض الكل ←', empty, children, count }: {
  title: string; href?: string; hrefLabel?: string; empty: string; children: React.ReactNode[]; count?: number;
}) {
  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <h3 className="font-bold text-slate-800 text-sm">
          {title}
          {!!count && <span className="mr-2 text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">+{count} هالأسبوع</span>}
        </h3>
        {href && <Link href={href} className="text-emerald-600 text-xs font-semibold hover:text-emerald-700">{hrefLabel}</Link>}
      </div>
      {children.length === 0
        ? <div className="flex-1 py-10 text-center text-slate-400 text-sm">{empty}</div>
        : <ul className="divide-y divide-slate-50">{children}</ul>}
    </div>
  );
}

const NewBadge = () => (
  <span className="text-[9px] font-bold text-white bg-emerald-500 rounded px-1.5 py-0.5 leading-none">جديد</span>
);

// ─── آخر المستفيدين ──────────────────────────────────────────────────────────
export function RecentPeopleCard({ people, addedThisWeek }: { people: RecentPerson[]; addedThisWeek: number }) {
  return (
    <FeedCard title="آخر المستفيدين المضافين" href="/beneficiaries" empty="ما فيه مستفيدين بعد" count={addedThisWeek}>
      {people.map(p => (
        <li key={p.id}>
          <Link href={personHref(p)} title="فتح نافذة التعديل" className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50 transition-colors">
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              p.entity_type === 'companion' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {p.name.trim().charAt(0) || '؟'}
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5">
                <span className={`text-sm font-semibold truncate ${p.is_active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{p.name}</span>
                {isNew(p.created_at) && <NewBadge />}
              </span>
              <span className="block text-[11px] text-slate-400 truncate">
                {ENTITY_TYPE_LABELS[p.entity_type]}{p.code ? ` · ${p.code}` : ''}{!p.is_active ? ' · معطّل مؤقتاً' : ''}
              </span>
            </span>
            <span className="text-[11px] text-slate-400 shrink-0">{timeAgo(p.created_at)}</span>
          </Link>
        </li>
      ))}
    </FeedCard>
  );
}

// ─── آخر الأصناف ─────────────────────────────────────────────────────────────
export function RecentMealsCard({ meals, addedThisWeek }: { meals: RecentMeal[]; addedThisWeek: number }) {
  return (
    <FeedCard title="آخر الأصناف المضافة" href="/meals" empty="ما فيه أصناف بعد" count={addedThisWeek}>
      {meals.map(m => {
        const meta = TYPE_META[m.is_snack ? 'snack' : m.type];
        const typeLabel = m.is_snack ? `سناك ${TYPE_META[m.type]?.label ?? ''}` : meta?.label;
        return (
          <li key={m.id}>
            <Link href={`/meals?edit=${m.id}&entity=${m.entity_type}`} title="فتح نافذة التعديل" className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50 transition-colors">
              <span className={`w-1.5 h-8 rounded-full shrink-0 ${meta?.bar ?? 'bg-slate-300'}`} />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-slate-800 truncate">{m.name}</span>
                  {isNew(m.created_at) && <NewBadge />}
                </span>
                <span className="block text-[11px] text-slate-400 truncate">
                  {typeLabel}{m.entity_type === 'companion' ? ' · للمرافقين' : ''}
                </span>
              </span>
              <span className="text-[11px] text-slate-400 shrink-0">{timeAgo(m.created_at)}</span>
            </Link>
          </li>
        );
      })}
    </FeedCard>
  );
}

// ─── آخر التحديثات ───────────────────────────────────────────────────────────
export function RecentActivityCard({ rows }: { rows: RecentActivity[] }) {
  return (
    <FeedCard title="آخر التحديثات" href="/settings?tab=activity" hrefLabel="السجل الكامل ←" empty="ما فيه نشاط مسجّل بعد">
      {rows.map(r => {
        const who = r.user_name || r.user_email?.split('@')[0] || 'مستخدم';
        const op = operationLabel(r, ACTION_LABELS_AR[r.action] ?? r.action);
        const entity = ENTITY_LABELS[r.entity_type as ActivityEntityType] ?? r.entity_type;
        const page = pageLabel(pageOf(r.details));
        return (
          <li key={r.id} className="px-5 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 shrink-0 ${ACTION_STYLES[r.action] ?? 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                {op}
              </span>
              <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">
                {entity}{r.entity_name ? <> «<span className="font-semibold text-slate-800">{r.entity_name}</span>»</> : null}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 truncate">
              {who}{page ? ` · ${page}` : ''} · {timeAgo(r.created_at)}
            </p>
          </li>
        );
      })}
    </FeedCard>
  );
}
