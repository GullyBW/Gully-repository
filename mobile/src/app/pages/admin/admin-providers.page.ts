import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AlertController, IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { AdminService } from '../../core/admin.service';
import { User } from '../../core/models';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-admin-providers',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Providers</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar [(ngModel)]="q" (ionInput)="load()" [debounce]="400" placeholder="Search providers"></ion-searchbar>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="!loading && providers.length === 0" icon="people-outline" title="No providers"></app-empty-state>

      <ion-list>
        <ion-item *ngFor="let p of providers" button (click)="open(p)">
          <ion-label>
            <h2>{{ p.name }} <ion-badge *ngIf="p.suspended" color="danger">suspended</ion-badge></h2>
            <p>{{ p.email }}</p>
          </ion-label>
          <ion-buttons slot="end">
            <ion-button color="primary" (click)="verify(p, $event)">Verify</ion-button>
            <ion-button [color]="p.suspended ? 'success' : 'danger'" (click)="toggleSuspend(p, $event)">
              {{ p.suspended ? 'Reinstate' : 'Suspend' }}
            </ion-button>
          </ion-buttons>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
})
export class AdminProvidersPage implements ViewWillEnter {
  private admin = inject(AdminService);
  private router = inject(Router);
  private toast = inject(ToastController);
  private alert = inject(AlertController);

  providers: User[] = [];
  q = '';
  loading = false;

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.admin.searchUsers(this.q, 'provider').subscribe({
      next: (u) => {
        this.providers = u;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  open(p: User): void {
    this.router.navigate(['/providers', p.id]);
  }

  verify(p: User, ev: Event): void {
    ev.stopPropagation();
    this.admin.verifyProvider(p.id, true).subscribe(() => this.notify(`${p.name} verified`));
  }

  async toggleSuspend(p: User, ev: Event): Promise<void> {
    ev.stopPropagation();
    const next = !p.suspended;
    const alert = await this.alert.create({
      header: next ? 'Suspend provider' : 'Reinstate provider',
      inputs: next ? [{ name: 'reason', type: 'text', placeholder: 'Reason' }] : [],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Confirm',
          handler: (val) => {
            this.admin.suspendUser(p.id, next, val?.reason).subscribe((u) => {
              p.suspended = u.suspended;
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
