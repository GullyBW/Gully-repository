import { Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { IonContent, IonicModule, ToastController, ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { MessageService } from '../../core/message.service';
import { SocketService } from '../../core/socket.service';
import { AuthService } from '../../core/auth.service';
import { ChatMessage, Conversation } from '../../core/models';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/chat"></ion-back-button></ion-buttons>
        <ion-title>
          Chat
          <div class="sub">Booking {{ bookingReference }}</div>
        </ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content #content class="ion-padding chat-bg">
      <div
        *ngFor="let m of messages"
        class="bubble"
        [class.mine]="m.senderId === myId"
      >
        <ng-container [ngSwitch]="m.type">
          <img *ngSwitchCase="'image'" [src]="m.imageUrl" class="msg-img" alt="image" />
          <span *ngSwitchCase="'location'">📍 Shared location</span>
          <span *ngSwitchDefault>{{ m.text }}</span>
        </ng-container>
        <div class="meta">
          {{ m.createdAt | date: 'shortTime' }}
          <ion-icon *ngIf="m.senderId === myId" [name]="isRead(m) ? 'checkmark-done' : 'checkmark'"></ion-icon>
        </div>
      </div>

      <div class="typing" *ngIf="otherTyping">typing…</div>
    </ion-content>

    <ion-footer>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="fileInput.click()"><ion-icon slot="icon-only" name="image-outline"></ion-icon></ion-button>
          <input #fileInput type="file" accept="image/*" hidden (change)="onFile($event)" />
        </ion-buttons>
        <ion-input
          [(ngModel)]="draft"
          placeholder="Type a message"
          (ionInput)="onTyping()"
          (keyup.enter)="send()"
        ></ion-input>
        <ion-buttons slot="end">
          <ion-button (click)="send()" [disabled]="!draft.trim()"><ion-icon slot="icon-only" name="send"></ion-icon></ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [
    `
      .sub { font-size: 0.7rem; opacity: 0.8; }
      .chat-bg { --background: var(--ion-color-light); }
      .bubble {
        max-width: 78%;
        margin: 6px 0;
        padding: 8px 12px;
        border-radius: 14px;
        background: var(--ion-background-color, #fff);
        align-self: flex-start;
        width: fit-content;
        box-shadow: 0 1px 2px rgba(0,0,0,0.08);
      }
      .bubble.mine {
        margin-left: auto;
        background: var(--ion-color-primary);
        color: var(--ion-color-primary-contrast);
      }
      .meta { font-size: 0.65rem; opacity: 0.7; margin-top: 2px; text-align: right; }
      .msg-img { max-width: 200px; border-radius: 8px; display: block; }
      .typing { font-size: 0.8rem; color: var(--ion-color-medium); padding: 4px; }
    `,
  ],
})
export class ChatPage implements ViewWillEnter, ViewWillLeave, OnDestroy {
  private route = inject(ActivatedRoute);
  private messagesApi = inject(MessageService);
  private socket = inject(SocketService);
  private auth = inject(AuthService);
  private http = inject(HttpClient);
  private toast = inject(ToastController);

  @ViewChild('content') content?: IonContent;

  bookingReference = '';
  conversation?: Conversation;
  messages: ChatMessage[] = [];
  draft = '';
  otherTyping = false;
  myId = this.auth.currentUser()?.id;
  private subs: Subscription[] = [];
  private typingTimer?: ReturnType<typeof setTimeout>;

  ionViewWillEnter(): void {
    this.bookingReference = this.route.snapshot.paramMap.get('reference') || '';
    this.socket.connect();
    this.socket.joinConversation(this.bookingReference);

    this.messagesApi.history(this.bookingReference).subscribe((res) => {
      this.conversation = res.conversation;
      this.messages = res.messages;
      this.scrollDown();
      this.markRead();
    });

    this.subs.push(
      this.socket.messageNew$.subscribe((m) => {
        if (this.conversation && m.conversationId !== this.conversation.id) return;
        if (this.messages.some((x) => x.id === m.id)) return; // dedupe own echo
        this.messages.push(m);
        this.scrollDown();
        this.markRead();
      }),
      this.socket.typing$.subscribe((p) => {
        if (p.userId !== this.myId) {
          this.otherTyping = p.typing;
          if (p.typing) setTimeout(() => (this.otherTyping = false), 3000);
        }
      })
    );
  }

  ionViewWillLeave(): void {
    this.cleanup();
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  isRead(m: ChatMessage): boolean {
    // Read by someone other than the sender.
    return (m.readBy || []).some((u) => u !== m.senderId);
  }

  onTyping(): void {
    if (!this.conversation) return;
    this.socket.sendTyping(this.conversation.id, true);
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      if (this.conversation) this.socket.sendTyping(this.conversation.id, false);
    }, 1200);
  }

  send(): void {
    const text = this.draft.trim();
    if (!text) return;
    this.draft = '';
    this.messagesApi.send(this.bookingReference, { type: 'text', text }).subscribe((m) => {
      if (!this.messages.some((x) => x.id === m.id)) this.messages.push(m);
      this.scrollDown();
    });
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    this.http
      .post<{ data: { url: string } }>(`${environment.apiBaseUrl}/uploads/message_image`, fd)
      .subscribe({
        next: (res) => {
          this.messagesApi
            .send(this.bookingReference, { type: 'image', imageUrl: res.data.url })
            .subscribe((m) => {
              if (!this.messages.some((x) => x.id === m.id)) this.messages.push(m);
              this.scrollDown();
            });
        },
        error: async () => {
          const t = await this.toast.create({ message: 'Upload failed', duration: 2000, color: 'danger' });
          await t.present();
        },
      });
    input.value = '';
  }

  private markRead(): void {
    this.messagesApi.markRead(this.bookingReference).subscribe();
    this.socket.markRead(this.bookingReference);
  }

  private scrollDown(): void {
    setTimeout(() => this.content?.scrollToBottom(200), 50);
  }

  private cleanup(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.subs = [];
    clearTimeout(this.typingTimer);
  }
}
