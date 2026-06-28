import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

/** Skeleton placeholder rows shown while data loads. */
@Component({
  selector: 'app-skeleton-list',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <ion-list>
      <ion-item *ngFor="let i of rows" lines="full">
        <ion-thumbnail slot="start" *ngIf="avatar">
          <ion-skeleton-text [animated]="true"></ion-skeleton-text>
        </ion-thumbnail>
        <ion-label>
          <h3><ion-skeleton-text [animated]="true" style="width: 60%"></ion-skeleton-text></h3>
          <p><ion-skeleton-text [animated]="true" style="width: 90%"></ion-skeleton-text></p>
          <p><ion-skeleton-text [animated]="true" style="width: 40%"></ion-skeleton-text></p>
        </ion-label>
      </ion-item>
    </ion-list>
  `,
})
export class SkeletonListComponent {
  @Input() count = 5;
  @Input() avatar = true;

  get rows(): number[] {
    return Array.from({ length: this.count }, (_, i) => i);
  }
}
