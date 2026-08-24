'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/lib/use-current-user';
import { can } from '@/lib/permissions';
import type { Answer } from '@/lib/assistant/types';
import type { PlanProblem } from '@/lib/assistant/plan';
import type { AskOption, DialogContext, Pending } from '@/lib/assistant/interpret';
import AnswerCard from './AnswerCard';
import AskCard from './AskCard';
import AiAnswerCard, { type AiMeta } from './AiAnswerCard';
import PlanCard, { type ClientPlan } from './PlanCard';

/**
 * وضعان للمساعد:
 *  • `local` — المحرّك الحتمي داخل النظام. سريع، مجاني، بلا خدمة خارجية،
 *    ويجاوب بأشكال منظّمة (بطاقات وجداول).
 *  • `ai`    — نموذج لغوي (Gemini أو Claude) يفهم الصياغات الحرّة ويركّب
 *    جواباً من عدة قراءات. يحتاج مفتاحاً على الخادم.
 *
 * الوضعان يشتركان في **نفس** مسار التنفيذ: أي تعديل يمر بمعاينة وتأكيد
 * و/api/assistant/execute بكل فحوصه. اختلاف الفهم لا يعني اختلاف الصلاحيات.
 */
type Mode = 'local' | 'ai';

interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
}

const MODE_KEY = 'kha:assistant-mode';
const PROVIDER_KEY = 'kha:assistant-provider';

const ASK_EXAMPLES = [
  'متى يُقدَّم البرتقال؟',
  'كم عدد المستفيدين اللي ياكلون برتقال الأسبوع الجاي؟',
  'مين ممنوع عليه السمك؟',
  'توزيع المستفيدين حسب الفيلا',
];

/** أمثلة الوضع الذكي: صياغات حرّة تحتاج تركيب جواب من عدة قراءات. */
const AI_EXAMPLES = [
  'كم شخص ما يأكل الدجاج؟',
  'أعطني المستفيدين اللي عندهم وجبات ثابتة',
  'اعرض لي ملخص تشغيل اليوم',
  'كم نحتاج وجبة بديلة بكرة؟',
];

const DO_EXAMPLES = [
  'خلّي أحمد ياكل بيض بدل الفول',
  'حط له صنف ثابت بيض السبت والثلاثاء',
  'ضاعف البيض ×2 فطور السبت الأسبوع الثاني',
  'افتح صفحة التقارير',
];

type PlanState = 'pending' | 'running' | 'done' | 'cancelled';

interface Turn {
  id: number;
  question: string;
  answer?: Answer;
  plan?: ClientPlan & { usedContext?: string[]; replay?: unknown };
  problem?: PlanProblem;
  askData?: { question: string; options: AskOption[] };
  navigate?: { href: string; label: string };
  askAnswered?: string;
  /** رد الوضع الذكي — نص Markdown يصيّره AiAnswerCard. */
  aiText?: string;
  aiMeta?: AiMeta;
  planState?: PlanState;
  applied?: number;
  planError?: string;
  undoToken?: string | null;
  undoing?: boolean;
  undone?: boolean;
  error?: string;
}

let turnId = 0;

interface ViewProps {
  /** داخل اللوحة العائمة: بلا عنوان كبير ولا هوامش واسعة. */
  compact?: boolean;
}

export default function AssistantView({ compact = false }: ViewProps) {
  const { user, loading } = useCurrentUser();
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  // ذاكرة الحوار — تُمرَّر مع كل طلب فيبقى الخادم بلا حالة.
  const [context, setContext] = useState<DialogContext | undefined>();
  const [pending, setPending] = useState<Pending | undefined>();

  // ── الوضع الذكي ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('local');
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [providerId, setProviderId] = useState<string | undefined>();
  // تاريخ الحوار مع النموذج، وهوية من أنتجه. شكله خاص بمزوّده فما نخلط بينهما.
  const aiHistory = useRef<{ messages: unknown; provider?: string }>({ messages: [] });
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  // نسأل الخادم أي مزوّد مهيّأ. لو ما فيه ولا واحد، ما نعرض المبدّل أصلاً بدل
  // أن نعد المستخدم بوضع يفشل عند أول ضغطة.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/assistant/providers')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = (data.providers ?? []) as ProviderInfo[];
        setProviders(list);

        const available = list.filter((p) => p.configured);
        if (available.length === 0) return;

        try {
          const savedProvider = localStorage.getItem(PROVIDER_KEY);
          const valid = available.find((p) => p.id === savedProvider);
          setProviderId(valid ? valid.id : available[0].id);
          if (localStorage.getItem(MODE_KEY) === 'ai') setMode('ai');
        } catch {
          setProviderId(available[0].id);
        }
      })
      .catch(() => {
        // تعذّر السؤال — نبقى على المحرّك الحتمي، وهو يعمل دائماً.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const aiAvailable = (providers ?? []).some((p) => p.configured);
  const configured = (providers ?? []).filter((p) => p.configured);

  const switchMode = (next: Mode) => {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* تخزين محجوب */ }
  };

  const switchProvider = (next: string) => {
    setProviderId(next);
    // تبديل المزوّد يبدأ حواراً جديداً: تاريخ Claude لا يُقرأ عند Gemini.
    aiHistory.current = { messages: [] };
    try { localStorage.setItem(PROVIDER_KEY, next); } catch { /* تخزين محجوب */ }
  };

  const patch = (id: number, next: Partial<Turn>) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...next } : t)));

  const send = async (raw: string, opts: { asAnswerTo?: number } = {}) => {
    const q = raw.trim();
    if (!q || busy) return;

    // المدخلات المُرسَلة تُحفظ لإعادة الاشتقاق عند التأكيد
    const sentContext = context;
    const sentPending = pending;

    let id: number;
    if (opts.asAnswerTo !== undefined) {
      id = opts.asAnswerTo;
      patch(id, { askAnswered: q });
      id = ++turnId;
      setTurns((prev) => [...prev, { id, question: q }]);
    } else {
      id = ++turnId;
      setTurns((prev) => [...prev, { id, question: q }]);
    }

    setQuestion('');
    setBusy(true);

    // ── الوضع الذكي ────────────────────────────────────────────────────────
    // يختلف عن الحتمي في الفهم فقط. أي خطة يرجّعها تدخل **نفس** مسار التأكيد
    // والتنفيذ أدناه، بنفس التوقيع وفحص الصلاحيات.
    if (mode === 'ai') {
      try {
        const res = await fetch('/api/assistant/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q,
            provider: providerId,
            history: aiHistory.current.messages,
            historyProvider: aiHistory.current.provider,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          patch(id, { error: (data as { error?: string })?.error ?? 'تعذّر تنفيذ الطلب' });
          return;
        }

        // التاريخ يتراكم عبر الأدوار — منه يفهم النموذج «خلّه لبكرة».
        aiHistory.current = {
          messages: [
            ...(Array.isArray(aiHistory.current.messages) ? aiHistory.current.messages : []),
            ...(Array.isArray(data.history) ? data.history : []),
          ],
          provider: data.historyProvider ?? providerId,
        };

        const meta: AiMeta = {
          provider: data.provider,
          model: data.model,
          toolsUsed: data.toolsUsed,
          fellBack: data.fellBack,
        };

        if (data.navigate) {
          patch(id, { aiText: data.text, aiMeta: meta, navigate: data.navigate });
          router.push(data.navigate.href);
        } else if (data.plan) {
          patch(id, {
            aiText: data.text,
            aiMeta: meta,
            plan: data.plan as ClientPlan & { replay?: unknown },
            planState: 'pending',
          });
        } else {
          patch(id, { aiText: data.text, aiMeta: meta });
        }
      } catch {
        patch(id, { error: 'تعذّر الاتصال بالخادم' });
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
      return;
    }

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, context: sentContext, pending: sentPending }),
      });
      const data = await res.json();

      if (!res.ok) {
        patch(id, { error: (data as { error?: string })?.error ?? 'تعذّر تنفيذ الطلب' });
        setPending(undefined);
        return;
      }

      if (data.context) setContext(data.context as DialogContext);

      if (data.kind === 'navigate') {
        setPending(undefined);
        patch(id, { navigate: { href: data.href, label: data.label } });
        router.push(data.href);
      } else if (data.kind === 'ask') {
        setPending(data.pending as Pending);
        patch(id, { askData: { question: data.question, options: data.options ?? [] } });
      } else if (data.kind === 'plan') {
        setPending(undefined);
        patch(id, {
          plan: { ...(data as ClientPlan), replay: { context: sentContext ?? null, pending: sentPending ?? null } },
          planState: 'pending',
        });
      } else if (data.kind === 'problem') {
        setPending(undefined);
        patch(id, { problem: data as PlanProblem });
      } else {
        setPending(undefined);
        patch(id, { answer: data as Answer });
      }
    } catch {
      patch(id, { error: 'تعذّر الاتصال بالخادم' });
      setPending(undefined);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const confirmPlan = async (turn: Turn) => {
    if (!turn.plan) return;
    patch(turn.id, { planState: 'running', planError: undefined });

    try {
      const res = await fetch('/api/assistant/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: turn.plan.question,
          signature: turn.plan.signature,
          replay: turn.plan.replay,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        patch(turn.id, {
          planState: 'pending',
          planError: (data as { error?: string })?.error ?? 'تعذّر التنفيذ',
        });
        return;
      }
      patch(turn.id, {
        planState: 'done',
        applied: (data as { applied?: number }).applied,
        undoToken: (data as { undoToken?: string | null }).undoToken ?? null,
      });
    } catch {
      patch(turn.id, { planState: 'pending', planError: 'تعذّر الاتصال بالخادم' });
    }
  };

  const undoPlan = async (turn: Turn) => {
    if (!turn.undoToken) return;
    patch(turn.id, { undoing: true, planError: undefined });
    try {
      const res = await fetch('/api/assistant/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: turn.undoToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        patch(turn.id, { undoing: false, planError: (data as { error?: string })?.error ?? 'تعذّر التراجع' });
        return;
      }
      patch(turn.id, { undoing: false, undone: true, undoToken: null });
    } catch {
      patch(turn.id, { undoing: false, planError: 'تعذّر الاتصال بالخادم' });
    }
  };

  const reset = () => {
    setTurns([]);
    setContext(undefined);
    setPending(undefined);
    aiHistory.current = { messages: [], provider: providerId };
  };

  if (loading) return <div className="p-6 text-center text-slate-500 text-sm">جارٍ التحميل…</div>;

  if (!can(user, 'assistant', 'view')) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
          <h2 className="font-bold text-amber-900">لا تملك صلاحية</h2>
          <p className="text-sm text-amber-800 mt-1">هذه الصفحة متاحة للأدمن فقط.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? 'p-3' : 'p-4 md:p-6 max-w-4xl mx-auto'}>
      {!compact && (
        <div className="mb-4">
          <h1 className="text-xl font-bold text-slate-800">المساعد الذكي</h1>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">
            {mode === 'local'
              ? 'كلّمه بالعربي بأي صياغة. يفهم أسماء المستفيدين والأصناف من بياناتك، ويسألك عن الناقص، ويتذكّر آخر شخص وصنف — فتقدر تقول «وحط له بيض السبت». كل شيء محلي بدون خدمة خارجية.'
              : 'يقرأ بياناتك بأدوات محدّدة ويركّب الجواب منها — لا يخترع رقماً. وأي تعديل يعرضه للمعاينة وينتظر تأكيدك، بنفس الصلاحيات وسجل النشاط.'}
          </p>
        </div>
      )}

      {/* مبدّل الوضع — يظهر فقط لو فيه مزوّد مهيّأ على الخادم */}
      {aiAvailable && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => switchMode('local')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                mode === 'local' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              المحرّك المحلي
            </button>
            <button
              type="button"
              onClick={() => switchMode('ai')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                mode === 'ai' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              الوضع الذكي
            </button>
          </div>

          {/* اختيار المزوّد — يظهر فقط لو أكثر من واحد مهيّأ */}
          {mode === 'ai' && configured.length > 1 && (
            <select
              value={providerId ?? ''}
              onChange={(e) => switchProvider(e.target.value)}
              className="text-xs font-semibold rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
              title="تبديل المزوّد يبدأ حواراً جديداً"
            >
              {configured.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          )}

          {mode === 'ai' && (
            <span className="text-[11px] text-slate-400">
              يقرأ فقط — التعديل يبقى بمعاينة وتأكيد
            </span>
          )}
        </div>
      )}

      {turns.length === 0 && (
        <div className={`grid gap-3 mb-4 ${compact ? '' : 'md:grid-cols-2'}`}>
          <div className={`rounded-2xl border bg-white p-4 ${mode === 'ai' ? 'border-violet-200' : 'border-slate-200'}`}>
            <div className={`text-xs font-semibold mb-2 ${mode === 'ai' ? 'text-violet-600' : 'text-slate-500'}`}>
              اسأل
            </div>
            <div className="flex flex-col gap-1.5 items-start">
              {(mode === 'ai' ? AI_EXAMPLES : ASK_EXAMPLES).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => send(e)}
                  className={`text-start px-3 py-1.5 rounded-lg border text-sm transition-colors w-full ${
                    mode === 'ai'
                      ? 'border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-white p-4">
            <div className="text-xs font-semibold text-sky-600 mb-2">أو نفّذ (بالتسلسل)</div>
            <div className="flex flex-col gap-1.5 items-start">
              {DO_EXAMPLES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => send(e)}
                  className="text-start px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-800 text-sm hover:bg-sky-100 transition-colors w-full"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {turns.map((t) => (
          <div key={t.id} className="space-y-2">
            <div className="flex justify-start">
              <div className="rounded-2xl bg-emerald-600 text-white px-4 py-2 text-sm max-w-[85%] shadow-sm">
                {t.question}
              </div>
            </div>

            {t.answer && <AnswerCard answer={t.answer} onSuggestion={(q) => send(q)} />}

            {t.aiText && <AiAnswerCard text={t.aiText} meta={t.aiMeta} />}

            {t.navigate && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between gap-3">
                <p className="text-sm text-emerald-900">
                  فتحت صفحة <span className="font-bold">{t.navigate.label}</span>
                </p>
                <Link
                  href={t.navigate.href}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors whitespace-nowrap"
                >
                  اذهب
                </Link>
              </div>
            )}

            {t.askData && (
              <AskCard
                question={t.askData.question}
                options={t.askData.options}
                answered={t.askAnswered}
                onAnswer={(v) => send(v, { asAnswerTo: t.id })}
              />
            )}

            {t.plan && (
              <>
                {t.plan.usedContext && t.plan.usedContext.length > 0 && (
                  <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5">
                    فهمت من السياق السابق — {t.plan.usedContext.join('، ')}
                  </div>
                )}
                <PlanCard
                  plan={t.plan}
                  status={t.planState ?? 'pending'}
                  appliedCount={t.applied}
                  error={t.planError}
                  canUndo={Boolean(t.undoToken)}
                  undoing={t.undoing}
                  undone={t.undone}
                  onConfirm={() => confirmPlan(t)}
                  onCancel={() => patch(t.id, { planState: 'cancelled' })}
                  onUndo={() => undoPlan(t)}
                />
              </>
            )}

            {t.problem && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="font-bold text-amber-900 text-sm">{t.problem.title}</h3>
                <p className="text-sm text-amber-800 mt-1 leading-relaxed">{t.problem.summary}</p>
                {t.problem.options && t.problem.options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {t.problem.options.map((o, i) => (
                      <button
                        key={`${o}-${i}`}
                        type="button"
                        onClick={() => send(o)}
                        className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 text-sm hover:bg-amber-100 transition-colors"
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {t.error && (
              <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
                {t.error}
              </div>
            )}

            {!t.answer && !t.plan && !t.problem && !t.askData && !t.navigate && !t.error && (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                جارٍ التحليل…
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
        className={`sticky bottom-0 mt-4 bg-slate-50 pt-3 pb-2 ${compact ? "-mx-3 px-3" : ""}`}
      >
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={300}
            placeholder="اكتب بأي صياغة… مثلاً: بدّل الفول ببيض لأحمد"
            className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition"
          />
          <button
            type="submit"
            disabled={busy || !question.trim()}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors"
          >
            {busy ? '…' : 'إرسال'}
          </button>
          {turns.length > 0 && (
            <button
              type="button"
              onClick={reset}
              className="px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-600 text-sm hover:bg-slate-100 transition-colors"
              title="محادثة جديدة"
            >
              مسح
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
