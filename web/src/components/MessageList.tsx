import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  me: string;
  messages: ChatMessage[];
  onLoadOlder?: () => Promise<void>;
  onReadMessages?: (lastId: number) => void;
}

const NEAR_BOTTOM_PX = 160;

export default function MessageList({ me, messages, onLoadOlder, onReadMessages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setAtBottom(true);
  }, []);

  // 新消息时：若已在底部附近则贴底，否则保留滚动位置；在底部时上报已读
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || messages.length === 0) return;
    const nearBottom = isNearBottom();
    if (nearBottom) el.scrollTop = el.scrollHeight;
    setAtBottom(nearBottom);
    if (nearBottom && onReadMessages) {
      onReadMessages(messages[messages.length - 1].id);
    }
  }, [messages, isNearBottom, onReadMessages]);

  // 切换会话（组件复用）时直接回到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    if (onReadMessages && messages.length > 0) {
      onReadMessages(messages[messages.length - 1].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const near = isNearBottom();
    setAtBottom(near);
    if (near && onReadMessages && messages.length > 0) {
      onReadMessages(messages[messages.length - 1].id);
    }
  };

  const loadOlder = async () => {
    if (!onLoadOlder || loadingOlder) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    await onLoadOlder();
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
      setLoadingOlder(false);
    });
  };

  let lastSender = '';
  let lastTs = 0;

  return (
    <div className="message-list" ref={scrollRef} onScroll={onScroll}>
      {onLoadOlder && (
        <button className="load-older" onClick={loadOlder} disabled={loadingOlder}>
          {loadingOlder ? '加载中…' : '↑ 加载更早的消息'}
        </button>
      )}
      {messages.length === 0 && <div className="message-empty">暂无消息，说点什么吧</div>}
      {messages.map((m) => {
        // 同一发送者 5 分钟内的连续消息合并头像/昵称
        const showAuthor = m.senderName !== lastSender || m.createdAt - lastTs > 5 * 60_000;
        lastSender = m.senderName;
        lastTs = m.createdAt;
        return (
          <MessageBubble
            key={m.id}
            message={m}
            mine={m.senderName === me}
            showAuthor={showAuthor}
          />
        );
      })}

      {!atBottom && (
        <button className="back-to-bottom" onClick={() => scrollToBottom(true)} title="回到底部">
          ↓ 最新消息
        </button>
      )}
    </div>
  );
}
