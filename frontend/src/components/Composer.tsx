import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { uploadImage } from '../api.js';
import { renderMarkdown } from '../lib/markdown.js';

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

type ViewMode = 'edit' | 'split' | 'preview';

const FENCE_RE = /```/;

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
  const [view, setView] = useState<ViewMode>('edit');
  const [pasteActive, setPasteActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Switch to a side-by-side view automatically once the draft contains a
  // fenced code block, so the highlighted block is previewed in real time.
  // With an empty draft, always show the textarea so input is never blocked.
  const hasCodeBlock = FENCE_RE.test(value);
  let effectiveView: ViewMode =
    view === 'edit' && hasCodeBlock ? 'split' : view === 'split' && !hasCodeBlock ? 'edit' : view;
  if (!value.trim() && effectiveView === 'preview') effectiveView = 'edit';

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

  async function uploadAndEmbed(file: File): Promise<void> {
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

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    await uploadAndEmbed(file);
  }

  // Clipboard paste: images are uploaded directly instead of being ignored.
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          void uploadAndEmbed(file);
          return;
        }
      }
    }
  }

  function onDragOver(event: React.DragEvent<HTMLTextAreaElement>): void {
    event.preventDefault();
    setPasteActive(true);
  }

  function onDragLeave(): void {
    setPasteActive(false);
  }

  function onDrop(event: React.DragEvent<HTMLTextAreaElement>): void {
    event.preventDefault();
    setPasteActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadAndEmbed(file);
  }

  const previewHtml = value.trim()
    ? renderMarkdown(value)
    : '';

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
          title="上传图片（PNG / JPEG / GIF / WebP，≤5MB），也可直接粘贴或拖拽"
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
        <span className="composer-mode-switch">
          <button
            type="button"
            className={effectiveView === 'edit' ? 'active' : ''}
            onClick={() => setView('edit')}
            title="仅编辑"
          >
            编辑
          </button>
          <button
            type="button"
            className={effectiveView === 'split' ? 'active' : ''}
            onClick={() => setView('split')}
            title="编辑与预览并排"
          >
            分屏
          </button>
          <button
            type="button"
            className={effectiveView === 'preview' ? 'active' : ''}
            onClick={() => setView('preview')}
            title="实时预览渲染效果"
          >
            预览
          </button>
        </span>
      </div>

      <div className="composer-row">
        {effectiveView !== 'preview' && (
          <textarea
            ref={textareaRef}
            className={`composer-input ${pasteActive ? 'paste-active' : ''}`}
            value={value}
            placeholder={disabled ? disabledHint ?? placeholder : placeholder}
            disabled={disabled}
            rows={effectiveView === 'split' ? 9 : 3}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
        )}
        {effectiveView !== 'edit' && (
          <div className={`composer-preview markdown-body ${value.trim() ? '' : 'preview-empty'}`}>
            {value.trim() ? (
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            ) : (
              '输入内容后此处实时预览，代码块会按语法高亮渲染'
            )}
          </div>
        )}
        <button
          type="button"
          className="send-button"
          disabled={disabled || uploading || !value.trim()}
          onClick={send}
        >
          {uploading ? '上传中…' : '发送'}
        </button>
      </div>
      <div className="composer-paste-hint">
        支持 Markdown，可直接 Ctrl/⌘+V 粘贴截图，或拖拽图片到输入框
      </div>
    </div>
  );
}
