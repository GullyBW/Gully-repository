import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterLink],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>Tirelo Services</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="ion-text-center ion-margin-vertical">
        <h1>Welcome back</h1>
        <p>Find trusted local vendors near you.</p>
      </div>

      <form (ngSubmit)="submit()">
        <ion-list>
          <ion-item>
            <ion-input
              label="Email"
              labelPlacement="floating"
              type="email"
              [(ngModel)]="email"
              name="email"
              required
            ></ion-input>
          </ion-item>
          <ion-item>
            <ion-input
              label="Password"
              labelPlacement="floating"
              type="password"
              [(ngModel)]="password"
              name="password"
              required
            ></ion-input>
          </ion-item>
        </ion-list>

        <ion-button expand="block" type="submit" [disabled]="loading">
          {{ loading ? 'Signing in…' : 'Sign in' }}
        </ion-button>
      </form>

      <p class="ion-text-center">
        No account? <a routerLink="/register">Create one</a>
      </p>
    </ion-content>
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastController);

  email = '';
  password = '';
  loading = false;

  submit(): void {
    if (!this.email || !this.password) return;
    this.loading = true;
    this.auth.login(this.email, this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigateByUrl('/tabs/home');
      },
      error: async (err) => {
        this.loading = false;
        await this.notify(err?.error?.error?.message || 'Login failed');
      },
    });
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2500, color: 'danger' });
    await t.present();
  }
}
