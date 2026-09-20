import { avatarColor, initials } from '../lib/format.js';

interface SidebarProps {
  currentUser: string;
  presence: string[];
  unread: Record<string, number>;
  activePeer: string | null;
  onSelectHall: () => void;
  onSelectPeer: (peer: string) => void;
  onLogout: () => void;
}

function Avatar({ name, size }: { name: string; size?: number }) {
  return (
    <span
      className="avatar"
      style={{ background: avatarColor(name), width: size, height: size }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export default function Sidebar({
  currentUser,
  presence,
  unread,
  activePeer,
  onSelectHall,
  onSelectPeer,
  onLogout,
}: SidebarProps) {
  const others = presence.filter((name) => name !== currentUser);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon">💬</span>
        <span>聊天室</span>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${activePeer === null ? 'active' : ''}`}
          onClick={onSelectHall}
        >
          <span className="nav-hash">#</span>
          <span className="nav-label">大厅</span>
          <span className="nav-count">{presence.length}</span>
        </button>
      </nav>

      <div className="sidebar-section-title">
        在线用户 · {others.length + 1}
      </div>

      <div className="user-list">
        <div className="nav-item user self">
          <Avatar name={currentUser} />
          <span className="nav-label">{currentUser}（我）</span>
          <span className="status-dot online" />
        </div>

        {others.map((name) => {
          const count = unread[name] ?? 0;
          return (
            <button
              key={name}
              className={`nav-item user ${activePeer === name ? 'active' : ''}`}
              onClick={() => onSelectPeer(name)}
              title={`与 ${name} 私聊`}
            >
              <Avatar name={name} />
              <span className="nav-label">{name}</span>
              {count > 0 && <span className="unread-badge">{count}</span>}
              <span className="status-dot online" />
            </button>
          );
        })}

        {others.length === 0 && (
          <div className="user-empty">暂无其他在线用户</div>
        )}
      </div>

      <button className="logout-button" onClick={onLogout}>
        退出登录
      </button>
    </aside>
  );
}
