import type { ThemeMode } from '../lib/useTheme.js';

interface ThemeToggleProps {
  mode: ThemeMode;
  onToggle: () => void;
}

const LABEL: Record<ThemeMode, { icon: string; title: string }> = {
  auto: { icon: '🌓', title: '主题：跟随系统（点击切换为日间模式）' },
  light: { icon: '☀️', title: '主题：日间模式（点击切换为夜间模式）' },
  dark: { icon: '🌙', title: '主题：夜间模式（点击切换为跟随系统）' },
};

export default function ThemeToggle({ mode, onToggle }: ThemeToggleProps) {
  const { icon, title } = LABEL[mode];
  return (
    <button
      type="button"
      className="theme-toggle"
      title={title}
      aria-label={title}
      onClick={onToggle}
    >
      {icon}
    </button>
  );
}
