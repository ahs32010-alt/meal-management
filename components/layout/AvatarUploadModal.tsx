'use client';

import { useRef, useState } from 'react';
import { clearCurrentUserCache } from '@/lib/use-current-user';
import type { AppUser } from '@/lib/permissions';

interface Props {
  user: AppUser;
  onClose: () => void;
  onSaved: () => void;
}

const MAX_BYTES = 2 * 1024 * 1024;

export default function AvatarUploadModal({ user, onClose, onSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(user.avatar_url);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const initial = (user.full_name ?? user.email ?? '?').trim().charAt(0).toUpperCase();

  const onPick = (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('الرجاء اختيار صورة');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('حجم الصورة أكبر من 2 ميجابايت');
      return;
    }
    setPendingFile(file);
    setPreview(URL.createObjectURL(file));
  };

  const upload = async () => {
    if (!pendingFile) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', pendingFile);
      const res = await fetch('/api/users/me/avatar', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'فشل رفع الصورة');
        setBusy(false);
        return;
      }
      clearCurrentUserCache();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/users/me/avatar', { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'فشل حذف الصورة');
        setBusy(false);
        return;
      }
      clearCurrentUserCache();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">صورة المستخدم</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-col items-center gap-3">
            <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-slate-100 bg-emerald-600 flex items-center justify-center text-white font-bold text-5xl shadow-inner">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={user.full_name ?? user.email} className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </div>
            <div className="text-center">
              <div className="font-semibold text-slate-800">{user.full_name ?? '—'}</div>
              <div className="text-xs text-slate-500" dir="ltr">{user.email}</div>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={e => onPick(e.target.files?.[0])}
          />

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="btn-secondary justify-center"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              اختر صورة من جهازك
            </button>
            <p className="text-xs text-slate-400 text-center">JPG / PNG / WEBP / GIF — حد أقصى 2 ميجابايت</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg text-sm">{error}</div>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
          {user.avatar_url && !pendingFile && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
            >
              حذف الصورة
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} disabled={busy} className="btn-secondary">إلغاء</button>
          <button
            onClick={upload}
            disabled={busy || !pendingFile}
            className="btn-primary disabled:opacity-50"
          >
            {busy ? 'جاري الحفظ...' : 'حفظ الصورة'}
          </button>
        </div>
      </div>
    </div>
  );
}
