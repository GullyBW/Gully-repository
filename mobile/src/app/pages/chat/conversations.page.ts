import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { MessageService } from '../../core/message.service';
import { ChatPrefsService } from '../../core/chat-prefs.service';
import { Conversation } from '../../core/models';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-conversations',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
        <ion-title>Messages</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="showArchived = !showArchived">
            <ion-icon slot="icon-only" [name]="showArchived ? 'mail-outline' : 'archive-outline'"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar [(ngModel)]="q" placeholder="Search conversations" [debounce]="200"></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="load($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <app-empty-state
        *ngIf="!loading && filtered.length === 0"
        icon="chatbubbles-outline"
        [title]="showArchived ? 'No archived chats' : 'No conversations'"
        message="Messages with your provider or customer appear here."
      ></app-empty-state>

      <ion-list>
        <ion-item-sliding *ngFor="let c of filtered">
          <ion-item button (click)="open(c)">
            <ion-icon slot="start" [name]="prefs.isPinned(c.bookingReference) ? 'pin' : 'chatbubble-ellipses-outline'" color="primary"></ion-icon>
            <ion-label>
              <h2>
                Booking {{ c.bookingReference }}
                <ion-icon *ngIf="prefs.isMuted(c.bookingReference)" name="volume-mute-outline" color="medium"></ion-icon>
              </h2>
              <p>Last activity {{ c.lastMessageAt | date: 'short' }}</p>
            </ion-label>
          </ion-item>
          <ion-item-options side="end">
            <ion-item-option (click)="togglePin(c)">{{ prefs.isPinned(c.bookingReference) ? 'Unpin' : 'Pin' }}</ion-item-option>
            <ion-item-option color="medium" (click)="toggleMute(c)">{{ prefs.isMuted(c.bookingReference) ? 'Unmute' : 'Mute' }}</ion-item-option>
            <ion-item-option color="tertiary" (click)="toggleArchive(c)">{{ prefs.isArchived(c.bookingReference) ? 'Unarchive' : 'Archive' }}</ion-item-option>
          </ion-item-options>
        </ion-item-sliding>
      </ion-list>
    </ion-content>
  `,
})
export class ConversationsPage implements ViewWillEnter {
  private messages = inject(MessageService);
  prefs = inject(ChatPrefsService);
  private router = inject(Router);

  conversations: Conversation[] = [];
  loading = false;
  q = '';
  showArchived = false;

  get filtered(): Conversation[] {
    const needle = this.q.toLowerCase();
    return this.conversations
      .filter((c) => this.prefs.isArchived(c.bookingReference) === this.showArchived)
      .filter((c) => !needle || c.bookingReference.toLowerCase().includes(needle))
      .sort((a, b) => {
        const pa = this.prefs.isPinned(a.bookingReference) ? 1 : 0;
        const pb = this.prefs.isPinned(b.bookingReference) ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt);
      });
  }

  ionViewWillEnter(): void {
    this.load();
  }

  load(event?: CustomEvent): void {
    this.loading = true;
    this.messages.conversations().subscribe({
      next: (c) => {
        this.conversations = c;
        this.loading = false;
        (event?.target as { complete?: () => void } | null)?.complete?.();
      },
      error: () => {
        this.loading = false;
        (event?.target as { complete?: () => void } | null)?.complete?.();
      },
    });
  }

  open(c: Conversation): void {
    this.router.navigate(['/chat', c.bookingReference]);
  }

  togglePin(c: Conversation): void {
    this.prefs.togglePin(c.bookingReference);
  }
  toggleMute(c: Conversation): void {
    this.prefs.toggleMute(c.bookingReference);
  }
  toggleArchive(c: Conversation): void {
    this.prefs.toggleArchive(c.bookingReference);
  }
}
