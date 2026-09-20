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

  return (
    <div className={`message ${mine ? 'message-mine' : ''}`}>
      {showAuthor && <div className="message-author">{mine ? '我' : message.senderName}</div>}
      <div className="message-row">
        <div
          ref={bodyRef}
          className="message-bubble prose-content"
          dangerouslySetInnerHTML={{ __html: renderSafe(message.content) }}
        />
        <span className="message-time">{formatTime(message.createdAt)}</span>
      </div>
    </div>
  );
}
