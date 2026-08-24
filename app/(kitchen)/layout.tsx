/**
 * تخطيط شاشة المطبخ — ملء الشاشة بلا قائمة جانبية ولا شريط علوي.
 *
 * المشغّل لا يتنقّل في النظام: عنده مهمة واحدة. وكل عنصر إضافي على الشاشة
 * احتمال ضغطة خاطئة تخرجه منها.
 */
export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-900">{children}</div>;
}
