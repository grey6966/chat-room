import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  me: string;
  messages: ChatMessage[];
  onLoadOlder?: () => Promise<void>;
}

export default function MessageList({ me, messages, onLoadOlder }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // 新消息时：若已在底部附近则贴底，否则保留滚动位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
    <div className="message-list" ref={scrollRef}>
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
    </div>
  );
}
