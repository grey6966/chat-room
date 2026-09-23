import { useEffect, useRef, useState } from 'react';
import { Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { CodeBlock, CODE_LANGUAGES } from './CodeBlock';
import EmojiPicker from './EmojiPicker';
import type { SendAck } from '../types';

interface EditorToolbarProps {
  editor: Editor;
  onPickImage: () => void;
  onToggleEmoji: () => void;
  emojiOpen: boolean;
  uploading: boolean;
}

function Toolbar({ editor, onPickImage, onToggleEmoji, emojiOpen, uploading }: EditorToolbarProps) {
  const btn = (active: boolean) => `toolbar-btn${active ? ' active' : ''}`;

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('输入链接地址', previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="toolbar">
      <button
        type="button"
        title="表情"
        className={btn(emojiOpen)}
        onClick={onToggleEmoji}
        onPointerDown={(e) => {
          // 阻止编辑器失焦（保留光标位置），并阻止面板的“点击外部关闭”逻辑
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        🙂
      </button>
      <span className="toolbar-sep" />
      <button
        type="button"
        title="粗体"
        className={btn(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </button>
      <button
        type="button"
        title="斜体"
        className={btn(editor.isActive('italic'))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i>I</i>
      </button>
      <button
        type="button"
        title="下划线"
        className={btn(editor.isActive('underline'))}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <u>U</u>
      </button>
      <button
        type="button"
        title="删除线"
        className={btn(editor.isActive('strike'))}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </button>
      <span className="toolbar-sep" />
      <button
        type="button"
        title="行内代码"
        className={btn(editor.isActive('code'))}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {'</>'}
      </button>
      <button
        type="button"
        title="代码块"
        className={btn(editor.isActive('codeBlock'))}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        {'{ }'}
      </button>
      {editor.isActive('codeBlock') && (
        <select
          className="code-lang-select"
          title="代码语言"
          value={(editor.getAttributes('codeBlock').language as string | null) ?? 'plaintext'}
          onChange={(e) => {
            const lang = e.target.value;
            editor
              .chain()
              .focus()
              .updateAttributes('codeBlock', { language: lang === 'plaintext' ? null : lang })
              .run();
          }}
        >
          {CODE_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      )}
      <span className="toolbar-sep" />
      <button
        type="button"
        title="无序列表"
        className={btn(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •≡
      </button>
      <button
        type="button"
        title="有序列表"
        className={btn(editor.isActive('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1≡
      </button>
      <button
        type="button"
        title="引用"
        className={btn(editor.isActive('blockquote'))}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </button>
      <span className="toolbar-sep" />
      <button
        type="button"
        title="插入链接"
        className={btn(editor.isActive('link'))}
        onClick={setLink}
      >
        🔗
      </button>
      <button
        type="button"
        title="发送图片（也可直接粘贴/拖拽到输入框）"
        className={btn(false)}
        onClick={onPickImage}
        disabled={uploading}
      >
        {uploading ? '⏳' : '🖼'}
      </button>
    </div>
  );
}

interface RichTextEditorProps {
  resetKey: string;
  onSend: (html: string) => Promise<SendAck>;
  onUploadImage: (file: File) => Promise<string>;
}

/** 从粘贴/拖放事件中提取第一张图片（截图粘贴有时只出现在 items 里） */
function pickImageFile(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  const fromItems = Array.from(data.items ?? [])
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .find((f): f is File => !!f && f.type.startsWith('image/'));
  if (fromItems) return fromItems;
  return Array.from(data.files ?? []).find((f) => f.type.startsWith('image/')) ?? null;
}

export default function RichTextEditor({ resetKey, onSend, onUploadImage }: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [sendError, setSendError] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);

  // 最新回调通过 ref 转发，保证 TipTap 只创建一次的 keydown 处理器不会拿到旧闭包
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onUploadRef = useRef(onUploadImage);
  onUploadRef.current = onUploadImage;
  const sendFnRef = useRef<() => void>(() => undefined);

  const insertImageFile = async (editor: Editor, file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const url = await onUploadRef.current(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : '图片上传失败');
      setTimeout(() => setSendError(''), 3000);
    } finally {
      setUploading(false);
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', class: 'msg-link' },
      }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder: '输入消息，Enter 发送，Shift+Enter 换行…' }),
      CodeBlock,
    ],
    editorProps: {
      handlePaste: (_view, event) => {
        const image = pickImageFile(event.clipboardData);
        if (image && editor) {
          void insertImageFile(editor, image);
          return true;
        }
        return false; // 普通 HTML/文本走默认粘贴
      },
      handleDrop: (_view, event) => {
        const image = pickImageFile(event.dataTransfer);
        if (image && editor) {
          event.preventDefault();
          void insertImageFile(editor, image);
          return true;
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          sendFnRef.current();
          return true;
        }
        return false;
      },
    },
  });

  const insertEmoji = (emoji: string) => {
    if (!editor) return;
    // insertContent 会自动恢复焦点并在记录的光标处插入（点击面板导致的失焦不影响选区）
    editor.chain().focus().insertContent(emoji).run();
  };

  const doSend = async () => {
    if (!editor) return;
    const html = editor.getHTML();
    const hasText = editor.getText().trim().length > 0;
    const hasImage = html.includes('<img');
    if (!hasText && !hasImage) return;
    try {
      const ack = await onSendRef.current(html);
      if (ack.ok) {
        editor.commands.clearContent(true);
        setSendError('');
      } else {
        setSendError(ack.error);
        setTimeout(() => setSendError(''), 3000);
      }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : '发送失败，请重试');
      setTimeout(() => setSendError(''), 3000);
    }
  };
  sendFnRef.current = doSend;

  // 切换会话时清空草稿
  useEffect(() => {
    editor?.commands.clearContent(true);
    setSendError('');
    setEmojiOpen(false);
  }, [resetKey, editor]);

  return (
    <div className="editor-wrap">
      {editor && (
        <div className="toolbar-zone">
          <Toolbar
            editor={editor}
            onPickImage={() => fileInputRef.current?.click()}
            onToggleEmoji={() => setEmojiOpen((v) => !v)}
            emojiOpen={emojiOpen}
            uploading={uploading}
          />
          {emojiOpen && (
            <EmojiPicker onPick={insertEmoji} onClose={() => setEmojiOpen(false)} />
          )}
        </div>
      )}
      <div className="editor-scroll">
        <EditorContent editor={editor} />
      </div>
      {sendError && <div className="editor-error">{sendError}</div>}
      <div className="editor-footer">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && editor) void insertImageFile(editor, file);
            e.target.value = '';
          }}
        />
        <span className="editor-hint">支持富文本 · 代码块 · Ctrl/Cmd+V 直接粘贴截图（≤5MB）</span>
        <button type="button" className="btn-primary btn-send" onClick={doSend} disabled={uploading}>
          发送
        </button>
      </div>
    </div>
  );
}
