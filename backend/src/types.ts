export interface ChatMessage {
  id: number;
  type: 'channel' | 'direct';
  sender: string;
  recipient: string | null;
  content: string;
  createdAt: number;
  /** Channel messages only: number of distinct users who have read it. */
  readBy?: number;
}

export type Presence = string[];

/** Transient join/leave notices, never persisted. */
export interface ChatNotice {
  id: string;
  kind: 'join' | 'leave';
  username: string;
  createdAt: number;
}

/** Batch read-count refresh for visible channel messages. */
export interface ReadReceiptsUpdate {
  counts: Record<string, number>;
}

/** Detailed reader list for one channel message. */
export interface ReadReceiptDetail {
  messageId: number;
  readers: string[];
}
