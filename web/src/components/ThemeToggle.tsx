import type { ThemeMode } from '../theme';

interface ThemeToggleProps {
  mode: ThemeMode;
  onCycle: () => void;
}

const LABEL: Record<ThemeMode, string> = {
  light: '浅色模式（点击切换：跟随系统 → 深色）',
  dark: '深色模式（点击切换：浅色 → 跟随系统）',
  auto: '跟随系统（点击切换：深色 → 浅色）',
};

const ICON: Record<ThemeMode, string> = {
  light: '☀️',
  dark: '🌙',
  auto: '🖥️',
};

export default function ThemeToggle({ mode, onCycle }: ThemeToggleProps) {
  return (
    <button
      type="button"
      className="theme-btn"
      title={LABEL[mode]}
      aria-label={LABEL[mode]}
      onClick={onCycle}
    >
      <span className="theme-icon">{ICON[mode]}</span>
    </button>
  );
}
