import { useEffect, useRef, useState } from 'react';

interface EmojiCategory {
  label: string;
  icon: string;
  emojis: string[];
}

const CATEGORIES: EmojiCategory[] = [
  {
    label: '表情',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
      '😘', '😗', '😚', '😙', '😋', '😛', '😜', '🤪',
      '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡', '🤐',
      '😐', '😑', '😶', '🫥', '😏', '😒', '🙄', '😬',
      '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒',
      '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯',
      '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😕', '😟',
      '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '🥹',
      '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱',
      '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤',
      '😡', '😠', '🤬', '😈', '👿', '💀', '💩', '🤡',
      '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻',
      '😼', '😽', '🙀', '😿', '😾',
    ],
  },
  {
    label: '手势',
    icon: '👋',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳',
      '🫴', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟',
      '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️',
      '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌',
      '🫶', '👐', '🤲', '🤝', '🙏', '💪', '🦾', '✍️',
      '🫵',
    ],
  },
  {
    label: '心情',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓',
      '💗', '💖', '💘', '💝', '💟', '♥️', '💌', '💋',
      '🔥', '✨', '⭐', '🌟', '💫', '⚡', '🎉', '🎊',
      '🎈', '🎁', '🏆', '🥇', '✅', '❌', '❗', '❓',
    ],
  },
  {
    label: '动物',
    icon: '🐶',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
      '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
      '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺',
      '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌',
      '🐞', '🐜', '🪰', '🪲', '🦟', '🦗', '🕷️', '🕸️',
      '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑',
      '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳',
      '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧',
      '🐘', '🦛', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂',
      '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌',
      '🐕', '🐩', '🦮', '🐈', '🐓', '🦃', '🦤', '🦚',
      '🦜', '🦢', '🦩', '🐇', '🦝', '🦨', '🦡', '🦫',
      '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔', '🐾',
    ],
  },
  {
    label: '食物',
    icon: '🍔',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇',
      '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥',
      '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️',
      '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠',
      '🥐', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈',
      '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔',
      '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯',
      '🫔', '🥗', '🥘', '🫕', '🍝', '🍜', '🍲', '🍛',
      '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘',
      '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦',
      '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫',
      '🍿', '🍩', '🍪', '☕', '🍵', '🥤', '🧋', '🍺',
      '🍻', '🥂', '🍷', '🥃', '🍹', '🧃',
    ],
  },
  {
    label: '活动',
    icon: '⚽',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉',
      '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍',
      '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿',
      '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌',
      '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️',
      '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽',
      '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉',
      '🎮', '🕹️', '🎲', '🎯', '🎳', '♠️', '♥️',
      '♦️', '♣️', '🃏', '🎴', '🎤', '🎧', '🎼', '🎹',
      '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎬', '🎨',
      '🚀', '✈️', '⛵', '🚗', '🏍️', '🚲', '🗺️', '🎡',
    ],
  },
  {
    label: '物品',
    icon: '💡',
    emojis: [
      '💡', '🔔', '📢', '📣', '💬', '💭', '🗯️', '📝',
      '📌', '📎', '✏️', '🖊️', '📖', '📚', '🔖', '🧷',
      '⏰', '⌚', '⏳', '📅', '📆', '📊', '📈', '📉',
      '🔒', '🔓', '🔑', '🗝️', '🔨', '🛠️', '⚙️', '🧰',
      '🔧', '🔩', '⚖️', '🧲', '💣', '🧨', '💊', '🩺',
      '🌡️', '🧹', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁',
      '🛎️', '🚪', '🪑', '🛋️', '🛏️', '🖼️', '🛍️', '🎁',
      '💰', '💴', '💵', '💳', '💎', '🪜', '🧯', '🌂',
      '☂️', '✅', '❎', '💯', '🔝',
    ],
  },
];

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export default function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const [activeCategory, setActiveCategory] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (rootRef.current?.contains(target as Node)) return;
      // 工具栏上的“表情”切换按钮与面板同在 .emoji-anchor 内，交给按钮自身处理开关
      if (target?.closest('.emoji-anchor')) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // 阻止 mousedown 抢焦点，保证表情插入到编辑器光标处
  const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault();

  const category = CATEGORIES[activeCategory];

  return (
    <div className="emoji-panel" ref={rootRef} onMouseDown={keepEditorFocus}>
      <div className="emoji-panel-tabs">
        {CATEGORIES.map((c, i) => (
          <button
            key={c.label}
            type="button"
            className={`emoji-tab ${i === activeCategory ? 'emoji-tab-active' : ''}`}
            title={c.label}
            onClick={() => setActiveCategory(i)}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <div className="emoji-grid" role="listbox" aria-label={`${category.label}表情`}>
        {category.emojis.map((emoji, idx) => (
          <button
            key={`${emoji}-${idx}`}
            type="button"
            className="emoji-item"
            role="option"
            aria-label={emoji}
            onClick={() => onPick(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
