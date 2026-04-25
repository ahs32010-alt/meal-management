'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/layout/ThemeToggle';

const SIGN_IN_TIMEOUT_MS = 12000;

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const signInPromise = supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('SIGN_IN_TIMEOUT')), SIGN_IN_TIMEOUT_MS);
      });

      const { data, error } = await Promise.race([signInPromise, timeoutPromise]);

      if (error) {
        setError(`فشل تسجيل الدخول: ${error.message}`);
        return;
      }

      if (!data?.session) {
        setError('تعذر إنشاء جلسة دخول. تأكد من تفعيل المستخدم (Email Confirmed) في Supabase.');
        return;
      }

      router.replace('/');
      router.refresh();
    } catch (err) {
      if (err instanceof Error && err.message === 'SIGN_IN_TIMEOUT') {
        setError('انتهت مهلة تسجيل الدخول. تحقق من الاتصال أو إعدادات Supabase ثم حاول مرة أخرى.');
      } else {
        setError('تعذر تسجيل الدخول الآن. تحقق من الاتصال أو إعدادات Supabase ثم حاول مرة أخرى.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center p-4 relative">
      <div className="absolute top-4 left-4">
        <ThemeToggle variant="compact" />
      </div>
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl overflow-hidden mx-auto mb-4 shadow-lg bg-black flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="مركز خطوة أمل" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">مركز خطوة أمل</h1>
          <p className="text-slate-500 mt-1 text-sm">سجّل دخولك للمتابعة</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">

          <div>
            <label className="label">البريد الإلكتروني</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="admin@example.com"
              required
            />
          </div>

          <div>
            <label className="label">كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-6">
          نظام إدارة وجبات المستفيدين ذوي القيود الغذائية
        </p>

      </div>
    </div>
  );
}