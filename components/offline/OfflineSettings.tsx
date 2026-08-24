'use client';

/**
 * لوحة «العمل بلا إنترنت» في الإعدادات — تجيب على ثلاثة أسئلة يسألها المستخدم
 * فعلاً: هل جهازي جاهز؟ كم عنده من البيانات ومتى؟ وكيف أجدّدها أو أمسحها؟
 *
 * متاحة لكل مستخدم لا للأدمن فقط: المخزون على **جهازه هو**، ومن حقّه يعرف ما
 * فيه ويمسحه.
 */

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/use-current-user';
import { useNetworkStatus } from '@/lib/offline/status';
import { dataCacheStats, purgeDataCache, type DataCacheStats } from '@/lib/offline/data-cache';
import { formatBytes, formatLastSync } from '@/lib/offline/format';
import { isSupported, purgeShellCache, registerServiceWorker, warmPages } from '@/lib/offline/register-sw';

type Busy = 'idle' | 'warming' | 'purging';

export default function OfflineSettings() {
  const { user } = useCurrentUser();
  const { online, lastSyncAt } = useNetworkStatus();
  const [stats, setStats] = useState<DataCacheStats | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Busy>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStats(await dataCacheStats());
    if (!isSupported()) {
      setReady(false);
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    setReady(Boolean(reg?.active));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleWarm = async () => {
    setBusy('warming');
    setNotice(null);
    try {
      await registerServiceWorker();
      const result = await warmPages(user);
      setNotice(`تم تجهيز ${result.cached} من ${result.requested} صفحة للعمل بلا إنترنت.`);
    } catch {
      setNotice('تعذّر التجهيز. تأكد من الاتصال وحاول مرة أخرى.');
    } finally {
      setBusy('idle');
      await refresh();
    }
  };

  const handlePurge = async () => {
    setBusy('purging');
    setNotice(null);
    try {
      await purgeDataCache();
      await purgeShellCache();
      setNotice('مُسح المخزون. افتح الصفحات وأنت متصل ليُبنى من جديد.');
    } finally {
      setBusy('idle');
      await refresh();
    }
  };

  return (
    <div className="space-y-4">
      {/* ── الحالة ── */}
      <div className="card p-5">
        <h2 className="font-bold text-slate-800 mb-1">العمل بلا إنترنت</h2>
        <p className="text-sm text-slate-500 mb-4 leading-relaxed">
          النظام يحفظ نسخة من الصفحات والبيانات التي تفتحها على هذا الجهاز، فتقدر تعرضها وتطبعها
          والنت مقطوع. <span className="font-semibold text-slate-600">الإضافة والتعديل والحذف تحتاج اتصالاً دائماً</span> —
          حتى لا يُحفظ تغيير على بيانات قديمة بلا علمك.
        </p>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="الاتصال الآن" value={online ? 'متصل' : 'غير متصل'} tone={online ? 'good' : 'warn'} />
          <Stat
            label="جاهزية الجهاز"
            value={ready === null ? '…' : ready ? 'جاهز' : 'غير مفعّل'}
            tone={ready ? 'good' : 'warn'}
          />
          <Stat label="آخر مزامنة" value={formatLastSync(lastSyncAt)} />
          <Stat
            label="بيانات محفوظة"
            value={stats ? `${stats.entries} استعلام` : '…'}
            hint={stats?.bytes != null ? formatBytes(stats.bytes) : undefined}
          />
        </dl>

        {ready === false && isSupported() && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            لم يُفعَّل بعد على هذا الجهاز. اضغط «تجهيز الصفحات» أو أعد تحميل الصفحة مرة واحدة وأنت متصل.
          </p>
        )}
        {!isSupported() && (
          <p className="mt-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            هذا المتصفح لا يدعم العمل بلا إنترنت. النظام يشتغل بشكل طبيعي عند وجود اتصال.
          </p>
        )}
      </div>

      {/* ── الإجراءات ── */}
      <div className="card p-5">
        <h3 className="font-bold text-slate-800 mb-3 text-sm">إجراءات</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleWarm} disabled={busy !== 'idle' || !online} className="btn-primary text-sm">
            {busy === 'warming' ? 'جارٍ التجهيز…' : 'تجهيز الصفحات للعمل بلا إنترنت'}
          </button>
          <button onClick={handlePurge} disabled={busy !== 'idle'} className="btn-secondary text-sm">
            {busy === 'purging' ? 'جارٍ المسح…' : 'مسح المخزون من هذا الجهاز'}
          </button>
        </div>

        {!online && (
          <p className="mt-3 text-xs text-slate-500">التجهيز يحتاج اتصالاً — الزر يعمل عند رجوع النت.</p>
        )}
        {notice && (
          <p className="mt-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}

        <p className="mt-4 text-xs text-slate-500 leading-relaxed">
          «التجهيز» يسحب صفحات النظام التي تملك صلاحية عرضها حتى تفتح بلا نت. بيانات كل صفحة تُحفظ
          أول ما تفتحها فعلياً وأنت متصل. والمخزون يُمسح تلقائياً عند تسجيل الخروج، لأن بيانات
          المستفيدين لا تبقى على جهاز مشترك.
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'plain',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'plain' | 'good' | 'warn';
}) {
  const toneCls =
    tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-800';
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <dt className="text-[11px] text-slate-500 font-medium">{label}</dt>
      <dd className={`text-sm font-bold mt-0.5 ${toneCls}`}>{value}</dd>
      {hint && <dd className="text-[11px] text-slate-400 mt-0.5">{hint}</dd>}
    </div>
  );
}
