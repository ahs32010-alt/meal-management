export const dynamic = 'force-dynamic';

import Sidebar from '@/components/layout/Sidebar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar />
      <main className="mr-64 min-h-screen">
        {children}
      </main>
    </div>
  );
}
