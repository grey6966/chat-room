import { useCallback, useEffect, useRef, useState } from 'react';
import { createSocket, joinRoom } from './api.js';
import Login from './components/Login.js';
import ChatApp from './components/ChatApp.js';
import type { ChatMessage, Presence, Session } from './types.js';

type Socket = ReturnType<typeof createSocket>;

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  if (socketRef.current === null) socketRef.current = createSocket();
  const socket = socketRef.current;

  const [session, setSession] = useState<Session | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);

  // Snapshot handed to ChatApp together with a successful join.
  const [bootstrap, setBootstrap] = useState<{
    presence: Presence;
    history: ChatMessage[];
  }>({ presence: [], history: [] });

  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const performJoin = useCallback(
    async (username: string) => {
      setJoining(true);
      setJoinError(null);
      try {
        const result = await joinRoom(socket, username);
        if (!result.ok) {
          setJoinError(result.error);
          return;
        }
        localStorage.setItem('chat:username', username);
        setSession(result.session);
        setBootstrap({ presence: result.presence, history: result.history });
      } catch {
        setJoinError('连接服务器超时，请检查网络后重试');
      } finally {
        setJoining(false);
      }
    },
    [socket]
  );

  useEffect(() => {
    // After a transport reconnect:
    //  - socket.recovered === true  → the server resumed our session (rooms
    //    and buffered messages intact); nothing to do.
    //  - socket.recovered === false → server restarted or recovery window
    //    elapsed; re-join with the remembered username.
    const tryRejoin = (): void => {
      const username = localStorage.getItem('chat:username');
      if (!username) return;
      void joinRoom(socket, username).then((result) => {
        if (result.ok) {
          setJoinError(null);
          setSession(result.session);
          // Re-sync channel history after the server-side session reset.
          setBootstrap({ presence: result.presence, history: result.history });
        } else if (!/占用/.test(result.error)) {
          setSession(null);
          setJoinError(result.error);
        }
        // If the name is briefly held by our own lingering socket, the next
        // reconnect attempt will retry.
      });
    };

    const onConnect = () => {
      setConnected(true);
      if (socket.recovered) return; // session resumed transparently
      // First-ever connection is handled by the login form; only rejoin when
      // we already have an identity to restore.
      if (sessionRef.current || localStorage.getItem('chat:username')) tryRejoin();
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    // Handle the case where the connection was established before mount.
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('chat:username');
    socket.disconnect();
    setSession(null);
    setBootstrap({ presence: [], history: [] });
    setJoinError(null);
    // Reconnect with a clean socket for the next visitor.
    socket.connect();
  }, [socket]);

  if (!session) {
    return (
      <>
        {!connected && <div className="global-banner">正在连接服务器…</div>}
        <Login joining={joining} error={joinError} onJoin={performJoin} />
      </>
    );
  }

  return (
    <>
      {!connected && <div className="global-banner">连接已断开，正在自动重连…</div>}
      {/* Keyed by token: a server-restart rejoin issues a fresh token and
          remounts ChatApp with the latest history; a CSR-recovered blip keeps
          the same token and therefore the in-memory view. */}
      <ChatApp
        key={session.token}
        socket={socket}
        session={session}
        initialPresence={bootstrap.presence}
        initialHistory={bootstrap.history}
        onLogout={handleLogout}
      />
    </>
  );
}
