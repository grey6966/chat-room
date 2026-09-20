import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { fetchDirectHistory } from '../api.js';
import type { ChatMessage, ChatNotice, Presence, Session } from '../types.js';
import Sidebar from './Sidebar.js';
import MessageList from './MessageList.js';
import Composer from './Composer.js';

interface ChatAppProps {
  socket: Socket;
  session: Session;
  initialPresence: Presence;
  initialHistory: ChatMessage[];
  onLogout: () => void;
}

const MAX_BUFFERED = 300;

function appendUnique(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const last = list[list.length - 1];
  if (last?.id === message.id) return list;
  // Duplicate protection across reconnects (server may redeliver nothing, but
  // the echo + broadcast paths make a cheap id check worthwhile).
  if (list.some((m) => m.id === message.id)) return list;
  const next = [...list, message];
  return next.length > MAX_BUFFERED ? next.slice(next.length - MAX_BUFFERED) : next;
}

export default function ChatApp({
  socket,
  session,
  initialPresence,
  initialHistory,
  onLogout,
}: ChatAppProps) {
  const [presence, setPresence] = useState<Presence>(initialPresence);
  const [channelMessages, setChannelMessages] = useState<ChatMessage[]>(initialHistory);
  const [notices, setNotices] = useState<ChatNotice[]>([]);
  const [dms, setDms] = useState<Record<string, ChatMessage[]>>({});
  const loadedDmsRef = useRef<Set<string>>(new Set());
  const [dmLoading, setDmLoading] = useState(false);
  const [openPeer, setOpenPeer] = useState<string | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const openPeerRef = useRef<string | null>(null);
  openPeerRef.current = openPeer;

  // Incoming realtime events — registered once for the component lifetime.
  useEffect(() => {
    const onPresence = (next: Presence) => setPresence(next);

    const onNotice = (notice: ChatNotice) =>
      setNotices((prev) => [...prev.slice(-80), notice]);

    const onChannelMessage = (message: ChatMessage) =>
      setChannelMessages((prev) => appendUnique(prev, message));

    const onDirectMessage = (message: ChatMessage) => {
      const peer =
        message.sender === session.username ? message.recipient ?? '' : message.sender;
      if (!peer) return;
      setDms((prev) => ({
        ...prev,
        [peer]: appendUnique(prev[peer] ?? [], message),
      }));
      if (openPeerRef.current !== peer) {
        setUnread((prev) => ({ ...prev, [peer]: (prev[peer] ?? 0) + 1 }));
      }
    };

    socket.on('presence', onPresence);
    socket.on('notice', onNotice);
    socket.on('channel:message', onChannelMessage);
    socket.on('direct:message', onDirectMessage);
    return () => {
      socket.off('presence', onPresence);
      socket.off('notice', onNotice);
      socket.off('channel:message', onChannelMessage);
      socket.off('direct:message', onDirectMessage);
    };
  }, [socket, session.username]);

  const openDirect = useCallback(
    async (peer: string) => {
      setOpenPeer(peer);
      setSidebarOpen(false);
      setUnread((prev) => {
        if (!prev[peer]) return prev;
        const next = { ...prev };
        delete next[peer];
        return next;
      });

      if (!loadedDmsRef.current.has(peer)) {
        loadedDmsRef.current.add(peer);
        setDmLoading(true);
        void fetchDirectHistory(socket, peer, 50).then((result) => {
          if (result.ok) {
            setDms((prev) => {
              // Merge history with messages already received live.
              const merged = new Map<number, ChatMessage>();
              for (const m of result.messages) merged.set(m.id, m);
              for (const m of prev[peer] ?? []) merged.set(m.id, m);
              return {
                ...prev,
                [peer]: [...merged.values()].sort((a, b) => a.id - b.id),
              };
            });
          }
          setDmLoading(false);
        });
      }
    },
    [socket]
  );

  const closeDirect = useCallback(() => setOpenPeer(null), []);

  const sendChannel = useCallback(
    (content: string) => {
      socket.emit('channel:message', { content });
    },
    [socket]
  );

  const sendDirect = useCallback(
    (peer: string, content: string) => {
      socket.emit('direct:message', { to: peer, content });
    },
    [socket]
  );

  const peerOnline = openPeer ? presence.includes(openPeer) : false;
  const totalUnread = useMemo(
    () => Object.values(unread).reduce((sum, n) => sum + n, 0),
    [unread]
  );

  return (
    <div className={`chat-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar
        currentUser={session.username}
        presence={presence}
        unread={unread}
        activePeer={openPeer}
        onSelectHall={() => {
          setOpenPeer(null);
          setSidebarOpen(false);
        }}
        onSelectPeer={openDirect}
        onLogout={onLogout}
      />

      <main className="chat-main">
        <header className="chat-header">
          <button
            className="icon-button sidebar-toggle"
            title="用户列表"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            ☰
          </button>

          <div className="chat-tabs">
            <button
              className={`chat-tab ${openPeer === null ? 'active' : ''}`}
              onClick={() => setOpenPeer(null)}
            >
              # 大厅
              {totalUnread > 0 && openPeer !== null && (
                <span className="tab-dot">{totalUnread}</span>
              )}
            </button>
            {openPeer && (
              <button className="chat-tab active" onClick={() => undefined}>
                <span className="status-dot online" />
                {openPeer}
                <span
                  className="tab-close"
                  role="button"
                  title="关闭私聊"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeDirect();
                  }}
                >
                  ×
                </span>
              </button>
            )}
          </div>

          <div className="header-online-count">
            <span className="status-dot online" />
            {presence.length} 人在线
          </div>
        </header>

        {openPeer === null ? (
          <>
            <MessageList
              kind="channel"
              currentUser={session.username}
              messages={channelMessages}
              notices={notices}
              emptyText="还没有消息，来发出第一条消息吧！"
            />
            <Composer
              token={session.token}
              placeholder="在大厅发送消息，支持 Markdown 富文本…（Enter 发送，Shift+Enter 换行）"
              onSend={sendChannel}
            />
          </>
        ) : (
          <>
            <MessageList
              kind="direct"
              currentUser={session.username}
              messages={dms[openPeer] ?? []}
              notices={[]}
              loading={dmLoading}
              emptyText={
                peerOnline
                  ? `和 ${openPeer} 的私聊开始了，消息仅你们双方可见`
                  : `${openPeer} 当前不在线，暂时无法私聊`
              }
            />
            <Composer
              token={session.token}
              disabled={!peerOnline}
              disabledHint={peerOnline ? undefined : '对方已下线，无法发送私聊消息'}
              placeholder={`发送给 ${openPeer}…（Enter 发送，Shift+Enter 换行）`}
              onSend={(content) => sendDirect(openPeer, content)}
            />
          </>
        )}
      </main>
    </div>
  );
}
