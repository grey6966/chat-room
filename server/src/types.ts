/** 服务端与客户端共享的通信协议类型定义 */

export type MessageKind = 'public' | 'dm';

export interface ChatMessageDTO {
  id: number;
  kind: MessageKind;
  senderName: string;
  receiverName: string | null;
  content: string;
  createdAt: number;
}

export interface OnlineUserDTO {
  id: number;
  username: string;
}

export type AckOk<T> = { ok: true } & T;
export type AckErr = { ok: false; error: string };
export type Ack<T = Record<string, never>> = AckOk<T> | AckErr;
