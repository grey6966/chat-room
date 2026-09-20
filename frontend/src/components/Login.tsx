import { useEffect, useRef, useState, type FormEvent } from 'react';

interface LoginProps {
  joining: boolean;
  error: string | null;
  onJoin: (username: string) => void;
}

export default function Login({ joining, error, onJoin }: LoginProps) {
  const [name, setName] = useState(() => localStorage.getItem('chat:username') ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(event: FormEvent): void {
    event.preventDefault();
    const username = name.trim();
    if (username.length < 1 || username.length > 24) {
      setLocalError('用户名长度需要在 1-24 个字符之间');
      return;
    }
    setLocalError(null);
    onJoin(username);
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">💬</div>
        <h1>实时聊天室</h1>
        <p className="login-subtitle">输入一个用户名加入大厅，和大家实时畅聊</p>
        <input
          ref={inputRef}
          className="login-input"
          value={name}
          maxLength={24}
          placeholder="你的用户名"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
          disabled={joining}
        />
        {(localError ?? error) && (
          <div className="login-error">{localError ?? error}</div>
        )}
        <button className="login-button" type="submit" disabled={joining || !name.trim()}>
          {joining ? '正在加入…' : '进入聊天室'}
        </button>
        <ul className="login-features">
          <li>群聊实时同步 · 在线列表</li>
          <li>私聊消息 · 历史记录</li>
          <li>图片 / 富文本 / 代码块</li>
        </ul>
      </form>
    </div>
  );
}
