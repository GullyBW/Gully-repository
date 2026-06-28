import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { ProviderService } from '../../core/provider.service';
import { ProviderProfile } from '../../core/models';
import { environment } from '../../../environments/environment';
import { EmptyStateComponent } from '../../components/empty-state.component';

@Component({
  selector: 'app-portfolio-manager',
  standalone: true,
  imports: [IonicModule, CommonModule, EmptyStateComponent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/provider/dashboard"></ion-back-button></ion-buttons>
        <ion-title>Portfolio</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="fileInput.click()"><ion-icon slot="icon-only" name="cloud-upload-outline"></ion-icon></ion-button>
          <input #fileInput type="file" accept="image/*" hidden (change)="onFile($event)" />
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <app-empty-state *ngIf="portfolio.length === 0 && !uploading" icon="images-outline" title="No portfolio images"
        message="Showcase your work — tap upload to add photos."></app-empty-state>

      <div class="grid">
        <div class="cell" *ngFor="let img of portfolio">
          <img [src]="img" alt="portfolio" />
          <ion-button size="small" fill="clear" color="danger" class="del" (click)="remove(img)">
            <ion-icon slot="icon-only" name="trash-outline"></ion-icon>
          </ion-button>
        </div>
      </div>

      <ion-progress-bar *ngIf="uploading" type="indeterminate"></ion-progress-bar>
    </ion-content>
  `,
  styles: [
    `
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .cell { position: relative; }
      .cell img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; }
      .del { position: absolute; top: -6px; right: -6px; --background: rgba(255,255,255,0.85); border-radius: 50%; }
    `,
  ],
})
export class PortfolioManagerPage implements ViewWillEnter {
  private providers = inject(ProviderService);
  private http = inject(HttpClient);
  private toast = inject(ToastController);

  profile?: ProviderProfile;
  portfolio: string[] = [];
  uploading = false;

  ionViewWillEnter(): void {
    this.providers.myProfile().subscribe((p) => {
      this.profile = p;
      this.portfolio = p.portfolio || [];
    });
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) return;
    this.uploading = true;
    const fd = new FormData();
    fd.append('image', file);
    this.http
      .post<{ data: { url: string } }>(`${environment.apiBaseUrl}/uploads/portfolio`, fd)
      .subscribe({
        next: (res) => {
          this.portfolio = [...this.portfolio, res.data.url];
          this.persist();
          this.uploading = false;
        },
        error: () => {
          this.uploading = false;
          this.notify('Upload failed');
        },
      });
    input.value = '';
  }

  remove(img: string): void {
    this.portfolio = this.portfolio.filter((x) => x !== img);
    this.persist();
  }

  private persist(): void {
    this.providers.upsert({ portfolio: this.portfolio }).subscribe(() => this.notify('Portfolio updated'));
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 1500 });
    await t.present();
  }
}
