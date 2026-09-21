import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { highlightCodeElement } from '../highlight';
import type { ChatMessage } from '../types';

interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  showAuthor: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 由用户名生成稳定的头像色相，同一用户始终同色 */
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 68% 52%)`;
}

/** 展示前再次净化（服务端已净化一次，这里做浏览器端纵深防御） */
function renderSafe(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del',
      'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote',
      'a', 'code', 'pre', 'span', 'img',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'class'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/|#)/i,
  });
}

export default function MessageBubble({ message, mine, showAuthor }: MessageBubbleProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // 挂载后对未带 hljs 标记的代码块做高亮
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.querySelectorAll('pre code:not(.hljs)').forEach((block) => {
      highlightCodeElement(block as HTMLElement);
    });
  }, [message.content]);

  const avatar = (
    <span
      className={`avatar avatar-msg${mine ? ' avatar-mine' : ''}`}
      style={mine ? undefined : { background: avatarColor(message.senderName) }}
      aria-hidden
    >
      {message.senderName.slice(0, 1).toUpperCase()}
    </span>
  );

  return (
    <div className={`message ${mine ? 'message-mine' : ''} ${showAuthor ? '' : 'message-grouped'}`}>
      {/* 头像列：合并消息时用同尺寸占位，保证气泡左缘对齐 */}
      <div className="message-avatar-col">{showAuthor ? avatar : <span className="avatar-spacer" />}</div>

      <div className="message-main">
        {showAuthor && (
          <div className="message-author">
            <span className="message-author-name">{mine ? '我' : message.senderName}</span>
            <span className="message-author-time">{formatTime(message.createdAt)}</span>
          </div>
        )}
        <div className="message-row">
          <div
            ref={bodyRef}
            className="message-bubble prose-content"
            dangerouslySetInnerHTML={{ __html: renderSafe(message.content) }}
          />
          {mine && message.kind === 'public' && (
            <span className="message-read">
              {message.readCount && message.readCount > 0 ? `${message.readCount} 人已读` : '未读'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
