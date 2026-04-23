'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import { transliterate } from '@/lib/transliterate';

interface TranslitEntry {
  id: string;
  word: string;
  transliteration: string;
}

export default function SettingsView() {
  const [entries, setEntries] = useState<TranslitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newWord, setNewWord] = useState('');
  const [newTranslit, setNewTranslit] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWord, setEditWord] = useState('');
  const [editTranslit, setEditTranslit] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const supabase = useMemo(() => createClient(), []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('custom_transliterations')
      .select('*')
      .order('word');
    if (data) setEntries(data as TranslitEntry[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const word = newWord.trim();
    const translit = newTranslit.trim();
    if (!word || !translit) return;
    setSaving(true); setError('');
    const { error: err } = await supabase
      .from('custom_transliterations')
      .insert({ word, transliteration: translit });
    if (err) setError(err.message);
    else { setNewWord(''); setNewTranslit(''); await fetchEntries(); }
    setSaving(false);
  };

  const startEdit = (entry: TranslitEntry) => {
    setEditingId(entry.id);
    setEditWord(entry.word);
    setEditTranslit(entry.transliteration);
  };

  const saveEdit = async (id: string) => {
    const word = editWord.trim();
    const translit = editTranslit.trim();
    if (!word || !translit) return;
    const { error: err } = await supabase
      .from('custom_transliterations')
      .update({ word, transliteration: translit })
      .eq('id', id);
    if (err) setError(err.message);
    else { setEditingId(null); await fetchEntries(); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من الحذف؟')) return;
    setDeleting(id);
    await supabase.from('custom_transliterations').delete().eq('id', id);
    await fetchEntries();
    setDeleting(null);
  };

  // Live preview of auto vs custom
  const autoPreview = newWord.trim() ? transliterate(newWord.trim()) : '';

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">الإعدادات</h1>
        <p className="text-slate-500 text-sm mt-0.5">إدارة الترجمة الحرفية المخصصة للأصناف والأسماء</p>
      </div>

      {/* Custom transliteration section */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800">الترجمة الحرفية المخصصة</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            أضف كلمة وترجمتها الحرفية — تُطبَّق تلقائياً على الستيكرات بدلاً من الترجمة الآلية
          </p>
        </div>

        {/* Add form */}
        <form onSubmit={handleAdd} className="p-5 border-b border-slate-100 bg-white">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="label">الكلمة بالعربي</label>
              <input
                type="text"
                value={newWord}
                onChange={e => setNewWord(e.target.value)}
                placeholder="مثال: فول"
                className="input-field"
                dir="rtl"
              />
              {autoPreview && (
                <p className="text-xs text-slate-400 mt-1">
                  الترجمة الآلية: <span className="font-mono text-slate-600">{autoPreview}</span>
                </p>
              )}
            </div>
            <div className="flex items-center self-center pb-2 text-slate-300">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
            <div className="flex-1">
              <label className="label">الترجمة المخصصة</label>
              <input
                type="text"
                value={newTranslit}
                onChange={e => setNewTranslit(e.target.value)}
                placeholder="مثال: foool"
                className="input-field"
                dir="ltr"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !newWord.trim() || !newTranslit.trim()}
              className="btn-primary flex-shrink-0"
            >
              {saving ? 'جاري الحفظ...' : 'إضافة'}
            </button>
          </div>
          {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        </form>

        {/* Entries table */}
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
            <p className="font-medium text-sm">لا توجد ترجمات مخصصة بعد</p>
            <p className="text-xs mt-1">أضف كلمة وترجمتها أعلاه</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50">
                  <th className="table-header">#</th>
                  <th className="table-header">الكلمة (عربي)</th>
                  <th className="table-header">الترجمة الآلية</th>
                  <th className="table-header">الترجمة المخصصة</th>
                  <th className="table-header text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                    <td className="table-cell text-slate-400 text-xs">{idx + 1}</td>
                    <td className="table-cell">
                      {editingId === entry.id ? (
                        <input
                          value={editWord}
                          onChange={e => setEditWord(e.target.value)}
                          className="input-field py-1 text-sm"
                          dir="rtl"
                          autoFocus
                        />
                      ) : (
                        <span className="font-semibold text-slate-800">{entry.word}</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className="font-mono text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded">
                        {transliterate(entry.word)}
                      </span>
                    </td>
                    <td className="table-cell">
                      {editingId === entry.id ? (
                        <input
                          value={editTranslit}
                          onChange={e => setEditTranslit(e.target.value)}
                          className="input-field py-1 text-sm"
                          dir="ltr"
                        />
                      ) : (
                        <span className="font-mono font-bold text-emerald-700">{entry.transliteration}</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-center gap-2">
                        {editingId === entry.id ? (
                          <>
                            <button
                              onClick={() => saveEdit(entry.id)}
                              className="px-3 py-1 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
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
                          <>
                            <button
                              onClick={() => startEdit(entry)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="تعديل"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              disabled={deleting === entry.id}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                              title="حذف"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
