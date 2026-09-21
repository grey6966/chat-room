/** 前后端共享的通信协议类型（与 server/src/types.ts 保持一致） */

export type MessageKind = 'public' | 'dm';

export interface ChatMessage {
  id: number;
  kind: MessageKind;
  senderName: string;
  receiverName: string | null;
  content: string;
  createdAt: number;
  /** 群消息：已读人数（不含发送者自己） */
  readCount?: number;
}

/** 已读回执增量：某用户读到了 lastReadId */
export interface ReadReceipt {
  username: string;
  lastReadId: number;
}

export interface OnlineUser {
  id: number;
  username: string;
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string };

export type JoinAck = Ack<{ user: OnlineUser; recentMessages: ChatMessage[] }>;
export type SendAck = Ack<{ message?: ChatMessage }>;
export type DmOpenAck = Ack<{ peer: string; messages: ChatMessage[] }>;
export type HistoryAck = Ack<{ messages: ChatMessage[] }>;
