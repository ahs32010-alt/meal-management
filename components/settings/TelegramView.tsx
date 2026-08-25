'use client';

/**
 * تبويب تليقرام في الإعدادات.
 *
 * قسمان: ربط حساب المستخدم نفسه (متاح للجميع)، وحالة الويب‑هوك (للأدمن).
 * ولا يمرّ مفتاح البوت من هنا إطلاقاً — الخادم وحده يلمسه.
 */

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from '@/lib/use-current-user';

interface LinkRow {
  chatId: string;
  username: string | null;
  name: string | null;
  linkedAt: string;
  lastSeenAt: string | null;
}

interface LinkState {
  configured: boolean;
  botUsername: string | null;
  links: LinkRow[];
}

interface SetupState {
  hasToken: boolean;
  hasSecret: boolean;
  botUsername?: string | null;
  expectedUrl?: string;
  webhookUrl?: string | null;
  matches?: boolean;
  pending?: number;
  lastError?: string | null;
  lastErrorAt?: string | null;
  error?: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function TelegramView() {
  const { user } = useCurrentUser();
  const isAdmin = user?.is_admin === true;

  const [state, setState] = useState<LinkState | null>(null);
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const loadLinks = useCallback(async () => {
    const res = await fetch('/api/telegram/link', { cache: 'no-store' });
    if (res.ok) setState(await res.json());
  }, []);

  const loadSetup = useCallback(async () => {
    if (!isAdmin) return;
    const res = await fetch('/api/telegram/setup', { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (json) setSetup(json);
  }, [isAdmin]);

  useEffect(() => {
    void loadLinks();
    void loadSetup();
  }, [loadLinks, loadSetup]);

  // عدّاد صلاحية الكود — الكود بلا مهلة ظاهرة يُترك مفتوحاً على الشاشة.
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setCode(null);
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [expiresAt]);

  async function generateCode() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/telegram/link', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ tone: 'error', text: json.error ?? 'تعذّر إنشاء الكود' });
        return;
      }
      setCode(json.code);
      setExpiresAt(json.expiresAt);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(chatId: string) {
    if (!confirm('فكّ ربط هذه المحادثة؟ البوت ما راح يجاوب فيها بعدها.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/telegram/link', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
      if (res.ok) {
        setMessage({ tone: 'ok', text: 'فُكّ الربط.' });
        await loadLinks();
      } else {
        setMessage({ tone: 'error', text: 'تعذّر فكّ الربط' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function webhookAction(method: 'POST' | 'DELETE') {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/telegram/setup', { method });
      const json = await res.json().catch(() => ({}));
      setMessage(
        res.ok
          ? { tone: 'ok', text: method === 'POST' ? 'فُعّل الويب‑هوك بنجاح.' : 'أُوقف الويب‑هوك.' }
          : { tone: 'error', text: json.error ?? 'تعذّر تنفيذ الطلب' },
      );
      await loadSetup();
    } finally {
      setBusy(false);
    }
  }

  const deepLink =
    state?.botUsername && code ? `https://t.me/${state.botUsername}?start=${code}` : null;

  return (
    <div className="space-y-6">
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm border ${
            message.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── ربط الحساب ────────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800">ربط حسابك ببوت تليقرام</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            بعد الربط تقدر تسأل البوت عن المستفيدين والأصناف والمنيو وأوامر التشغيل والتقارير،
            وتنفّذ التعديلات بتأكيد — بنفس صلاحيات حسابك بالضبط.
          </p>
        </div>

        <div className="p-5 space-y-4">
          {state && !state.configured && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              البوت غير مفعّل على الخادم — ينقص <code>TELEGRAM_BOT_TOKEN</code>.
              راجع الأدمن أو ملف <code>TELEGRAM.md</code>.
            </div>
          )}

          {state?.configured && (
            <>
              <ol className="text-sm text-slate-600 space-y-1.5 list-decimal pr-5">
                <li>
                  افتح البوت في تليقرام
                  {state.botUsername ? (
                    <>
                      :{' '}
                      <a
                        href={`https://t.me/${state.botUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-700 font-semibold hover:underline"
                      >
                        @{state.botUsername}
                      </a>
                    </>
                  ) : null}
                </li>
                <li>اضغط «إنشاء كود ربط» تحت.</li>
                <li>أرسل الكود للبوت في المحادثة.</li>
              </ol>

              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={generateCode} disabled={busy} className="btn-primary">
                  {busy ? 'لحظة…' : 'إنشاء كود ربط'}
                </button>

                {code && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-2xl font-bold tracking-[0.3em] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2">
                      {code}
                    </span>
                    <span className="text-xs text-slate-500">
                      ينتهي بعد {Math.floor(remaining / 60)}:
                      {String(remaining % 60).padStart(2, '0')}
                    </span>
                    {deepLink && (
                      <a
                        href={deepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-emerald-700 font-semibold hover:underline"
                      >
                        افتح البوت واربط مباشرة ↗
                      </a>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-2">المحادثات المربوطة بحسابك</h3>
            {!state?.links.length ? (
              <p className="text-sm text-slate-400">لا توجد محادثات مربوطة بعد.</p>
            ) : (
              <div className="space-y-2">
                {state.links.map((link) => (
                  <div
                    key={link.chatId}
                    className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg px-4 py-3"
                  >
                    <div className="text-sm">
                      <div className="font-semibold text-slate-800">
                        {link.name || 'محادثة'}{' '}
                        {link.username && (
                          <span className="text-slate-400 font-normal">@{link.username}</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        رُبطت {formatDate(link.linkedAt)} · آخر نشاط {formatDate(link.lastSeenAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => unlink(link.chatId)}
                      disabled={busy}
                      className="text-sm font-semibold text-red-600 hover:text-red-700"
                    >
                      فكّ الربط
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── حالة الويب‑هوك (أدمن) ─────────────────────────────────────── */}
      {isAdmin && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
            <h2 className="font-bold text-slate-800">اتصال البوت بالخادم (ويب‑هوك)</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              يُضبط مرة واحدة، ويُعاد ضبطه بعد كل تغيير في نطاق الموقع.
            </p>
          </div>

          <div className="p-5 space-y-4 text-sm">
            {!setup ? (
              <p className="text-slate-400">جارٍ التحميل…</p>
            ) : (
              <>
                <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
                  <dt className="text-slate-500">مفتاح البوت</dt>
                  <dd className={setup.hasToken ? 'text-emerald-700' : 'text-red-600'}>
                    {setup.hasToken ? `مضبوط${setup.botUsername ? ` (@${setup.botUsername})` : ''}` : 'ناقص — TELEGRAM_BOT_TOKEN'}
                  </dd>

                  <dt className="text-slate-500">السرّ المشترك</dt>
                  <dd className={setup.hasSecret ? 'text-emerald-700' : 'text-red-600'}>
                    {setup.hasSecret ? 'مضبوط' : 'ناقص — TELEGRAM_WEBHOOK_SECRET'}
                  </dd>

                  <dt className="text-slate-500">العنوان المتوقَّع</dt>
                  <dd className="font-mono text-xs text-slate-600 break-all">
                    {setup.expectedUrl ?? '—'}
                  </dd>

                  <dt className="text-slate-500">المسجَّل عند تليقرام</dt>
                  <dd className="font-mono text-xs break-all">
                    {setup.webhookUrl ? (
                      <span className={setup.matches ? 'text-emerald-700' : 'text-amber-700'}>
                        {setup.webhookUrl}
                      </span>
                    ) : (
                      <span className="text-slate-400">غير مسجَّل</span>
                    )}
                  </dd>

                  {typeof setup.pending === 'number' && (
                    <>
                      <dt className="text-slate-500">تحديثات معلّقة</dt>
                      <dd className="text-slate-700">{setup.pending}</dd>
                    </>
                  )}

                  {setup.lastError && (
                    <>
                      <dt className="text-slate-500">آخر خطأ</dt>
                      <dd className="text-red-600">
                        {setup.lastError}
                        <span className="text-slate-400"> · {formatDate(setup.lastErrorAt ?? null)}</span>
                      </dd>
                    </>
                  )}
                </dl>

                {setup.error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-800">
                    {setup.error}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => webhookAction('POST')}
                    disabled={busy || !setup.hasToken || !setup.hasSecret}
                    className="btn-primary"
                  >
                    {setup.matches ? 'إعادة تفعيل الويب‑هوك' : 'تفعيل الويب‑هوك'}
                  </button>
                  {setup.webhookUrl && (
                    <button
                      onClick={() => webhookAction('DELETE')}
                      disabled={busy}
                      className="text-sm font-semibold text-red-600 hover:text-red-700"
                    >
                      إيقاف
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
