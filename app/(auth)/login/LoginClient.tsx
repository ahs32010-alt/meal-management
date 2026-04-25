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
          <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-200">
            <svg className="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
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