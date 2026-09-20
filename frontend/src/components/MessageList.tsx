import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { fetchChannelReaders, markChannelRead } from '../api.js';
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
  /** Channel lists use the socket to mark reads and fetch reader lists. */
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
  // Initialise to the newest loaded id so the first effect doesn't re-mark
  // history the server already counted at join time.
  const lastMarkedIdRef = useRef(messages[messages.length - 1]?.id ?? 0);
  const pendingMarkRef = useRef(0);
  const markTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [readersFor, setReadersFor] = useState<{
    messageId: number;
    top: number;
    right: number;
    placement: 'up' | 'down';
    names: string[] | null;
  } | null>(null);

  const timeline = useMemo(() => buildTimeline(messages, notices), [messages, notices]);

  const lastMessage = messages[messages.length - 1];

  // Throttled read reporting: in a busy room many messages may arrive per
  // second; coalesce them into at most one mark every 600ms.
  function scheduleMark(id: number): void {
    if (!socket) return;
    pendingMarkRef.current = id;
    if (markTimerRef.current !== null) return;
    markTimerRef.current = setTimeout(() => {
      markTimerRef.current = null;
      const pending = pendingMarkRef.current;
      // Don't mark if the user scrolled up while the timer was pending.
      if (!stickToBottomRef.current) return;
      if (pending > lastMarkedIdRef.current) {
        lastMarkedIdRef.current = pending;
        markChannelRead(socket!, pending);
      }
    }, 600);
  }

  function flushMark(): void {
    if (markTimerRef.current !== null) {
      clearTimeout(markTimerRef.current);
      markTimerRef.current = null;
    }
    const pending = pendingMarkRef.current;
    if (socket && pending > lastMarkedIdRef.current) {
      lastMarkedIdRef.current = pending;
      markChannelRead(socket, pending);
    }
  }

  // Report the newest visible channel message as read while pinned to the
  // bottom. Throttled; skips ids already reported.
  useEffect(() => {
    if (kind !== 'channel' || !socket || !stickToBottomRef.current || !lastMessage) return;
    if (lastMessage.id <= lastMarkedIdRef.current) return;
    scheduleMark(lastMessage.id);
  }, [kind, socket, lastMessage]);

  useEffect(
    () => () => {
      if (markTimerRef.current) clearTimeout(markTimerRef.current);
    },
    []
  );

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
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottomRef.current = bottom;
    setAtBottom(bottom);

    // Scrolled back down to the latest message also counts as "read".
    if (bottom && kind === 'channel' && socket && lastMessage) {
      if (lastMessage.id > lastMarkedIdRef.current) {
        flushMark();
      }
    }
  }

  function scrollToBottom(): void {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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

  async function onReadCountClick(event: React.MouseEvent, message: ChatMessage): Promise<void> {
    if (!socket) return;
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const placement = rect.top > window.innerHeight / 2 ? 'up' : 'down';
    setReadersFor({
      messageId: message.id,
      top: rect.top,
      right: Math.max(window.innerWidth - rect.right, 12),
      placement,
      names: null,
    });
    const names = await fetchChannelReaders(socket, message.id);
    setReadersFor((cur) =>
      cur && cur.messageId === message.id ? { ...cur, names } : cur
    );
  }

  function closeReaders(): void {
    setReadersFor(null);
  }

  const isEmpty = !loading && messages.length === 0 && (kind === 'direct' || notices.length === 0);

  return (
    <div className="message-list-wrap">
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
          // The sender themselves is always a reader; show others as "已读".
          const otherReaders = Math.max((message.readBy ?? 1) - 1, 0);

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
                {kind === 'channel' && mine && (
                  <button
                    type="button"
                    className={`read-receipt ${otherReaders > 0 ? 'read' : ''}`}
                    title={otherReaders > 0 ? '点击查看已读用户' : '暂无其他人已读'}
                    onClick={(e) => void onReadCountClick(e, message)}
                  >
                    {otherReaders > 0 ? `${otherReaders} 人已读` : '未读'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!atBottom && (
        <button type="button" className="scroll-bottom-btn" onClick={scrollToBottom}>
          ↓ 回到底部
        </button>
      )}

      {readersFor && (
        <>
          <div className="readers-popover-mask" onClick={closeReaders} />
          <div
            className={`readers-popover p-${readersFor.placement}`}
            style={{
              top: readersFor.placement === 'down' ? readersFor.top + 22 : undefined,
              bottom:
                readersFor.placement === 'up'
                  ? window.innerHeight - readersFor.top + 6
                  : undefined,
              right: readersFor.right,
            }}
          >
            <div className="readers-popover-title">
              已读用户（{readersFor.names?.length ?? '…'}）
            </div>
            {readersFor.names === null ? (
              <div className="readers-popover-loading">加载中…</div>
            ) : (
              <ul className="readers-popover-list">
                {readersFor.names.map((name) => (
                  <li key={name} title={name}>
                    <span className="reader-avatar" style={{ background: avatarColor(name) }}>
                      {initials(name)}
                    </span>
                    <span className="reader-name">{name === currentUser ? `${name}（我）` : name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="放大预览" />
          <div className="lightbox-hint">点击任意位置关闭</div>
        </div>
      )}
    </div>
  );
}
