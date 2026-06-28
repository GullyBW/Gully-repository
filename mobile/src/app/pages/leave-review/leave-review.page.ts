import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { BookingService } from '../../core/booking.service';
import { ReviewService } from '../../core/review.service';
import { Booking } from '../../core/models';

@Component({
  selector: 'app-leave-review',
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start"><ion-back-button></ion-back-button></ion-buttons>
        <ion-title>Leave a review</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <h3>How was the service?</h3>
      <div class="rating">
        <ion-icon
          *ngFor="let i of [1, 2, 3, 4, 5]"
          [name]="i <= rating ? 'star' : 'star-outline'"
          color="warning"
          (click)="rating = i"
        ></ion-icon>
      </div>

      <ion-item>
        <ion-input label="Title" labelPlacement="floating" [(ngModel)]="title"></ion-input>
      </ion-item>
      <ion-item>
        <ion-textarea label="Comment" labelPlacement="floating" [(ngModel)]="comment" [autoGrow]="true"></ion-textarea>
      </ion-item>

      <ion-button expand="block" class="ion-margin-top" (click)="submit()" [disabled]="!rating || submitting">
        {{ submitting ? 'Submitting…' : 'Submit review' }}
      </ion-button>
    </ion-content>
  `,
  styles: [`.rating ion-icon { font-size: 36px; margin-right: 6px; }`],
})
export class LeaveReviewPage implements ViewWillEnter {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private bookings = inject(BookingService);
  private reviews = inject(ReviewService);
  private toast = inject(ToastController);

  reference = '';
  booking?: Booking;
  rating = 0;
  title = '';
  comment = '';
  submitting = false;

  ionViewWillEnter(): void {
    this.reference = this.route.snapshot.paramMap.get('reference') || '';
    this.bookings.get(this.reference).subscribe((b) => (this.booking = b));
  }

  submit(): void {
    if (!this.booking || !this.rating) return;
    this.submitting = true;
    this.reviews
      .create({
        providerId: this.booking.providerId,
        bookingReference: this.reference,
        rating: this.rating,
        title: this.title || undefined,
        comment: this.comment || undefined,
      })
      .subscribe({
        next: async () => {
          this.submitting = false;
          await this.notify('Thanks for your review!', 'success');
          this.router.navigateByUrl('/tabs/bookings');
        },
        error: async (err) => {
          this.submitting = false;
          await this.notify(err?.error?.error?.message || 'Could not submit review', 'danger');
        },
      });
  }

  private async notify(message: string, color: string): Promise<void> {
    const t = await this.toast.create({ message, duration: 2400, color });
    await t.present();
  }
}
