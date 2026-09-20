import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
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
  socket?: Socket;
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

/** Is this message the latest one in a run from the same sender? (used to
 * avoid stamping every consecutive bubble with a read receipt.) */
function isLastInRun(timeline: TimelineEntry[], index: number): boolean {
  const current = timeline[index];
  if (current?.kind !== 'message') return false;
  for (let i = index + 1; i < timeline.length; i++) {
    const next = timeline[i];
    if (next.kind !== 'message') continue;
    return next.message.sender !== current.message.sender;
  }
  return true;
}

export default function MessageList({
  kind,
  currentUser,
  messages,
  notices,
  loading = false,
  emptyText,
  socket,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastReadReportRef = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [readersFor, setReadersFor] = useState<{
    id: number;
    x: number;
    y: number;
    names: string[] | null;
  } | null>(null);
  const timeline = useMemo(() => buildTimeline(messages, notices), [messages, notices]);
  const lastMessageId = messages[messages.length - 1]?.id ?? 0;

  const reportRead = (maxId: number): void => {
    if (kind !== 'channel' || !socket || maxId <= 0) return;
    if (maxId === lastReadReportRef.current) return;
    lastReadReportRef.current = maxId;
    socket.emit('channel:read', { upTo: maxId });
  };

  // Keep pinned to the newest message unless the user scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      // Newly visible messages count as read while following the live tail.
      reportRead(lastMessageId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline.length, lastMessageId]);

  // On first mount / channel switch, whatever is on screen is read.
  useEffect(() => {
    lastReadReportRef.current = 0;
    stickToBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    reportRead(lastMessageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function onScroll(): void {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) reportRead(lastMessageId);
  }

  function scrollToBottom(): void {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stickToBottomRef.current = true;
    setAtBottom(true);
    reportRead(lastMessageId);
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

  function showReaders(event: React.MouseEvent, message: ChatMessage): void {
    if (!socket) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setReadersFor({ id: message.id, x: rect.left, y: rect.top - 8, names: null });
    void socket
      .timeout(5000)
      .emitWithAck('channel:readers', { messageId: message.id })
      .then((res: { ok: boolean; readers?: string[] }) => {
        if (res.ok) setReadersFor((cur) => (cur?.id === message.id ? { ...cur, names: res.readers ?? [] } : cur));
      })
      .catch(() => setReadersFor(null));
  }

  const isEmpty = !loading && messages.length === 0 && (kind === 'direct' || notices.length === 0);

  return (
    <div className="message-list-wrap">
      <div className="message-list" ref={scrollRef} onScroll={onScroll}>
        {loading && <div className="list-hint">正在加载历史消息…</div>}

        {isEmpty && <div className="list-empty">{emptyText}</div>}

        {timeline.map((entry, index) => {
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
          const showReceipt =
            kind === 'channel' && mine && isLastInRun(timeline, index);
          const readCount = message.readByCount ?? 0;

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
                {showReceipt && (
                  <div
                    className={`message-reads ${readCount > 0 ? 'read' : ''}`}
                    title={socket ? '点击查看已读用户' : undefined}
                    onClick={socket ? (e) => showReaders(e, message) : undefined}
                  >
                    <span className="read-double">✓✓</span>
                    {readCount > 0 ? `${readCount} 人已读` : '未读'}
                  </div>
                )}
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

      {!atBottom && (
        <button type="button" className="scroll-bottom" onClick={scrollToBottom}>
          <span className="arrow">↓</span> 回到底部
        </button>
      )}

      {readersFor && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 119 }}
            onClick={() => setReadersFor(null)}
          />
          <div
            className="readers-popover"
            style={{
              position: 'fixed',
              left: Math.min(readersFor.x, window.innerWidth - 260),
              top: Math.max(8, readersFor.y - 10),
              transform: 'translateY(-100%)',
            }}
          >
            <div className="readers-title">
              已读用户（{readersFor.names?.length ?? '…'}）
            </div>
            {readersFor.names === null
              ? '加载中…'
              : readersFor.names.length > 0
                ? readersFor.names.join('、')
                : '还没有人读到这条消息'}
          </div>
        </>
      )}
    </div>
  );
}
