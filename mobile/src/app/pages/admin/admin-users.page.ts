import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { AdminService } from '../../core/admin.service';
import { User } from '../../core/models';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Customers</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar [(ngModel)]="q" (ionInput)="load()" [debounce]="400" placeholder="Search customers"></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="!loading && users.length === 0" icon="person-outline" title="No customers"></app-empty-state>
      <ion-list>
        <ion-item *ngFor="let u of users">
          <ion-label>
            <h2>{{ u.name }} <ion-badge *ngIf="u.suspended" color="danger">suspended</ion-badge></h2>
            <p>{{ u.email }}</p>
            <p>{{ u.emailVerified ? 'Verified email' : 'Unverified' }}</p>
          </ion-label>
          <ion-button slot="end" [color]="u.suspended ? 'success' : 'danger'" (click)="toggleSuspend(u)">
            {{ u.suspended ? 'Reinstate' : 'Suspend' }}
          </ion-button>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class AdminUsersPage implements ViewWillEnter {
  private admin = inject(AdminService);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  users: User[] = [];
  q = '';
  loading = false;

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.admin.searchUsers(this.q, 'customer').subscribe({
      next: (u) => {
        this.users = u;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  async toggleSuspend(u: User): Promise<void> {
    const next = !u.suspended;
    const alert = await this.alert.create({
      header: next ? 'Suspend account' : 'Reinstate account',
      inputs: next ? [{ name: 'reason', type: 'text', placeholder: 'Reason' }] : [],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: (val) => {
            this.admin.suspendUser(u.id, next, val?.reason).subscribe((res) => {
              u.suspended = res.suspended;
              this.notify(next ? 'Suspended' : 'Reinstated');
            });
          },
        },
      ],
    });
    await alert.present();
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 1800, color: 'success' });
    await t.present();
  }
}
