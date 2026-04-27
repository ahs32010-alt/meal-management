'use client';

// تذييل ثابت يظهر أسفل كل صفحات لوحة التحكم. يحتوي حقوق الطبع للشركة.
export default function Footer() {
  return (
    <footer
      className="mt-10 px-4 py-5 border-t border-slate-200/70 bg-white/40 backdrop-blur-sm text-center"
      dir="rtl"
    >
      <div className="flex items-center justify-center gap-2 text-slate-500 text-xs">
        <span aria-hidden className="text-slate-300">✦</span>
        <span className="font-medium">حقوق الطبع محفوظة لشركة إطلالة روابي الشام</span>
        <span aria-hidden className="text-slate-300">✦</span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400 font-mono tracking-wide">٢٠٢٦ - ١٤٤٧</p>
    </footer>
  );
}
