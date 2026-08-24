'use client';

/**
 * شاشة المطبخ الصوتية.
 *
 * المستخدِم لا يقرأ أي لغة. فكل ما في الشاشة مبني على ذلك:
 *   • **الضغط على أي مكان في البند ينطقه** — لا زر صغير يحتاج تصويباً.
 *   • **العدد بخط ضخم** — الأرقام تُميَّز بالشكل حتى بلا قراءة.
 *   • **علامة إنجاز كبيرة** — لأنه لا يقدر يتذكّر أين وقف من قائمة لا يقرأها.
 *   • **شريط تقدّم** بدل نصّ «٧ من ٢٢».
 *   • ألوان لا كلمات: أخضر = منجز، ذهبي = يُنطق الآن.
 *
 * والترتيب هو ترتيب «إحصاء الأصناف» في التقرير المطبوع حرفياً — فما يسمعه
 * المشغّل يطابق سطراً بسطر ما بيد المشرف.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase-client';
import { formatDateFull } from '@/lib/date-utils';
import { MEAL_TYPE_LABELS, type MealType } from '@/lib/types';
import {
  arabicVoices,
  buildUtteranceText,
  DEFAULT_RATE_KEY,
  isSpeechSupported,
  loadVoices,
  pickArabicVoice,
  speak,
  SPEECH_RATES,
  stopSpeaking,
  type SpeechRateKey,
} from '@/lib/kitchen/speech';
import {
  kitchenItemsFromReport,
  nextPendingIndex,
  progressSummary,
  readProgress,
  writeProgress,
  type KitchenItem,
} from '@/lib/kitchen/items';

/** صمت بين البندين في «تشغيل الكل» — يكفي ليلتقط المشغّل أنفاسه ويكتب. */
const GAP_MS = 1400;

/** تفضيلات الجهاز — تبقى بعد الإغلاق فما يعيد المشغّل ضبطها كل مرة. */
const VOICE_KEY = 'kha:kitchen-voice';
const RATE_KEY = 'kha:kitchen-rate';
const REPEAT_KEY = 'kha:kitchen-repeat';

const RATE_LABEL: Record<SpeechRateKey, string> = { slow: 'بطيء', normal: 'عادي', fast: 'سريع' };
const RATE_ORDER: SpeechRateKey[] = ['slow', 'normal', 'fast'];

interface OrderMeta {
  date: string;
  mealType: MealType;
}

export default function KitchenVoiceView({ orderId }: { orderId: string }) {
  const [items, setItems] = useState<KitchenItem[] | null>(null);
  const [meta, setMeta] = useState<OrderMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  // لا تكرار افتراضياً — كان يكرّر العدد مرتين وأزعج.
  const [repeatCount, setRepeatCount] = useState(false);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceChecked, setVoiceChecked] = useState(false);
  const [rateKey, setRateKey] = useState<SpeechRateKey>(DEFAULT_RATE_KEY);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const autoRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── التحميل ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [reportRes, dictRes, orderRes] = await Promise.all([
        fetch(`/api/orders/${orderId}/report`),
        supabase.from('custom_transliterations').select('word, transliteration'),
        supabase.from('daily_orders').select('date, meal_type').eq('id', orderId).maybeSingle(),
      ]);
      if (cancelled) return;

      if (!reportRes.ok) {
        setError('تعذّر تحميل أمر التشغيل. تأكد من الاتصال أو افتح الصفحة مرة وأنت متصل.');
        setItems([]);
        return;
      }

      const dict: Record<string, string> = {};
      for (const row of (dictRes.data ?? []) as Array<{ word: string; transliteration: string }>) {
        dict[row.word] = row.transliteration;
      }

      setItems(kitchenItemsFromReport(await reportRes.json(), dict));
      const o = orderRes.data as { date?: string; meal_type?: string } | null;
      if (o?.date) setMeta({ date: o.date, mealType: (o.meal_type as MealType) ?? 'lunch' });
      setDone(readProgress(orderId));
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    if (!isSpeechSupported()) {
      setVoiceChecked(true);
      return;
    }
    loadVoices().then((all) => {
      const arabic = arabicVoices(all);
      setVoices(arabic);

      // اختيار المستخدم السابق يتقدّم على ترتيبنا: لا خوارزمية تعرف صوت جهازه
      // أفضل من أذنه.
      let chosen: SpeechSynthesisVoice | null = null;
      try {
        const savedName = localStorage.getItem(VOICE_KEY);
        chosen = arabic.find((v) => v.name === savedName) ?? null;
      } catch { /* تخزين محجوب */ }

      setVoice(chosen ?? pickArabicVoice(all));
      setVoiceChecked(true);
    });

    try {
      const savedRate = localStorage.getItem(RATE_KEY) as SpeechRateKey | null;
      if (savedRate && savedRate in SPEECH_RATES) setRateKey(savedRate);
      setRepeatCount(localStorage.getItem(REPEAT_KEY) === '1');
    } catch { /* تخزين محجوب */ }
  }, []);

  const chooseVoice = (name: string) => {
    const next = voices.find((v) => v.name === name) ?? null;
    setVoice(next);
    try { localStorage.setItem(VOICE_KEY, name); } catch { /* تخزين محجوب */ }
    // عيّنة فورية — الاختيار بالأذن لا بالاسم.
    if (next) speak(buildUtteranceText('كبدة', 57, false), { voice: next, rate: SPEECH_RATES[rateKey] });
  };

  const chooseRate = (key: SpeechRateKey) => {
    setRateKey(key);
    try { localStorage.setItem(RATE_KEY, key); } catch { /* تخزين محجوب */ }
    speak(buildUtteranceText('كبدة', 57, false), { voice, rate: SPEECH_RATES[key] });
  };

  const toggleRepeat = () => {
    setRepeatCount((v) => {
      const next = !v;
      try { localStorage.setItem(REPEAT_KEY, next ? '1' : '0'); } catch { /* تخزين محجوب */ }
      return next;
    });
  };

  // إيقاف النطق عند مغادرة الشاشة — وإلا استمر الصوت بعد إغلاقها.
  useEffect(() => {
    return () => {
      autoRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      stopSpeaking();
    };
  }, []);

  const summary = useMemo(
    () => progressSummary(items ?? [], done),
    [items, done],
  );

  const markDone = useCallback(
    (key: string, value: boolean) => {
      setDone((prev) => {
        const next = new Set(prev);
        if (value) next.add(key);
        else next.delete(key);
        writeProgress(orderId, next);
        return next;
      });
    },
    [orderId],
  );

  /** ينطق بنداً، ويكمل للتالي تلقائياً لو كان «تشغيل الكل» شغّالاً. */
  const play = useCallback(
    (index: number, chain: boolean) => {
      const list = items ?? [];
      const item = list[index];
      if (!item) return;

      setActive(index);
      speak(buildUtteranceText(item.name, item.count, repeatCount), {
        voice,
        rate: SPEECH_RATES[rateKey],
        onEnd: () => {
          setActive((current) => (current === index ? null : current));
          if (!chain || !autoRef.current) return;
          timerRef.current = setTimeout(() => {
            if (!autoRef.current) return;
            const nextIndex = nextPendingIndex(list, done, index);
            if (nextIndex === null) {
              autoRef.current = false;
              setAutoPlay(false);
              return;
            }
            play(nextIndex, true);
          }, GAP_MS);
        },
        onError: () => setActive(null),
      });
    },
    [items, voice, repeatCount, rateKey, done],
  );

  const toggleAutoPlay = () => {
    if (autoRef.current) {
      autoRef.current = false;
      setAutoPlay(false);
      if (timerRef.current) clearTimeout(timerRef.current);
      stopSpeaking();
      setActive(null);
      return;
    }
    const start = nextPendingIndex(items ?? [], done, -1);
    if (start === null) return;
    autoRef.current = true;
    setAutoPlay(true);
    play(start, true);
  };

  const resetProgress = () => {
    setDone(new Set());
    writeProgress(orderId, new Set());
  };

  // ── العرض ───────────────────────────────────────────────────────────────
  if (items === null) {
    return <div className="min-h-screen grid place-items-center text-slate-400 text-lg">جارٍ التحميل…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white pb-32">
      {/* الرأس */}
      <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-700 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/kitchen"
            className="w-11 h-11 rounded-xl bg-slate-800 grid place-items-center flex-shrink-0 active:bg-slate-700"
            aria-label="رجوع"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-lg truncate">
              {meta ? MEAL_TYPE_LABELS[meta.mealType] : 'أمر التشغيل'}
            </div>
            {meta && <div className="text-xs text-slate-400 truncate">{formatDateFull(meta.date)}</div>}
          </div>
          <div className="text-2xl font-black tabular-nums flex-shrink-0">
            {summary.completed}<span className="text-slate-500">/{summary.total}</span>
          </div>
        </div>

        {/* شريط التقدّم — يُفهم بلا قراءة */}
        <div className="mt-2 h-2 rounded-full bg-slate-700 overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: summary.total ? `${(summary.completed / summary.total) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {error && <div className="m-4 p-4 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-sm">{error}</div>}

      {voiceChecked && !isSpeechSupported() && (
        <div className="m-4 p-4 rounded-xl bg-red-500/15 border border-red-500/40 text-red-200 text-sm">
          هذا المتصفح لا يدعم النطق. استخدم Chrome على أندرويد أو Safari على آيفون/آيباد.
        </div>
      )}
      {voiceChecked && isSpeechSupported() && !voice && (
        <div className="m-4 p-4 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-sm leading-relaxed">
          ما فيه صوت عربي مثبَّت على هذا الجهاز — سينطق الأسماء بلكنة غير عربية.
          <br />
          <span className="text-amber-300/80">
            أندرويد: الإعدادات ← اللغات والإدخال ← تحويل النص إلى كلام ← تنزيل العربية.
            آيفون/آيباد: الإعدادات ← تسهيلات الاستخدام ← المحتوى المنطوق ← الأصوات ← العربية.
          </span>
        </div>
      )}

      {/* البنود */}
      <ol className="p-3 space-y-2.5">
        {items.map((item, index) => {
          const isDone = done.has(item.key);
          const isActive = active === index;
          return (
            <li key={item.key}>
              <div
                className={`rounded-2xl border-2 transition-colors ${
                  isActive
                    ? 'bg-amber-400 border-amber-300 text-slate-900'
                    : isDone
                      ? 'bg-emerald-900/40 border-emerald-700 text-emerald-100'
                      : 'bg-slate-800 border-slate-700'
                }`}
              >
                <div className="flex items-stretch">
                  {/* جسم البند كله زر نطق — هدف ضخم لا يحتاج تصويباً */}
                  <button
                    type="button"
                    onClick={() => {
                      autoRef.current = false;
                      setAutoPlay(false);
                      play(index, false);
                    }}
                    className="flex-1 flex items-center gap-3 p-4 text-start min-w-0 active:opacity-80"
                  >
                    <span
                      className={`w-9 h-9 rounded-lg grid place-items-center text-sm font-bold flex-shrink-0 tabular-nums ${
                        isActive ? 'bg-slate-900/20' : 'bg-slate-700/60 text-slate-300'
                      }`}
                    >
                      {index + 1}
                    </span>

                    <span className="flex-1 min-w-0">
                      <span className={`block font-bold text-xl truncate ${isDone && !isActive ? 'line-through opacity-70' : ''}`}>
                        {item.name}
                      </span>
                      <span className={`block text-xs truncate ${isActive ? 'text-slate-700' : 'text-slate-400'}`} dir="ltr">
                        {item.latin}
                      </span>
                    </span>

                    {/* العدد — أضخم عنصر في البند */}
                    <span className="text-5xl font-black tabular-nums flex-shrink-0 leading-none">
                      {item.count}
                    </span>

                    <svg className="w-7 h-7 flex-shrink-0 opacity-70" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z" />
                    </svg>
                  </button>

                  {/* الإنجاز — زر منفصل بعرض ثابت حتى لا يُضغط بالخطأ أثناء النطق */}
                  <button
                    type="button"
                    onClick={() => markDone(item.key, !isDone)}
                    aria-label={isDone ? 'إلغاء الإنجاز' : 'تم'}
                    className={`w-20 grid place-items-center border-s-2 active:opacity-70 ${
                      isActive ? 'border-amber-300' : isDone ? 'border-emerald-700' : 'border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-12 h-12 rounded-full grid place-items-center border-2 ${
                        isDone ? 'bg-emerald-500 border-emerald-400 text-white' : 'border-slate-500 text-transparent'
                      }`}
                    >
                      <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {items.length === 0 && !error && (
        <div className="p-8 text-center text-slate-400">ما فيه أصناف في هذا الأمر.</div>
      )}

      {/* الشريط السفلي */}
      <div className="fixed bottom-0 inset-x-0 z-20 bg-slate-900/95 backdrop-blur border-t border-slate-700 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAutoPlay}
            disabled={items.length === 0 || summary.allDone}
            className={`flex-1 h-16 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 disabled:opacity-40 ${
              autoPlay ? 'bg-red-600 active:bg-red-700' : 'bg-emerald-600 active:bg-emerald-700'
            }`}
          >
            {autoPlay ? (
              <>
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                إيقاف
              </>
            ) : (
              <>
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                تشغيل الكل
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label="إعدادات الصوت"
            className="w-16 h-16 rounded-2xl bg-slate-800 border-2 border-slate-700 grid place-items-center active:bg-slate-700"
          >
            <svg className="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          <button
            type="button"
            onClick={resetProgress}
            disabled={summary.completed === 0}
            aria-label="تصفير الإنجاز"
            className="w-16 h-16 rounded-2xl bg-slate-800 border-2 border-slate-700 grid place-items-center disabled:opacity-40 active:bg-slate-700"
          >
            <svg className="w-7 h-7 text-slate-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20 9A8 8 0 006 5.3M4 15a8 8 0 0014 3.7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── إعدادات الصوت ─────────────────────────────────────────────────
          الجودة تختلف جذرياً بين أصوات الجهاز الواحد، ولا خوارزمية تعرف
          أيّها أفضل. فنعرضها كلها، وكل اختيار يُسمَع فوراً بعيّنة. */}
      {settingsOpen && (
        <div className="fixed inset-0 z-30 bg-black/70 flex items-end" onClick={() => setSettingsOpen(false)}>
          <div
            className="w-full bg-slate-800 rounded-t-3xl p-5 pb-8 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold">إعدادات الصوت</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="إغلاق"
                className="w-12 h-12 rounded-xl bg-slate-700 grid place-items-center active:bg-slate-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* السرعة */}
            <div className="mb-6">
              <div className="text-sm font-semibold text-slate-400 mb-2">السرعة</div>
              <div className="grid grid-cols-3 gap-2">
                {RATE_ORDER.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => chooseRate(key)}
                    className={`h-14 rounded-xl font-bold border-2 ${
                      rateKey === key
                        ? 'bg-emerald-600 border-emerald-400'
                        : 'bg-slate-700 border-slate-600 text-slate-300'
                    }`}
                  >
                    {RATE_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>

            {/* تكرار العدد */}
            <button
              type="button"
              onClick={toggleRepeat}
              className="w-full mb-6 flex items-center justify-between gap-3 p-4 rounded-xl bg-slate-700/60 border-2 border-slate-600 text-start"
            >
              <span>
                <span className="block font-bold">تكرار العدد مرتين</span>
                <span className="block text-xs text-slate-400 mt-0.5">للمطبخ الصاخب — يفرّق بين ٥٧ و٦٧</span>
              </span>
              <span
                className={`w-14 h-8 rounded-full flex items-center px-1 flex-shrink-0 transition-colors ${
                  repeatCount ? 'bg-emerald-500 justify-end' : 'bg-slate-500 justify-start'
                }`}
              >
                <span className="w-6 h-6 rounded-full bg-white" />
              </span>
            </button>

            {/* الأصوات */}
            <div className="text-sm font-semibold text-slate-400 mb-2">
              الصوت {voices.length > 0 && <span className="text-slate-500">({voices.length} متاح)</span>}
            </div>
            {voices.length === 0 ? (
              <p className="text-sm text-slate-400">ما فيه صوت عربي مثبَّت على هذا الجهاز.</p>
            ) : (
              <div className="space-y-2">
                {voices.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => chooseVoice(v.name)}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 text-start ${
                      voice?.name === v.name
                        ? 'bg-emerald-600/20 border-emerald-500'
                        : 'bg-slate-700/50 border-slate-600'
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold truncate">{v.name}</span>
                      <span className="block text-xs text-slate-400" dir="ltr">{v.lang}</span>
                    </span>
                    {/* الصوت المحلي وحده يشتغل بلا إنترنت — تمييزه يهمّ في المطبخ */}
                    {v.localService && (
                      <span className="text-[10px] font-bold px-2 py-1 rounded bg-slate-600 text-slate-200 flex-shrink-0">
                        بلا نت
                      </span>
                    )}
                    {voice?.name === v.name && (
                      <svg className="w-6 h-6 text-emerald-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-500 mt-3">اضغط أي صوت لتسمع عيّنة: «كبدة، سبعة وخمسين».</p>
          </div>
        </div>
      )}
    </div>
  );
}
