import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../types';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  me: string;
  messages: ChatMessage[];
  resetKey: string;
  onLoadOlder?: () => Promise<void>;
  onVisibleMessage?: (messageId: number) => void;
}

const NEAR_BOTTOM_PX = 160;

export default function MessageList({ me, messages, resetKey, onLoadOlder, onVisibleMessage }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nearBottom, setNearBottom] = useState(true);
  const nearBottomRef = useRef(true);
  nearBottomRef.current = nearBottom;

  const onVisibleRef = useRef(onVisibleMessage);
  onVisibleRef.current = onVisibleMessage;

  const isNearBottom = (el: HTMLDivElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;

  const scrollToBottomSmooth = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // 新消息时：若已在底部附近则贴底，否则保留滚动位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // 切换会话：重置滚动状态并贴底，避免沿用上一个会话的滚动位置
  useEffect(() => {
    const el = scrollRef.current;
    setNearBottom(true);
    nearBottomRef.current = true;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // 贴底时把最新消息上报为已读（含首次进入、切回频道、滚动回到底部）
  useEffect(() => {
    const el = scrollRef.current;
    const last = messages[messages.length - 1];
    if (el && last && nearBottom) onVisibleRef.current?.(last.id);
  }, [messages, nearBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const at = isNearBottom(el);
    if (at !== nearBottomRef.current) setNearBottom(at);
    if (at) {
      const last = messages[messages.length - 1];
      if (last) onVisibleRef.current?.(last.id);
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

      {!nearBottom && (
        <button className="scroll-bottom-btn" onClick={scrollToBottomSmooth} title="回到底部">
          ↓ 回到底部
        </button>
      )}
    </div>
  );
}
