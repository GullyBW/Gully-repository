import { Injectable } from '@angular/core';
import { ProviderCard } from './models';

const KEY = 'tirelo_recent_providers';
const MAX = 12;

/** Tracks recently viewed providers client-side (no backend needed). */
@Injectable({ providedIn: 'root' })
export class RecentlyViewedService {
  add(provider: ProviderCard): void {
    const list = this.list().filter((p) => p.userId !== provider.userId);
    list.unshift(provider);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  }

  list(): ProviderCard[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]') as ProviderCard[];
    } catch {
      return [];
    }
  }

  clear(): void {
    localStorage.removeItem(KEY);
  }
}
