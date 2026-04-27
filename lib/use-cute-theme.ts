'use client';

// ثيم "الدلع": زخارف ومأكولات في الخلفية. مُفعَّل لكل مستخدم على حدة (localStorage)،
// ولا يطبَّق على بقية المستخدمين. الحالة محفوظة لين يلغيها صاحب الحساب.

import { useCallback, useEffect, useState } from 'react';
import { useCurrentUser } from './use-current-user';

const KEY_PREFIX = 'kha:cute-theme:';
const ATTR = 'data-cute-theme';

function applyToDom(on: boolean) {
  if (typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute(ATTR, 'on');
  else document.documentElement.removeAttribute(ATTR);
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
    try {
      const isOn = localStorage.getItem(KEY_PREFIX + userId) === 'on';
      setEnabledState(isOn);
      applyToDom(isOn);
    } catch {
      // ignore storage errors
    }
    setReady(true);
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
  }, [userId]);

  return { enabled, setEnabled, ready };
}
