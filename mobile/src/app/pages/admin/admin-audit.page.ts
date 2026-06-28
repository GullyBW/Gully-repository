import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { AdminService, AuditEntry } from '../../core/admin.service';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
        <ion-title>Audit logs</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-select [(ngModel)]="action" (ionChange)="load()" interface="popover" placeholder="All actions">
          <ion-select-option [value]="''">All actions</ion-select-option>
          <ion-select-option value="login">Logins</ion-select-option>
          <ion-select-option value="login_failed">Failed logins</ion-select-option>
          <ion-select-option value="provider_verified">Provider verifications</ion-select-option>
          <ion-select-option value="provider_suspended">Suspensions</ion-select-option>
          <ion-select-option value="refund_issued">Refunds</ion-select-option>
          <ion-select-option value="broadcast_sent">Broadcasts</ion-select-option>
        </ion-select>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="!loading && entries.length === 0" icon="document-text-outline" title="No audit entries"></app-empty-state>
      <ion-list>
        <ion-item *ngFor="let e of entries">
          <ion-label class="ion-text-wrap">
            <h3>{{ e.action }}</h3>
            <p>actor: {{ e.actorId || '—' }} · target: {{ e.targetId || '—' }}</p>
            <p class="muted">{{ e.createdAt | date: 'short' }} · {{ e.ip }}</p>
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  `,
  styles: [`.muted{color:var(--ion-color-medium);font-size:.75rem;}`],
})
export class AdminAuditPage implements ViewWillEnter {
  private admin = inject(AdminService);

  entries: AuditEntry[] = [];
  action = '';
  loading = false;

  ionViewWillEnter(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.admin.auditLogs(this.action || undefined).subscribe({
      next: (e) => {
        this.entries = e;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }
}
