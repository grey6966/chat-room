export interface ChatMessage {
  id: number;
  type: 'channel' | 'direct';
  sender: string;
  recipient: string | null;
  content: string;
  createdAt: number;
}

export interface Session {
  token: string;
  username: string;
}

export interface ChatNotice {
  id: string;
  kind: 'join' | 'leave';
  username: string;
  createdAt: number;
}

export type Presence = string[];

export interface JoinOk {
  ok: true;
  session: Session;
  presence: Presence;
  history: ChatMessage[];
}

export interface JoinErr {
  ok: false;
  error: string;
}
