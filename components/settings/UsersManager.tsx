'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PAGES,
  ACTION_LABELS,
  emptyPermissions,
  PAGE_AVAILABLE_ACTIONS,
  isActionAvailable,
  type AppUser,
  type PageKey,
  type PagePermission,
  type PermissionAction,
  type ApprovalRequiredMap,
} from '@/lib/permissions';

type PermMatrix = Record<PageKey, PagePermission>;

interface FormState {
  id: string | null;
  email: string;
  password: string;
  full_name: string;
  is_admin: boolean;
  permissions: PermMatrix;
  approvalRequired: ApprovalRequiredMap;
}

function newForm(): FormState {
  return {
    id: null,
    email: '',
    password: '',
    full_name: '',
    is_admin: false,
    permissions: emptyPermissions(),
    approvalRequired: {},
  };
}

export default function UsersManager() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(newForm());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AppUser | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // عند تعديل مستخدم، نخفي حقل كلمة السر افتراضياً ونظهره فقط عند الضغط على "تغيير كلمة السر"
  const [changingPassword, setChangingPassword] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/users');
    const json = await res.json();
    if (res.ok) setUsers(json.users as AppUser[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const openCreate = () => {
    setForm(newForm());
    setErr(null);
    setShowPassword(false);
    setChangingPassword(true); // إنشاء جديد → يحتاج كلمة سر دائماً
    setModalOpen(true);
  };

  const openEdit = (u: AppUser) => {
    const perms = emptyPermissions();
    for (const p of PAGES) {
      const existing = u.permissions?.[p.key];
      if (existing) perms[p.key] = { ...perms[p.key], ...existing };
    }
    setForm({
      id: u.id,
      email: u.email,
      password: '',
      full_name: u.full_name ?? '',
      is_admin: u.is_admin,
      permissions: perms,
      approvalRequired: { ...(u.approval_required ?? {}) },
    });
    setErr(null);
    setShowPassword(false);
    setChangingPassword(false); // تعديل → نخفي الحقل حتى يضغط "تغيير كلمة السر"
    setModalOpen(true);
  };

  const togglePerm = (page: PageKey, action: PermissionAction) => {
    if (!isActionAvailable(page, action)) return; // الإجراء مو متاح على هذه الصفحة
    setForm(f => {
      const next = { ...f.permissions, [page]: { ...f.permissions[page], [action]: !f.permissions[page][action] } };
      // إذا انطفى عرض، نطفي كل شي ثاني لهذه الصفحة
      if (action === 'view' && !next[page].view) {
        next[page] = { view: false, add: false, edit: false, delete: false };
      }
      // تفعيل add/edit/delete يفعّل view تلقائياً
      if (action !== 'view' && next[page][action]) {
        next[page].view = true;
      }
      return { ...f, permissions: next };
    });
  };

  // تبديل "يحتاج موافقة" لإجراء معيّن
  const toggleApproval = (page: PageKey, action: 'add' | 'edit' | 'delete') => {
    setForm(f => {
      const cur = f.approvalRequired[page] ?? {};
      const next = { ...f.approvalRequired, [page]: { ...cur, [action]: !cur[action] } };
      return { ...f, approvalRequired: next };
    });
  };

  const toggleAllForPage = (page: PageKey, on: boolean) => {
    setForm(f => {
      // نشغّل/نطفي فقط الإجراءات المتاحة على هذه الصفحة
      const updated: PagePermission = { view: false, add: false, edit: false, delete: false };
      for (const a of PAGE_AVAILABLE_ACTIONS[page]) updated[a] = on;
      return { ...f, permissions: { ...f.permissions, [page]: updated } };
    });
  };

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const payload: Record<string, unknown> = {
        email: form.email.trim(),
        full_name: form.full_name.trim() || null,
        is_admin: form.is_admin,
        permissions: form.permissions,
        approval_required: form.approvalRequired,
      };
      if (form.password) payload.password = form.password;

      const url = form.id ? `/api/users/${form.id}` : '/api/users';
      const method = form.id ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? 'حدث خطأ');
        setSaving(false);
        return;
      }
      setModalOpen(false);
      fetchUsers();
    } catch (e: any) {
      setErr(e?.message ?? 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const res = await fetch(`/api/users/${confirmDelete.id}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { alert(json.error ?? 'فشل الحذف'); return; }
    setConfirmDelete(null);
    fetchUsers();
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
        <div className="flex-1">
          <h2 className="font-bold text-slate-800">المستخدمون والصلاحيات</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            أنشئ مستخدمين وحدد لكل منهم صلاحيات الدخول والعرض والتعديل والحذف لكل صفحة
          </p>
        </div>
        <span className="text-xs text-slate-400 font-medium">{users.length} مستخدم</span>
        <button onClick={openCreate} className="btn-primary text-sm">
          + إضافة مستخدم
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : users.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          <p className="font-medium text-sm">لا يوجد مستخدمون بعد</p>
          <p className="text-xs mt-1">ابدأ بإضافة مستخدم جديد من الزر أعلاه</p>
        </div>
      ) : (
        <div className="overflow-x-auto no-mobile-card">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50">
                <th className="table-header">#</th>
                <th className="table-header">الاسم</th>
                <th className="table-header">الإيميل</th>
                <th className="table-header">الدور</th>
                <th className="table-header">الصلاحيات</th>
                <th className="table-header text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => {
                const grantedPages = PAGES.filter(p => u.permissions?.[p.key]?.view).map(p => p.label);
                return (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors border-t border-slate-100">
                    <td className="table-cell text-slate-400 text-xs">{idx + 1}</td>
                    <td className="table-cell font-semibold text-slate-800">{u.full_name || '—'}</td>
                    <td className="table-cell text-slate-600" dir="ltr">{u.email}</td>
                    <td className="table-cell">
                      {u.is_admin ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                          مدير (كامل الصلاحيات)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded border bg-slate-50 text-slate-600 border-slate-200">
                          مستخدم
                        </span>
                      )}
                    </td>
                    <td className="table-cell text-xs text-slate-500">
                      {u.is_admin ? 'كل الصفحات' : grantedPages.length ? grantedPages.join('، ') : '—'}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          className="px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200"
                        >
                          تعديل
                        </button>
                        <button
                          onClick={() => setConfirmDelete(u)}
                          className="px-3 py-1 text-xs font-semibold bg-red-50 text-red-600 rounded-lg hover:bg-red-100"
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-slate-800 text-lg">
                {form.id ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {err && (
                <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-2.5 font-medium">{err}</div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="label">الاسم الكامل</label>
                  <input
                    value={form.full_name}
                    onChange={e => setForm({ ...form, full_name: e.target.value })}
                    className="input-field"
                    placeholder="مثلاً: أحمد محمد"
                  />
                </div>
                <div>
                  <label className="label">الإيميل *</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    className="input-field"
                    dir="ltr"
                    placeholder="user@example.com"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label">
                    كلمة السر {!form.id && '*'}
                  </label>
                  {form.id && !changingPassword ? (
                    <button
                      type="button"
                      onClick={() => { setChangingPassword(true); setShowPassword(false); }}
                      className="w-full text-right px-4 py-2.5 border border-dashed border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 hover:border-emerald-400 hover:text-emerald-700 text-sm font-semibold transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                      تغيير كلمة السر
                    </button>
                  ) : (
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={form.password}
                        onChange={e => setForm({ ...form, password: e.target.value })}
                        className="input-field pl-10"
                        dir="ltr"
                        placeholder={form.id ? 'كلمة السر الجديدة (6 أحرف على الأقل)' : '6 أحرف على الأقل'}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                        title={showPassword ? 'إخفاء' : 'إظهار'}
                      >
                        {showPassword ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                      {form.id && (
                        <button
                          type="button"
                          onClick={() => { setChangingPassword(false); setForm({ ...form, password: '' }); }}
                          className="mt-1 text-xs text-slate-500 hover:text-slate-700"
                        >
                          إلغاء التغيير
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_admin}
                  onChange={e => setForm({ ...form, is_admin: e.target.checked })}
                  className="w-4 h-4 accent-emerald-600"
                />
                <div className="flex-1">
                  <div className="font-semibold text-slate-800 text-sm">مدير النظام (Admin)</div>
                  <div className="text-xs text-slate-500">يعطي كامل الصلاحيات على جميع الصفحات ويلغي التحديدات التفصيلية أدناه</div>
                </div>
              </label>

              <div className={`space-y-5 ${form.is_admin ? 'opacity-40 pointer-events-none' : ''}`}>
                {/* ── القسم 1: ما يستطيع المستخدم فعله (يظهر/يخفي الأزرار) ── */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="font-semibold text-slate-800 text-sm">القسم الأول — ما يستطيع المستخدم فعله</h4>
                    <span className="text-xs text-slate-400">
                      إجراء معلَّم ✓ → الزر يظهر · غير معلَّم → الزر مخفي ولا يستطيع فعله أبداً
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700">
                          <th className="text-right font-semibold px-4 py-2.5">الصفحة</th>
                          {(['view', 'add', 'edit', 'delete'] as PermissionAction[]).map(a => (
                            <th key={a} className="font-semibold px-2 py-2.5 text-center">{ACTION_LABELS[a]}</th>
                          ))}
                          <th className="px-2 py-2.5 text-center text-xs font-semibold text-slate-500">الكل</th>
                        </tr>
                      </thead>
                      <tbody>
                        {PAGES.map(p => {
                          const row = form.permissions[p.key];
                          const available = PAGE_AVAILABLE_ACTIONS[p.key];
                          const all = available.length > 0 && available.every(a => row[a]);
                          return (
                            <tr key={p.key} className="border-t border-slate-100 hover:bg-slate-50/50">
                              <td className="px-4 py-2 font-medium text-slate-700">{p.label}</td>
                              {(['view', 'add', 'edit', 'delete'] as PermissionAction[]).map(a => {
                                const avail = isActionAvailable(p.key, a);
                                return (
                                  <td key={a} className="px-2 py-2 text-center">
                                    {avail ? (
                                      <input
                                        type="checkbox"
                                        checked={row[a]}
                                        onChange={() => togglePerm(p.key, a)}
                                        className="w-4 h-4 accent-emerald-600"
                                      />
                                    ) : (
                                      <span className="text-slate-300 text-xs" title="هذا الإجراء غير متاح في هذه الصفحة">—</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-2 py-2 text-center">
                                {available.length > 0 ? (
                                  <input
                                    type="checkbox"
                                    checked={all}
                                    onChange={e => toggleAllForPage(p.key, e.target.checked)}
                                    className="w-4 h-4 accent-slate-600"
                                  />
                                ) : (
                                  <span className="text-slate-300 text-xs">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ── القسم 2: ما يحتاج موافقة الأدمن قبل التنفيذ ── */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="font-semibold text-slate-800 text-sm">القسم الثاني — ما يحتاج موافقة الأدمن قبل التنفيذ</h4>
                    <span className="text-xs text-slate-400">
                      من ضمن المسموح في القسم الأول · معلَّم ✓ → يدخل نظام الموافقات · غير معلَّم → ينفَّذ مباشرة
                    </span>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-700">
                          <th className="text-right font-semibold px-4 py-2.5">الصفحة</th>
                          {(['add', 'edit', 'delete'] as const).map(a => (
                            <th key={a} className="font-semibold px-2 py-2.5 text-center">{ACTION_LABELS[a]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PAGES.map(p => {
                          const row = form.permissions[p.key];
                          const apprRow = form.approvalRequired[p.key] ?? {};
                          // نعرض فقط الصفحات اللي فيها إجراء يحتاج موافقة (أي يحتمل: add/edit/delete)
                          const hasAnyApprovable = (['add', 'edit', 'delete'] as const).some(a => isActionAvailable(p.key, a));
                          if (!hasAnyApprovable) {
                            return (
                              <tr key={p.key} className="border-t border-slate-100 opacity-50">
                                <td className="px-4 py-2 font-medium text-slate-500">{p.label}</td>
                                <td colSpan={3} className="px-2 py-2 text-center text-xs text-slate-400">— لا توجد إجراءات قابلة للموافقة في هذه الصفحة</td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={p.key} className="border-t border-slate-100 hover:bg-slate-50/50">
                              <td className="px-4 py-2 font-medium text-slate-700">{p.label}</td>
                              {(['add', 'edit', 'delete'] as const).map(a => {
                                const avail = isActionAvailable(p.key, a);
                                const allowed = !!row[a];
                                if (!avail) {
                                  return (
                                    <td key={a} className="px-2 py-2 text-center">
                                      <span className="text-slate-300 text-xs" title="غير متاح">—</span>
                                    </td>
                                  );
                                }
                                if (!allowed) {
                                  return (
                                    <td key={a} className="px-2 py-2 text-center">
                                      <span className="text-slate-300 text-xs" title="فعّل الإجراء في القسم الأول أولاً">○</span>
                                    </td>
                                  );
                                }
                                return (
                                  <td key={a} className="px-2 py-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={!!apprRow[a]}
                                      onChange={() => toggleApproval(p.key, a)}
                                      className="w-4 h-4 accent-amber-500"
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button onClick={() => setModalOpen(false)} className="btn-secondary">إلغاء</button>
              <button onClick={submit} disabled={saving} className="btn-primary disabled:opacity-50">
                {saving ? 'جاري الحفظ...' : form.id ? 'حفظ التعديلات' : 'إنشاء المستخدم'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6">
              <h3 className="font-bold text-slate-800 text-lg mb-2">تأكيد الحذف</h3>
              <p className="text-slate-600 text-sm">
                هل أنت متأكد من حذف المستخدم <span className="font-semibold">{confirmDelete.email}</span>؟
                هذا الإجراء لا يمكن التراجع عنه.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">إلغاء</button>
              <button onClick={doDelete} className="px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700">
                حذف نهائياً
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
