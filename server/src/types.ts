/** 服务端与客户端共享的通信协议类型定义 */

export type MessageKind = 'public' | 'dm';

export interface ChatMessageDTO {
  id: number;
  kind: MessageKind;
  senderName: string;
  receiverName: string | null;
  content: string;
  createdAt: number;
  /** 群消息：已读人数（不含发送者自己），实时通过 read:update 事件更新 */
  readCount?: number;
}

/** 已读回执增量：某用户读到了 lastReadId，其之前的群消息已读数 +1 */
export interface ReadReceiptDTO {
  username: string;
  lastReadId: number;
}

export interface OnlineUserDTO {
  id: number;
  username: string;
}

export type AckOk<T> = { ok: true } & T;
export type AckErr = { ok: false; error: string };
export type Ack<T = Record<string, never>> = AckOk<T> | AckErr;
