import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { ChatMessage, Conversation } from './models';

/** REST client for chat history (real-time deltas come via SocketService). */
@Injectable({ providedIn: 'root' })
export class MessageService {
  private api = inject(ApiService);

  conversations(): Observable<Conversation[]> {
    return this.api.get<Conversation[]>('/messages/conversations');
  }

  history(
    bookingReference: string
  ): Observable<{ conversation: Conversation; messages: ChatMessage[] }> {
    return this.api.get(`/messages/${bookingReference}`);
  }

  send(
    bookingReference: string,
    input: { type?: 'text' | 'image' | 'location'; text?: string; imageUrl?: string; location?: { lat: number; lng: number } }
  ): Observable<ChatMessage> {
    return this.api.post<ChatMessage>(`/messages/${bookingReference}`, input);
  }

  markRead(bookingReference: string): Observable<unknown> {
    return this.api.post(`/messages/${bookingReference}/read`, {});
  }
}
