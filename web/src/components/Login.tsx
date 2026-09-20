import { useState, type FormEvent } from 'react';

interface LoginProps {
  connecting: boolean;
  error: string;
  initialUsername: string;
  onJoin: (username: string) => Promise<boolean>;
}

export default function Login({ connecting, error, initialUsername, onJoin }: LoginProps) {
  const [name, setName] = useState(initialUsername);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || connecting) return;
    await onJoin(name.trim());
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">💬</div>
        <h1>在线聊天室</h1>
        <p className="login-subtitle">输入用户名进入聊天，支持群聊、私聊、图片与代码块</p>
        <input
          className="login-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="2-16 位中文 / 字母 / 数字 / 下划线"
          maxLength={16}
          autoFocus
          disabled={connecting}
        />
        {error && <div className="login-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={connecting || name.trim().length < 2}>
          {connecting ? '正在进入…' : '进入聊天室'}
        </button>
      </form>
    </div>
  );
}
