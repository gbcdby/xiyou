export type RequestEvent = 'session.subscribe' | 'player.action.request' | 'sync.request' | 'control.resume' | 'control.take';
export interface LinkHandlers {
  connected(): void;
  disconnected(): void;
  batch(value: unknown): void;
  failed(value?: unknown): void;
}
export interface SessionLink {
  readonly connected: boolean;
  request(event: RequestEvent, value: string | { sessionId: string }): Promise<unknown>;
  close(): void;
}
export type ConnectLink = (token: string, handlers: LinkHandlers) => SessionLink;
