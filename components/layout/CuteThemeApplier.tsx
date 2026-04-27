'use client';

import { useCuteTheme } from '@/lib/use-cute-theme';
import CuteBackground from './CuteBackground';

// يطبّق ثيم الدلع: يضع data-cute-theme على html (CSS) ويرسم طبقة الخلفية
// المتحركة لما المستخدم مفعّل الثيم. ما يعرض شي للعرض غير الخلفية.
export default function CuteThemeApplier() {
  const { enabled } = useCuteTheme();
  if (!enabled) return null;
  return <CuteBackground />;
}
