import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

/** Reusable empty state with an icon, message and optional projected action. */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [IonicModule, CommonModule],
  template: `
    <div class="empty">
      <ion-icon [name]="icon"></ion-icon>
      <h3>{{ title }}</h3>
      <p *ngIf="message">{{ message }}</p>
      <ng-content></ng-content>
    </div>
  `,
  styles: [
    `
      .empty {
        text-align: center;
        padding: 48px 24px;
        color: var(--ion-color-medium);
      }
      .empty ion-icon {
        font-size: 56px;
        color: var(--ion-color-medium);
        margin-bottom: 8px;
      }
      .empty h3 {
        margin: 4px 0;
        color: var(--ion-text-color);
      }
    `,
  ],
})
export class EmptyStateComponent {
  @Input() icon = 'file-tray-outline';
  @Input() title = 'Nothing here yet';
  @Input() message?: string;
}
