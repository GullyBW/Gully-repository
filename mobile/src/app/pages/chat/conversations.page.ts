import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { MessageService } from '../../core/message.service';
import { AuthService } from '../../core/auth.service';
import { Conversation } from '../../core/models';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-conversations',
  standalone: true,
  imports: [IonicModule, CommonModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/home"></ion-back-button></ion-buttons>
        <ion-title>Messages</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="load($event)">
        <ion-refresher-content></ion-refresher-content>
      </ion-refresher>

      <app-empty-state
        *ngIf="!loading && conversations.length === 0"
        icon="chatbubbles-outline"
        title="No conversations"
        message="Messages with your provider or customer appear here."
      ></app-empty-state>

      <ion-list>
        <ion-item *ngFor="let c of conversations" button (click)="open(c)">
          <ion-icon slot="start" name="chatbubble-ellipses-outline" color="primary"></ion-icon>
          <ion-label>
            <h2>Booking {{ c.bookingReference }}</h2>
            <p>Last activity {{ c.lastMessageAt | date: 'short' }}</p>
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class ConversationsPage implements ViewWillEnter {
  private messages = inject(MessageService);
  private router = inject(Router);
  private auth = inject(AuthService);

  conversations: Conversation[] = [];
  loading = false;

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
}
