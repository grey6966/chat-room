import { useEffect, useMemo, useRef, useState } from 'react';
import { avatarColor, dayLabel, formatTimestamp, initials } from '../lib/format.js';
import { renderMarkdown } from '../lib/markdown.js';
import type { ChatMessage, ChatNotice } from '../types.js';

interface MessageListProps {
  kind: 'channel' | 'direct';
  currentUser: string;
  messages: ChatMessage[];
  notices: ChatNotice[];
  loading?: boolean;
  emptyText: string;
}

type TimelineEntry =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'notice'; notice: ChatNotice }
  | { kind: 'message'; message: ChatMessage; showMeta: boolean };

/** Merge messages and system notices into one chronological timeline. */
function buildTimeline(
  messages: ChatMessage[],
  notices: ChatNotice[]
): TimelineEntry[] {
  const entries: Array<
    | { kind: 'notice'; notice: ChatNotice }
    | { kind: 'message'; message: ChatMessage }
  > = [
    ...messages.map((message) => ({ kind: 'message' as const, message })),
    ...notices.map((notice) => ({ kind: 'notice' as const, notice })),
  ];
  entries.sort(
    (a, b) =>
      (a.kind === 'message' ? a.message.createdAt : a.notice.createdAt) -
      (b.kind === 'message' ? b.message.createdAt : b.notice.createdAt)
  );

  const timeline: TimelineEntry[] = [];
  let currentDay = '';
  for (const entry of entries) {
    const ts = entry.kind === 'message' ? entry.message.createdAt : entry.notice.createdAt;
    const day = new Date(ts).toDateString();
    if (day !== currentDay) {
      currentDay = day;
      timeline.push({ kind: 'day', key: `day-${day}`, label: dayLabel(ts) });
    }
    if (entry.kind === 'notice') {
      timeline.push({ kind: 'notice', notice: entry.notice });
    } else {
      const prev = [...timeline].reverse().find((e) => e.kind === 'message');
      const prevMessage = prev?.kind === 'message' ? prev.message : undefined;
      const showMeta =
        !prevMessage ||
        prevMessage.sender !== entry.message.sender ||
        entry.message.createdAt - prevMessage.createdAt > 5 * 60_000;
      timeline.push({ kind: 'message', message: entry.message, showMeta });
    }
  }
  return timeline;
}

export default function MessageList({
  kind,
  currentUser,
  messages,
  notices,
  loading = false,
  emptyText,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const timeline = useMemo(() => buildTimeline(messages, notices), [messages, notices]);

  // Keep pinned to the newest message unless the user scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [timeline.length]);

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Delegated copy for code blocks; image clicks open the lightbox.
  function onContentClick(event: React.MouseEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (target.closest('.copy-code')) {
      const pre = target.closest('.code-block') as HTMLElement | null;
      if (pre) void navigator.clipboard?.writeText(pre.innerText);
      target.textContent = '已复制';
      setTimeout(() => {
        target.textContent = '复制';
      }, 1500);
      return;
    }
    const img = target.closest('img') as HTMLImageElement | null;
    if (img) {
      setLightbox(img.src);
    }
  }

  const isEmpty = !loading && messages.length === 0 && (kind === 'direct' || notices.length === 0);

  return (
    <div className="message-list" ref={scrollRef} onScroll={onScroll}>
      {loading && <div className="list-hint">正在加载历史消息…</div>}

      {isEmpty && <div className="list-empty">{emptyText}</div>}

      {timeline.map((entry) => {
        if (entry.kind === 'day') {
          return (
            <div className="day-divider" key={entry.key}>
              <span>{entry.label}</span>
            </div>
          );
        }

        if (entry.kind === 'notice') {
          return (
            <div className="system-notice" key={entry.notice.id}>
              <span className="status-dot online" />
              {entry.notice.username} {entry.notice.kind === 'join' ? '加入了聊天室' : '离开了聊天室'}
            </div>
          );
        }

        const { message, showMeta } = entry;
        const mine = message.sender === currentUser;
        const senderName = mine ? '我' : message.sender;

        return (
          <div className={`message-row ${mine ? 'mine' : ''} ${showMeta ? '' : 'continued'}`} key={message.id}>
            {showMeta ? (
              <span className="message-avatar" style={{ background: avatarColor(message.sender) }}>
                {initials(message.sender)}
              </span>
            ) : (
              <span className="message-time-continued">
                {new Date(message.createdAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
            <div className="message-body">
              {showMeta && (
                <div className="message-meta">
                  <span className="message-sender">{senderName}</span>
                  <span className="message-time" title={new Date(message.createdAt).toLocaleString('zh-CN')}>
                    {formatTimestamp(message.createdAt)}
                  </span>
                </div>
              )}
              <div
                className="message-content markdown-body"
                onClick={onContentClick}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
              />
            </div>
          </div>
        );
      })}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="放大预览" />
          <div className="lightbox-hint">点击任意位置关闭</div>
        </div>
      )}
    </div>
  );
}
