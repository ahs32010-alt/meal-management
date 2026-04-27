'use client';

// ثيم "الدلع": زخارف ومأكولات في الخلفية. مُفعَّل لكل مستخدم على حدة (localStorage)،
// ولا يطبَّق على بقية المستخدمين. الحالة محفوظة لين يلغيها صاحب الحساب.
//
// مزامنة بين الاستدعاءات (لما الزر في ExtrasView يبدّل، CuteThemeApplier لازم
// يعرف ويُعيد الرسم): نطلق CustomEvent على window — كل instance يستمع له ويعيد
// قراءة الحالة من localStorage. أيضاً نستمع لـ`storage` event لمزامنة عبر التابات.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from './use-current-user';

const KEY_PREFIX = 'kha:cute-theme:';
const ATTR = 'data-cute-theme';
const EVT = 'kha:cute-theme-change';

function applyToDom(on: boolean) {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute(ATTR, 'on');
  else document.documentElement.removeAttribute(ATTR);
}

function readStored(userId: string | undefined): boolean {
  if (!userId || typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(KEY_PREFIX + userId) === 'on';
  } catch {
    return false;
  }
}

export function useCuteTheme() {
  const { user } = useCurrentUser();
  const userId = user?.id;
  const [enabled, setEnabledState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) {
      applyToDom(false);
      setEnabledState(false);
      setReady(false);
      return;
    }

    const sync = () => {
      const isOn = readStored(userId);
      setEnabledState(isOn);
      applyToDom(isOn);
    };

    sync();
    setReady(true);

    const onCustom = () => sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_PREFIX + userId) sync();
    };
    window.addEventListener(EVT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, [userId]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    applyToDom(next);
    if (!userId) return;
    try {
      if (next) localStorage.setItem(KEY_PREFIX + userId, 'on');
      else localStorage.removeItem(KEY_PREFIX + userId);
    } catch {
      // ignore
    }
    // إعلام بقية الاستدعاءات في نفس التبويب
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(EVT));
    }
  }, [userId]);

  return { enabled, setEnabled, ready };
}
