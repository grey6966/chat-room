import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'chat:theme';
const mediaQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function systemTheme(): ResolvedTheme {
  return mediaQuery?.matches ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved: ResolvedTheme = mode === 'auto' ? systemTheme() : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

function storedMode(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
}

/**
 * Light/dark theme with three modes: explicit light, explicit dark, or
 * follow-the-system. The <html data-theme> attribute is also set by an inline
 * script in index.html before first paint, so there is no flash of the
 * wrong theme on load.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(storedMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => {
    const initial = storedMode();
    return initial === 'auto' ? systemTheme() : initial;
  });

  useEffect(() => {
    setResolved(applyTheme(mode));
    localStorage.setItem(STORAGE_KEY, mode);

    if (mode !== 'auto' || !mediaQuery) return;
    const onChange = (): void => setResolved(applyTheme('auto'));
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, [mode]);

  // Cycle auto → light → dark → auto; callers can also set a mode directly.
  const cycleTheme = useCallback((): void => {
    setMode((prev) => (prev === 'auto' ? 'light' : prev === 'light' ? 'dark' : 'auto'));
  }, []);

  return { mode, resolved, setMode, cycleTheme };
}

/** Theme icon/label used by the header toggle button. */
export function themeLabel(mode: ThemeMode, resolved: ResolvedTheme): {
  icon: string;
  title: string;
} {
  if (mode === 'auto') {
    return {
      icon: resolved === 'dark' ? '🌓' : '🌗',
      title: `跟随系统（当前${resolved === 'dark' ? '夜间' : '日间'}），点击切换：日间 → 夜间 → 自动`,
    };
  }
  if (mode === 'light') {
    return { icon: '☀️', title: '日间模式，点击切换：夜间 → 自动' };
  }
  return { icon: '🌙', title: '夜间模式，点击切换：自动 → 日间' };
}
