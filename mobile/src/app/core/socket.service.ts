import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { ChatMessage } from './models';

/**
 * Socket.IO client wrapper. Authenticates with the same JWT as the REST API,
 * reconnects automatically, and exposes server events as observables. A single
 * shared connection is reused across chat windows (battery-friendly).
 */
@Injectable({ providedIn: 'root' })
export class SocketService {
  private auth = inject(AuthService);
  private socket?: Socket;

  readonly messageNew$ = new Subject<ChatMessage>();
  readonly messageReaction$ = new Subject<ChatMessage>();
  readonly messageRead$ = new Subject<{ userId: string }>();
  readonly typing$ = new Subject<{ userId: string; typing: boolean }>();
  readonly connected$ = new Subject<boolean>();

  /** Derive the socket origin from the API base URL (strip the trailing /api). */
  private get origin(): string {
    return environment.apiBaseUrl.replace(/\/api\/?$/, '');
  }

  connect(): void {
    if (this.socket && this.socket.connected) return;
    const token = this.auth.getToken();
    if (!token) return;

    this.socket = io(this.origin, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });

    this.socket.on('connect', () => this.connected$.next(true));
    this.socket.on('disconnect', () => this.connected$.next(false));
    this.socket.on('message:new', (m: ChatMessage) => this.messageNew$.next(m));
    this.socket.on('message:reaction', (m: ChatMessage) => this.messageReaction$.next(m));
    this.socket.on('message:read', (p: { userId: string }) => this.messageRead$.next(p));
    this.socket.on('typing', (p: { userId: string; typing: boolean }) => this.typing$.next(p));
  }

  joinConversation(bookingReference: string): void {
    this.socket?.emit('conversation:join', bookingReference);
  }

  sendTyping(conversationId: string, typing: boolean): void {
    this.socket?.emit('typing', { conversationId, typing });
  }

  markRead(bookingReference: string): void {
    this.socket?.emit('message:read', { bookingReference });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = undefined;
  }
}
