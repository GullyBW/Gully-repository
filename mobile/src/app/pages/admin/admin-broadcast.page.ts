import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { AdminService } from '../../core/admin.service';

@Component({
  selector: 'app-admin-broadcast',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Broadcast centre</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-list>
        <ion-item>
          <ion-select label="Audience" [(ngModel)]="role" interface="popover">
            <ion-select-option [value]="''">All users</ion-select-option>
            <ion-select-option value="customer">Customers only</ion-select-option>
            <ion-select-option value="provider">Providers only</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-select label="Type" [(ngModel)]="kind" interface="popover">
            <ion-select-option value="announcement">Announcement</ion-select-option>
            <ion-select-option value="interruption">Service interruption</ion-select-option>
            <ion-select-option value="promo">Promotion</ion-select-option>
            <ion-select-option value="emergency">Emergency alert</ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-input label="Title" labelPlacement="floating" [(ngModel)]="title"></ion-input>
        </ion-item>
        <ion-item>
          <ion-textarea label="Message" labelPlacement="floating" [(ngModel)]="body" [autoGrow]="true"></ion-textarea>
        </ion-item>
      </ion-list>

      <ion-button expand="block" (click)="send()" [disabled]="sending || !title || !body">
        {{ sending ? 'Sending…' : 'Send broadcast' }}
      </ion-button>
    </ion-content>
  `,
})
export class AdminBroadcastPage {
  private admin = inject(AdminService);
  private toast = inject(ToastController);

  role = '';
  kind = 'announcement';
  title = '';
  body = '';
  sending = false;

  send(): void {
    this.sending = true;
    // The "kind" is prefixed into the title so recipients see the intent.
    const prefix = this.kind === 'emergency' ? '🚨 ' : this.kind === 'interruption' ? '⚠️ ' : '';
    this.admin
      .broadcast({ role: this.role || undefined, title: `${prefix}${this.title}`, body: this.body })
      .subscribe({
        next: async (res) => {
          this.sending = false;
          this.title = '';
          this.body = '';
          const t = await this.toast.create({
            message: `Sent to ${res.sent} user(s)`,
            duration: 2200,
            color: 'success',
          });
          await t.present();
        },
        error: async () => {
          this.sending = false;
          const t = await this.toast.create({ message: 'Broadcast failed', duration: 2200, color: 'danger' });
          await t.present();
        },
      });
  }
}
