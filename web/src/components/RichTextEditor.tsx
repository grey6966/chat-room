import { useEffect, useRef, useState } from 'react';
import { Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { CODE_LANGUAGES, lowlight } from '../highlight';
import type { SendAck } from '../types';

interface EditorToolbarProps {
  editor: Editor;
  onPickImage: () => void;
  uploading: boolean;
}

function Toolbar({ editor, onPickImage, uploading }: EditorToolbarProps) {
  const btn = (active: boolean) => `toolbar-btn${active ? ' active' : ''}`;

  // TipTap 的激活态不会触发 React 重渲染，订阅事务以刷新工具栏按钮/语言下拉
  const [, forceSync] = useState(0);
  useEffect(() => {
    const onUpdate = () => forceSync((n) => n + 1);
    editor.on('transaction', onUpdate);
    editor.on('selectionUpdate', onUpdate);
    return () => {
      editor.off('transaction', onUpdate);
      editor.off('selectionUpdate', onUpdate);
    };
  }, [editor]);

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
          title="代码语言（实时高亮预览）"
          value={(editor.getAttributes('codeBlock').language as string | undefined) ?? ''}
          onChange={(e) =>
            editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value || null }).run()
          }
        >
          <option value="">纯文本</option>
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

export default function RichTextEditor({ resetKey, onSend, onUploadImage }: RichTextEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [sendError, setSendError] = useState('');

  // 最新回调通过 ref 转发，保证 TipTap 只创建一次的 keydown 处理器不会拿到旧闭包
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onUploadRef = useRef(onUploadImage);
  onUploadRef.current = onUploadImage;
  const sendFnRef = useRef<() => void>(() => undefined);

  /**
   * 插入图片：先用本地 objectURL 在编辑器里即时预览，
   * 上传成功后把对应 <img> 的 src 换成服务端地址，避免粘贴后长时间无反馈。
   */
  const insertImageFile = async (editor: Editor, file: File) => {
    if (!file.type.startsWith('image/')) return;
    const localUrl = URL.createObjectURL(file);
    const chain = editor.chain().focus();
    // 非空行内容后先换行，保证图片独占块级节点
    if (editor.getText().trim().length > 0) chain.insertContent('<p></p>');
    chain.setImage({ src: localUrl }).run();
    setPendingCount((n) => n + 1);
    setUploading(true);
    try {
      const url = await onUploadRef.current(file);
      // 用事务把本地预览地址替换为已上传地址
      const { state, view } = editor;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === localUrl) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: url });
        }
        return true;
      });
      view.dispatch(tr);
    } catch (e) {
      // 上传失败：移除本地预览节点并提示
      const { state, view } = editor;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.src === localUrl) {
          tr.delete(pos, pos + node.nodeSize);
        }
        return true;
      });
      view.dispatch(tr);
      setSendError(e instanceof Error ? e.message : '图片上传失败');
      setTimeout(() => setSendError(''), 3000);
    } finally {
      URL.revokeObjectURL(localUrl);
      setPendingCount((n) => {
        const next = n - 1;
        if (next === 0) setUploading(false);
        return next;
      });
    }
  };

  /** 从粘贴板提取图片：优先 files，部分浏览器（如 Safari 截图）只在 items 里给出 */
  function extractClipboardImages(data: DataTransfer | null | undefined): File[] {
    if (!data) return [];
    const fromFiles = Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (fromFiles.length > 0) return fromFiles;
    const items = data.items;
    if (!items) return [];
    const result: File[] = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f && f.type.startsWith('image/')) result.push(f);
      }
    }
    return result;
  }

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
      CodeBlockLowlight.configure({ lowlight }),
    ],
    editorProps: {
      handlePaste: (_view, event) => {
        const images = extractClipboardImages(event.clipboardData);
        if (images.length > 0 && editor) {
          images.forEach((f) => void insertImageFile(editor, f));
          return true; // 截获粘贴：图片走上传，不把图片当普通文本插入
        }
        return false; // 普通 HTML/文本走默认粘贴
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length > 0 && editor) {
          event.preventDefault();
          images.forEach((f) => void insertImageFile(editor, f));
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

  const doSend = async () => {
    if (!editor) return;
    if (pendingCount > 0) {
      setSendError('图片还在上传，请稍候…');
      setTimeout(() => setSendError(''), 3000);
      return;
    }
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
  }, [resetKey, editor]);

  return (
    <div className="editor-wrap">
      {editor && <Toolbar editor={editor} onPickImage={() => fileInputRef.current?.click()} uploading={uploading} />}
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
        <span className="editor-hint">
          {pendingCount > 0 ? `图片上传中…（${pendingCount}）` : '支持富文本 · 代码块 · 图片（可直接 Ctrl/⌘+V 粘贴，≤5MB）'}
        </span>
        <button type="button" className="btn-primary btn-send" onClick={doSend} disabled={uploading}>
          发送
        </button>
      </div>
    </div>
  );
}
