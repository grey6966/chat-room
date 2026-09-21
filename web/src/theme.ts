import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'chat:theme';

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStoredMode(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'auto') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

/** 主题模式（浅色/深色/跟随系统），切换后写入 localStorage 并同步 <html data-theme> */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(mode);
    };
    apply();
    localStorage.setItem(STORAGE_KEY, mode);

    // 跟随系统时，监听系统外观变化
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (mode === 'auto') {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
    return undefined;
  }, [mode]);

  const cycleTheme = useCallback(() => {
    setMode((prev) => (prev === 'auto' ? 'light' : prev === 'light' ? 'dark' : 'auto'));
  }, []);

  return { mode, resolved: resolveTheme(mode), setMode, cycleTheme };
}
