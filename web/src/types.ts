/** 前后端共享的通信协议类型（与 server/src/types.ts 保持一致） */

export type MessageKind = 'public' | 'dm';

export interface ChatMessage {
  id: number;
  kind: MessageKind;
  senderName: string;
  receiverName: string | null;
  content: string;
  createdAt: number;
  /** 群聊消息：除发送者外已读人数（服务端随消息/回执下发） */
  readByCount?: number;
}

export interface OnlineUser {
  id: number;
  username: string;
}

/** 群聊已读回执增量：upTo 之后最近窗口内每条消息的最新已读数 */
export interface PublicReadUpdate {
  upTo: number;
  counts: Record<string, number>;
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string };

export type JoinAck = Ack<{
  user: OnlineUser;
  recentMessages: ChatMessage[];
  lastReadMessageId: number | null;
}>;
export type SendAck = Ack<{ message?: ChatMessage }>;
export type DmOpenAck = Ack<{ peer: string; messages: ChatMessage[] }>;
export type HistoryAck = Ack<{ messages: ChatMessage[] }>;
