/**
 * ذاكرة قصيرة لنتيجة التحقّق من رمز الدخول.
 *
 * سبب وجودها: `supabase.auth.getUser()` يتحقّق من الرمز **عبر الشبكة**، وقياس
 * هذا المشروع أعطى ٣٣٥–٤٨٠ms للنداء الواحد. والوسيط ينادي هذي الدالة في كل
 * تنقّل بين الصفحات، وكل مسار API ينادونها مرّة أخرى — فنصف ثانية تضيع قبل أن
 * يبدأ رسم أي صفحة، ونصف ثانية أخرى في كل طلب.
 *
 * ⚠️ هذي **ليست** تخفيفاً للتحقّق: الرمز يبقى يُتحقّق منه عند Supabase كالمعتاد.
 * كل ما في الأمر أننا لا نكرّر التحقّق من **نفس الرمز** أكثر من مرّة كل بضع
 * ثوانٍ. الرمز المزوّر يُرفض في أول نداء، ويُخزَّن رفضه أيضاً — فلا يفتح ذلك
 * باباً لأحد. والصلاحيات (RLS في قاعدة البيانات + `assertPagePermission` في
 * المسارات) لم تُمسّ إطلاقاً.
 *
 * المدّة قصيرة عمداً: تعطيل مستخدم أو حذفه يسري خلال TTL_MS كحدّ أقصى على
 * قشرة الصفحات، أما البيانات نفسها فمحميّة بـRLS في كل طلب بلا استثناء.
 */

const TTL_MS = 15_000;
/** سقف يمنع تضخّم الذاكرة في نسخة طويلة العمر. */
const MAX_ENTRIES = 500;

interface Entry {
  /** الوعد نفسه لا نتيجته — فالنداءات المتزامنة تشترك فيه بدل أن يطلق كل
   *  واحد منها رحلة شبكة مستقلّة (منع تدافع القطيع). */
  value: Promise<unknown>;
  expiresAt: number;
}

const store = new Map<string, Entry>();

function prune(now: number) {
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
  // لو بقي متضخّماً بعد إسقاط المنتهي، نسقط الأقدم إدخالاً (ترتيب Map يحفظه).
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** ينفّذ `compute` مرّة واحدة لكل مفتاح خلال TTL. */
export function cachedByToken<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>;

  const promise = compute();
  store.set(key, { value: promise, expiresAt: now + TTL_MS });

  void promise.then(
    () => {
      // نبدأ عدّ المدّة من لحظة وصول الجواب لا من لحظة الطلب
      const entry = store.get(key);
      if (entry && entry.value === promise) entry.expiresAt = Date.now() + TTL_MS;
    },
    () => {
      // الفشل لا يُخزَّن — الطلب التالي يعيد المحاولة على الشبكة
      const entry = store.get(key);
      if (entry && entry.value === promise) store.delete(key);
    },
  );

  prune(now);
  return promise;
}

/** يُسقط كل ما خُزِّن — يُستدعى عند تسجيل الخروج أو تغيير الصلاحيات. */
export function clearAuthCache() {
  store.clear();
}
