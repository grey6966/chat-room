import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPublicHistory,
  joinRoom,
  markPublicRead,
  openDm,
  sendDm,
  sendPublic,
  socket,
  uploadImage,
} from './api';
import type { ChatMessage, OnlineUser, PublicReadUpdate } from './types';
import { useTheme } from './theme';
import Login from './components/Login';
import ChatRoom from './components/ChatRoom';

interface DmConversation {
  peer: string;
  messages: ChatMessage[];
  unread: number;
  loaded: boolean;
}

type View = 'public' | string; // 'public' 或私聊对象用户名

export default function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [connectionState, setConnectionState] = useState<'connected' | 'disconnected'>(
    socket.connected ? 'connected' : 'disconnected'
  );

  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [publicMessages, setPublicMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Map<string, DmConversation>>(new Map());
  const [view, setView] = useState<View>('public');

  // 公共频道已读游标（我已上报/服务端已知的最新消息 id）
  const [lastReadId, setLastReadId] = useState<number | null>(null);
  const lastReadIdRef = useRef<number | null>(null);
  lastReadIdRef.current = lastReadId;

  // 主题（浅色/深色/跟随系统），登录页与聊天室共用
  const { mode: themeMode, cycleTheme } = useTheme();

  const usernameRef = useRef<string | null>(null);
  usernameRef.current = username;
  const viewRef = useRef<View>('public');
  viewRef.current = view;

  /* ---------- 登录 / 断线重连后重新加入 ---------- */
  const doJoin = useCallback(async (name: string) => {
    setConnecting(true);
    setLoginError('');
    try {
      const ack = await joinRoom(name);
      if (!ack.ok) {
        setLoginError(ack.error);
        return false;
      }
      localStorage.setItem('chat:username', name);
      setUsername(name);
      setPublicMessages(ack.recentMessages);
      setConversations(new Map());
      setView('public');
      setLastReadId(ack.lastReadMessageId);
      return true;
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : '连接失败');
      return false;
    } finally {
      setConnecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- socket 生命周期事件 ---------- */
  useEffect(() => {
    const onConnect = () => {
      setConnectionState('connected');
      // 断线重连后用原用户名静默重新加入（服务端内存在线表可能已随重启清空）
      const name = usernameRef.current;
      if (name) joinRoom(name).catch(() => undefined);
    };
    const onDisconnect = () => setConnectionState('disconnected');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  /* ---------- 业务事件 ---------- */
  useEffect(() => {
    const onPresence = (users: OnlineUser[]) => setOnlineUsers(users);

    const onPublic = (msg: ChatMessage) => {
      setPublicMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
      );
    };

    const onPublicRead = (update: PublicReadUpdate) => {
      setPublicMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.kind !== 'public') return m;
          const count = update.counts[String(m.id)];
          if (count === undefined || m.readByCount === count) return m;
          changed = true;
          return { ...m, readByCount: count };
        });
        return changed ? next : prev;
      });
    };

    const onDm = (msg: ChatMessage) => {
      const peer = msg.senderName === usernameRef.current ? msg.receiverName! : msg.senderName;
      const isActive = viewRef.current === peer;
      setConversations((prev) => {
        const next = new Map(prev);
        const conv = next.get(peer) ?? { peer, messages: [], unread: 0, loaded: true };
        if (!conv.messages.some((m) => m.id === msg.id)) {
          conv.messages = [...conv.messages, msg];
          if (!isActive && msg.senderName !== usernameRef.current) conv.unread += 1;
        }
        next.set(peer, { ...conv });
        return next;
      });
    };

    socket.on('presence:update', onPresence);
    socket.on('public:message', onPublic);
    socket.on('public:read', onPublicRead);
    socket.on('dm:message', onDm);
    return () => {
      socket.off('presence:update', onPresence);
      socket.off('public:message', onPublic);
      socket.off('public:read', onPublicRead);
      socket.off('dm:message', onDm);
    };
  }, []);

  /* ---------- 切换会话 ---------- */
  const openConversation = useCallback(async (peer: string) => {
    setView(peer);
    setConversations((prev) => {
      const conv = prev.get(peer);
      if (conv) {
        const next = new Map(prev);
        next.set(peer, { ...conv, unread: 0 });
        return next;
      }
      return prev;
    });

    if (!conversations.get(peer)?.loaded) {
      try {
        const ack = await openDm(peer);
        if (ack.ok) {
          setConversations((prev) => {
            const next = new Map(prev);
            next.set(peer, { peer, messages: ack.messages, unread: 0, loaded: true });
            return next;
          });
        }
      } catch {
        /* 保持空会话，用户可重试 */
      }
    }
  }, [conversations]);

  const backToPublic = useCallback(() => setView('public'), []);

  /* ---------- 发送消息 ---------- */
  const handleSend = useCallback(
    async (html: string) => {
      if (view === 'public') return sendPublic(html);
      return sendDm(view, html);
    },
    [view]
  );

  /* ---------- 上翻加载更早的频道历史 ---------- */
  const loadOlderPublic = useCallback(async () => {
    const first = publicMessages[0];
    if (!first) return;
    try {
      const ack = await fetchPublicHistory(first.id);
      if (ack.ok && ack.messages.length > 0) {
        setPublicMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          return [...ack.messages.filter((m) => !known.has(m.id)), ...prev];
        });
      }
    } catch {
      /* 忽略分页失败 */
    }
  }, [publicMessages]);

  /* ---------- 群聊已读：上报当前在底部可见的最新消息 ---------- */
  const reportVisibleMessage = useCallback((messageId: number) => {
    const prev = lastReadIdRef.current;
    if (prev !== null && messageId <= prev) return;
    setLastReadId(messageId);
    markPublicRead(messageId);
  }, []);

  /* ---------- 退出登录 ---------- */
  const logout = useCallback(() => {
    socket.disconnect();
    setUsername(null);
    setPublicMessages([]);
    setConversations(new Map());
    setOnlineUsers([]);
    setView('public');
    setLastReadId(null);
    socket.connect();
  }, []);

  if (!username) {
    return (
      <Login
        connecting={connecting}
        error={loginError}
        initialUsername={localStorage.getItem('chat:username') ?? ''}
        onJoin={doJoin}
      />
    );
  }

  const activeConversation = view === 'public' ? null : conversations.get(view) ?? null;

  return (
    <ChatRoom
      me={username}
      connectionState={connectionState}
      onlineUsers={onlineUsers}
      messages={view === 'public' ? publicMessages : activeConversation?.messages ?? []}
      view={view}
      conversations={conversations}
      onOpenConversation={openConversation}
      onBackToPublic={backToPublic}
      onSend={handleSend}
      onLoadOlder={view === 'public' ? loadOlderPublic : undefined}
      onVisibleMessage={view === 'public' ? reportVisibleMessage : undefined}
      onUploadImage={uploadImage}
      onLogout={logout}
      themeMode={themeMode}
      onCycleTheme={cycleTheme}
    />
  );
}
