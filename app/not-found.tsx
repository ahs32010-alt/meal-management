import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <div className="text-5xl font-bold text-emerald-600 mb-2">404</div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">الصفحة غير موجودة</h1>
        <p className="text-sm text-slate-500 mb-6">الصفحة التي تبحث عنها غير متاحة أو تم حذفها.</p>
        <Link
          href="/"
          className="inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm"
        >
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}
