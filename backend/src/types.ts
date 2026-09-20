export interface ChatMessage {
  id: number;
  type: 'channel' | 'direct';
  sender: string;
  recipient: string | null;
  content: string;
  createdAt: number;
  /** Channel messages only: number of *other* users who have read it. */
  readByCount?: number;
}

export type Presence = string[];

/** Transient join/leave notices, never persisted. */
export interface ChatNotice {
  id: string;
  kind: 'join' | 'leave';
  username: string;
  createdAt: number;
}
