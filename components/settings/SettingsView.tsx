'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import { toCSV, parseCSV, downloadCSV } from '@/lib/csv-utils';
import UsersManager from './UsersManager';
import { useCurrentUser } from '@/lib/use-current-user';

type Tab = 'translit' | 'users';

interface Row {
  mealId: string;
  name: string;
  type: MealType;
  isSnack: boolean;
  customTranslit: string | null;
  customId: string | null;
}

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  breakfast:       { label: 'فطور',       cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  lunch:           { label: 'غداء',       cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  dinner:          { label: 'عشاء',       cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  snack_breakfast: { label: 'سناك فطور', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  snack_lunch:     { label: 'سناك غداء', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  snack_dinner:    { label: 'سناك عشاء', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
};

function typeKey(type: MealType, isSnack: boolean) {
  return isSnack ? `snack_${type}` : type;
}

function keyToFields(key: string): { type: MealType; isSnack: boolean } {
  if (key.startsWith('snack_')) return { type: key.replace('snack_', '') as MealType, isSnack: true };
  return { type: key as MealType, isSnack: false };
}

export default function SettingsView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTranslit, setEditTranslit] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [importMsg, setImportMsg] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>('translit');
  const { user: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.is_admin === true;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [mealsRes, customRes] = await Promise.all([
      supabase.from('meals').select('id, name, type, is_snack').order('name'),
      supabase.from('custom_transliterations').select('id, word, transliteration'),
    ]);

    const customMap = new Map<string, { id: string; transliteration: string }>();
    for (const c of customRes.data ?? []) customMap.set(c.word, c);

    const merged: Row[] = (mealsRes.data ?? []).map(m => {
      const custom = customMap.get(m.name);
      return {
        mealId: m.id,
        name: m.name,
        type: m.type,
        isSnack: m.is_snack,
        customTranslit: custom?.transliteration ?? null,
        customId: custom?.id ?? null,
      };
    });

    setRows(merged);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const startEdit = (row: Row) => {
    setEditingId(row.mealId);
    setEditTranslit(row.customTranslit ?? '');
  };

  const saveEdit = async (row: Row) => {
    setSaving(true);
    const translit = editTranslit.trim();
    if (!translit && row.customId) {
      // Empty value → delete the custom entry so auto-transliteration takes over
      await supabase.from('custom_transliterations').delete().eq('id', row.customId);
    } else if (translit && row.customId) {
      await supabase.from('custom_transliterations').update({ transliteration: translit }).eq('id', row.customId);
    } else if (translit) {
      await supabase.from('custom_transliterations').insert({ word: row.name, transliteration: translit });
    }
    setEditingId(null);
    setSaving(false);
    fetchData();
  };

  const handleExport = () => {
    const withCustom = rows.filter(r => r.customTranslit);
    if (withCustom.length === 0) return;
    const csv = toCSV(withCustom.map(r => ({ word: r.name, transliteration: r.customTranslit ?? '' })));
    downloadCSV(csv, 'transliterations.csv');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportStatus('importing');
    setImportMsg('');
    try {
      const raw = await file.text();
      // Strip UTF-8 BOM if present before parsing
      const text = raw.replace(/^﻿/, '');
      const parsed = parseCSV(text)
        .map(r => ({ word: r['word']?.trim(), transliteration: r['transliteration']?.trim() }))
        .filter(r => r.word && r.transliteration) as { word: string; transliteration: string }[];

      if (parsed.length === 0) {
        setImportStatus('error');
        setImportMsg('لم يُعثر على بيانات صالحة — تأكد أن الملف يحتوي عمودي word و transliteration');
        return;
      }

      const { error } = await supabase
        .from('custom_transliterations')
        .upsert(parsed, { onConflict: 'word' });
      if (error) throw error;

      setImportStatus('done');
      setImportMsg(`تم استيراد ${parsed.length} ترجمة بنجاح`);
      fetchData();
      setTimeout(() => setImportStatus('idle'), 3000);
    } catch {
      setImportStatus('error');
      setImportMsg('حدث خطأ أثناء الاستيراد');
    }
  };

  const filtered = rows.filter(r =>
    !search.trim() ||
    r.name.includes(search.trim()) ||
    (r.customTranslit ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">الإعدادات</h1>
        <p className="text-slate-500 text-sm mt-0.5">إدارة إعدادات النظام والمستخدمين والصلاحيات</p>
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('translit')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
            tab === 'translit'
              ? 'border-emerald-600 text-emerald-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          الترجمة الحرفية
        </button>
        {isAdmin && (
          <button
            onClick={() => setTab('users')}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              tab === 'users'
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            المستخدمون والصلاحيات
          </button>
        )}
      </div>

      {tab === 'users' && isAdmin ? <UsersManager /> : (
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
          <div className="flex-1">
            <h2 className="font-bold text-slate-800">الترجمة الحرفية المخصصة</h2>
            <p className="text-slate-500 text-xs mt-0.5">
              الترجمة الآلية تُولَّد من الاسم العربي تلقائياً — اضغط تعديل لتخصيصها أو تغيير النوع
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">{rows.length} صنف</span>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              title="تصدير CSV"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              تصدير
            </button>
            <button
              onClick={() => importRef.current?.click()}
              disabled={importStatus === 'importing'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              title="استيراد CSV"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
              </svg>
              {importStatus === 'importing' ? 'جاري الاستيراد...' : 'استيراد'}
            </button>
            <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          </div>
        </div>
        {(importStatus === 'done' || importStatus === 'error') && (
          <div className={`px-5 py-2.5 text-sm font-medium ${importStatus === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {importMsg}
          </div>
        )}

        <div className="px-5 py-3 border-b border-slate-100">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث عن صنف..."
            className="input-field"
            dir="rtl"
          />
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <p className="font-medium text-sm">لا توجد أصناف بعد</p>
            <p className="text-xs mt-1">أضف أصنافاً من صفحة الأصناف وستظهر هنا تلقائياً</p>
          </div>
        ) : (
          <div className="overflow-x-auto no-mobile-card">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="table-header">#</th>
                  <th className="table-header">الصنف</th>
                  <th className="table-header">النوع</th>
                  <th className="table-header">الترجمة الحرفية</th>
                  <th className="table-header text-center">تعديل</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => {
                  const isEditing = editingId === row.mealId;
                  const tk = typeKey(row.type, row.isSnack);
                  return (
                    <tr key={row.mealId} className="hover:bg-slate-50 transition-colors border-t border-slate-100">
                      <td className="table-cell text-slate-400 text-xs">{idx + 1}</td>

                      <td className="table-cell font-semibold text-slate-800">{row.name}</td>

                      <td className="table-cell">
                        <select
                          value={tk}
                          onChange={async e => {
                            const { type: newType, isSnack: newIsSnack } = keyToFields(e.target.value);
                            await supabase.from('meals').update({ type: newType, is_snack: newIsSnack }).eq('id', row.mealId);
                            fetchData();
                          }}
                          className={`text-xs font-semibold px-2 py-1 rounded border cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-400 ${TYPE_BADGE[tk].cls}`}
                        >
                          <option value="breakfast">فطور</option>
                          <option value="lunch">غداء</option>
                          <option value="dinner">عشاء</option>
                          <option value="snack_breakfast">سناك فطور</option>
                          <option value="snack_lunch">سناك غداء</option>
                          <option value="snack_dinner">سناك عشاء</option>
                        </select>
                      </td>

                      <td className="table-cell">
                        {isEditing ? (
                          <input
                            value={editTranslit}
                            onChange={e => setEditTranslit(e.target.value)}
                            className="input-field py-1 text-sm"
                            dir="ltr"
                            autoFocus
                            placeholder="اكتب الترجمة..."
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(row); if (e.key === 'Escape') setEditingId(null); }}
                          />
                        ) : row.customTranslit ? (
                          <span className="font-mono font-bold text-emerald-700">{row.customTranslit}</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>

                      <td className="table-cell">
                        <div className="flex items-center justify-center gap-2">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => saveEdit(row)}
                                disabled={saving}
                                className="px-3 py-1 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                              >
                                حفظ
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"
                              >
                                إلغاء
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(row)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="تعديل"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
