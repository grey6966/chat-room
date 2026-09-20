import { useRef, useState, type KeyboardEvent } from 'react';
import { uploadImage } from '../api.js';

interface ComposerProps {
  token: string;
  placeholder: string;
  disabled?: boolean;
  disabledHint?: string;
  onSend: (content: string) => void;
}

interface Tool {
  title: string;
  icon: string;
  apply: (sel: string) => { text: string; cursor?: number };
}

const TOOLS: Tool[] = [
  { title: '加粗', icon: 'B', apply: (s) => ({ text: `**${s || '加粗文本'}**` }) },
  { title: '斜体', icon: 'I', apply: (s) => ({ text: `*${s || '斜体文本'}*` }) },
  { title: '删除线', icon: 'S', apply: (s) => ({ text: `~~${s || '删除文本'}~~` }) },
  {
    title: '链接',
    icon: '🔗',
    apply: (s) => ({ text: `[${s || '链接文字'}](https://example.com)` }),
  },
  {
    title: '代码块',
    icon: '</>',
    apply: (s) => ({ text: `\n\`\`\`js\n${s || "console.log('hello')"}\n\`\`\`\n` }),
  },
  {
    title: '行内代码',
    icon: '`',
    apply: (s) => ({ text: `\`${s || 'code'}\`` }),
  },
  { title: '引用', icon: '❝', apply: (s) => ({ text: `> ${s || '引用内容'}` }) },
  {
    title: '无序列表',
    icon: '•≡',
    apply: (s) => ({ text: `\n- ${s.split('\n').join('\n- ') || '列表项'}\n` }),
  },
];

export default function Composer({
  token,
  placeholder,
  disabled = false,
  disabledHint,
  onSend,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function insertText(text: string): void {
    const el = textareaRef.current;
    if (!el) {
      setValue((v) => v + text);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function applyTool(tool: Tool): void {
    const el = textareaRef.current;
    const selected = el ? value.slice(el.selectionStart, el.selectionEnd) : '';
    const { text } = tool.apply(selected);
    insertText(text);
  }

  function send(): void {
    const content = value.trim();
    if (!content || disabled || uploading) return;
    onSend(content);
    setValue('');
    setError(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('只能上传图片文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5 MB');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(token, file);
      insertText(`\n![${file.name.replace(/[\[\]]/g, '')}](${url})\n`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '图片上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="composer">
      {error && <div className="composer-error">{error}</div>}
      <div className="composer-toolbar">
        {TOOLS.map((tool) => (
          <button
            key={tool.title}
            type="button"
            className="tool-button"
            title={tool.title}
            disabled={disabled || uploading}
            onClick={() => applyTool(tool)}
          >
            {tool.icon}
          </button>
        ))}
        <button
          type="button"
          className="tool-button"
          title="上传图片（PNG / JPEG / GIF / WebP，≤5MB）"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          🖼
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <span className="composer-hint">支持 Markdown</span>
      </div>

      <div className="composer-row">
        <textarea
          ref={textareaRef}
          className="composer-input"
          value={value}
          placeholder={disabled ? disabledHint ?? placeholder : placeholder}
          disabled={disabled}
          rows={3}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="send-button"
          disabled={disabled || uploading || !value.trim()}
          onClick={send}
        >
          {uploading ? '上传中…' : '发送'}
        </button>
      </div>
    </div>
  );
}
