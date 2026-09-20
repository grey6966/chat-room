import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
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
  const [preview, setPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const previewHtml = useMemo(() => renderMarkdown(value || '_暂无内容_', true), [value]);

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
    // The code-block tool inserts a fence; reveal the rendered result
    // immediately instead of leaving the user staring at ``` markers.
    if (tool.title === '代码块') setPreview(true);
  }

  function send(): void {
    const content = value.trim();
    if (!content || disabled || uploading) return;
    onSend(content);
    setValue('');
    setError(null);
    setPreview(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  async function handleFile(file: File | undefined): Promise<boolean> {
    if (!file) return false;
    if (!file.type.startsWith('image/')) {
      setError('只能上传图片文件');
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5 MB');
      return false;
    }
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(token, file);
      const safeName = (file.name || 'pasted-image').replace(/[\[\]]/g, '');
      insertText(`\n![${safeName}](${url})\n`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '图片上传失败');
      return false;
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** Clipboard paste: screenshots (and copied images) upload directly. */
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
          // Screenshots usually arrive as nameless blobs; give them one.
          const named = new File([file], file.name || `pasted-${Date.now()}.${ext}`, {
            type: file.type,
          });
          void handleFile(named);
          return;
        }
      }
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
          title="上传图片（PNG / JPEG / GIF / WebP，≤5MB），也可直接粘贴截图"
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
        <button
          type="button"
          className={`tool-button preview-toggle ${preview ? 'active' : ''}`}
          title={preview ? '切换回 Markdown 编辑' : '实时预览富文本效果'}
          disabled={disabled || uploading}
          onClick={() => setPreview((v) => !v)}
        >
          {preview ? '✏️ 编辑' : '👁 预览'}
        </button>
        <span className="composer-hint">支持 Markdown · 可直接粘贴图片</span>
      </div>

      <div className="composer-row">
        <div className="composer-editor">
          <textarea
            ref={textareaRef}
            className="composer-input"
            value={value}
            placeholder={disabled ? disabledHint ?? placeholder : placeholder}
            disabled={disabled}
            rows={3}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            hidden={preview}
          />
          {preview && (
            <div
              className="composer-preview markdown-body"
              title="点击返回编辑"
              onClick={() => {
                setPreview(false);
                requestAnimationFrame(() => textareaRef.current?.focus());
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </div>
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
