import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { AuthService } from '../../core/auth.service';
import { NativePushService } from '../../core/native-push.service';
import { SocketService } from '../../core/socket.service';
import { UserRole } from '../../core/models';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, RouterLink],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button defaultHref="/login"></ion-back-button></ion-buttons>
        <ion-title>Create account</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <form (ngSubmit)="submit()">
        <ion-list>
          <ion-item>
            <ion-input label="Full name" labelPlacement="floating" [(ngModel)]="name" name="name" required></ion-input>
          </ion-item>
          <ion-item>
            <ion-input label="Email" labelPlacement="floating" type="email" [(ngModel)]="email" name="email" required></ion-input>
          </ion-item>
          <ion-item>
            <ion-input label="Phone (e.g. 26771000000)" labelPlacement="floating" type="tel" [(ngModel)]="phone" name="phone"></ion-input>
          </ion-item>
          <ion-item>
            <ion-input label="Password (min 8 chars)" labelPlacement="floating" type="password" [(ngModel)]="password" name="password" required></ion-input>
          </ion-item>
          <ion-item>
            <ion-select label="I am a" [(ngModel)]="role" name="role" interface="popover">
              <ion-select-option value="customer">Customer</ion-select-option>
              <ion-select-option value="provider">Service provider</ion-select-option>
            </ion-select>
          </ion-item>
        </ion-list>

        <ion-button expand="block" type="submit" [disabled]="loading">
          {{ loading ? 'Creating…' : 'Create account' }}
        </ion-button>
      </form>

      <p class="ion-text-center">
        Already have an account? <a routerLink="/login">Sign in</a>
      </p>
    </ion-content>
  `,
})
export class RegisterPage {
  private auth = inject(AuthService);
  private push = inject(NativePushService);
  private socket = inject(SocketService);
  private router = inject(Router);
  private toast = inject(ToastController);

  name = '';
  email = '';
  phone = '';
  password = '';
  role: UserRole = 'customer';
  loading = false;

  submit(): void {
    if (!this.name || !this.email || !this.password) return;
    this.loading = true;
    this.auth
      .register({
        name: this.name,
        email: this.email,
        password: this.password,
        phone: this.phone || undefined,
        role: this.role,
      })
      .subscribe({
        next: () => {
          this.loading = false;
          this.push.init();
          this.socket.connect();
          this.router.navigateByUrl('/tabs/home');
        },
        error: async (err) => {
          this.loading = false;
          await this.notify(err?.error?.error?.message || 'Registration failed');
        },
      });
  }

  private async notify(message: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2500, color: 'danger' });
    await t.present();
  }
}
