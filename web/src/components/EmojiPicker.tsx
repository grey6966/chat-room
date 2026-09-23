import { useEffect, useRef, useState } from 'react';
import { EMOJI_CATEGORIES } from '../emoji';

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/**
 * Emoji 表情选择面板：分类切换 + 网格选择。
 * 点击外部或按 Esc 关闭；点击表情后保持打开，方便连续输入。
 */
export default function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [activeKey, setActiveKey] = useState(EMOJI_CATEGORIES[0].key);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const active = EMOJI_CATEGORIES.find((c) => c.key === activeKey) ?? EMOJI_CATEGORIES[0];

  return (
    <div className="emoji-panel" ref={rootRef}>
      <div className="emoji-tabs">
        {EMOJI_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.label}
            className={`emoji-tab${c.key === active.key ? ' active' : ''}`}
            onClick={() => setActiveKey(c.key)}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <div className="emoji-grid" role="listbox" aria-label={`${active.label}表情`}>
        {active.emojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            type="button"
            className="emoji-item"
            role="option"
            title={emoji}
            onClick={() => onPick(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
