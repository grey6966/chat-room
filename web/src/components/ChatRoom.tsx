import { useState } from 'react';
import type { ChatMessage, OnlineUser, SendAck } from '../types';
import MessageList from './MessageList';
import RichTextEditor from './RichTextEditor';

interface DmConversation {
  peer: string;
  messages: ChatMessage[];
  unread: number;
  loaded: boolean;
}

interface ChatRoomProps {
  me: string;
  connectionState: 'connected' | 'disconnected';
  onlineUsers: OnlineUser[];
  messages: ChatMessage[];
  view: string; // 'public' 或私聊对象
  conversations: Map<string, DmConversation>;
  onOpenConversation: (peer: string) => void;
  onBackToPublic: () => void;
  onSend: (html: string) => Promise<SendAck>;
  onLoadOlder?: () => Promise<void>;
  onUploadImage: (file: File) => Promise<string>;
  onLogout: () => void;
}

export default function ChatRoom({
  me,
  connectionState,
  onlineUsers,
  messages,
  view,
  conversations,
  onOpenConversation,
  onBackToPublic,
  onSend,
  onLoadOlder,
  onUploadImage,
  onLogout,
}: ChatRoomProps) {
  const others = onlineUsers.filter((u) => u.username !== me);
  const totalUnread = [...conversations.values()].reduce((n, c) => n + c.unread, 0);

  // 移动端“侧栏 / 聊天区”切换（桌面端 CSS 媒体查询会忽略该状态）
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const openPublic = () => {
    onBackToPublic();
    setMobileChatOpen(true);
  };

  return (
    <div className={`app ${mobileChatOpen ? 'mobile-show' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-title">💬 聊天室</span>
          <button className="logout-btn" title="退出登录" onClick={onLogout}>
            退出
          </button>
        </div>

        <div className="user-me">
          <span className="avatar avatar-me">{me.slice(0, 1).toUpperCase()}</span>
          <div className="user-meta">
            <span className="user-name">{me}</span>
            <span className="user-status">
              <i className={`dot ${connectionState === 'connected' ? 'dot-on' : 'dot-off'}`} />
              {connectionState === 'connected' ? '在线' : '连接已断开，重连中…'}
            </span>
          </div>
        </div>

        <div
          className={`channel ${view === 'public' ? 'channel-active' : ''}`}
          onClick={openPublic}
        >
          <span className="channel-icon">#</span>
          <span className="channel-name">公共频道</span>
          {totalUnread > 0 && view !== 'public' && <span className="badge">{totalUnread}</span>}
        </div>

        <div className="online-title">在线用户 · {onlineUsers.length}</div>
        <div className="user-list">
          {others.length === 0 && <div className="online-empty">暂时只有你一个人</div>}
          {others.map((u) => {
            const conv = conversations.get(u.username);
            const active = view === u.username;
            return (
              <div
                key={u.id}
                className={`user-item ${active ? 'user-item-active' : ''}`}
                onClick={() => {
                  onOpenConversation(u.username);
                  setMobileChatOpen(true);
                }}
              >
                <span className="avatar">{u.username.slice(0, 1).toUpperCase()}</span>
                <span className="user-name">{u.username}</span>
                <i className="dot dot-on" title="在线" />
                {conv && conv.unread > 0 && !active && (
                  <span className="badge">{conv.unread}</span>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <main className="main">
        <header className="main-header">
          {view !== 'public' && (
            <button
              className="back-btn"
              onClick={() => setMobileChatOpen(false)}
              title="返回列表"
            >
              ‹
            </button>
          )}
          <span className="main-title">
            {view === 'public' ? '# 公共频道' : `🔒 与 ${view} 的私聊`}
          </span>
          <span className="main-subtitle">
            {view === 'public' ? `${onlineUsers.length} 人在线` : '仅双方可见'}
          </span>
        </header>

        <MessageList me={me} messages={messages} onLoadOlder={view === 'public' ? onLoadOlder : undefined} />

        <RichTextEditor resetKey={view} onSend={onSend} onUploadImage={onUploadImage} />
      </main>
    </div>
  );
}
