import { Injectable } from '@angular/core';
import { ProviderCard } from './models';

const KEY = 'tirelo_recent_providers';
const MAX = 12;

export type RecentProvider = ProviderCard & { viewedAt: number };

/** Tracks recently viewed providers client-side (no backend needed). */
@Injectable({ providedIn: 'root' })
export class RecentlyViewedService {
  add(provider: ProviderCard): void {
    const list = this.list().filter((p) => p.userId !== provider.userId);
    list.unshift({ ...provider, viewedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  }

  list(): RecentProvider[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]') as RecentProvider[];
    } catch {
      return [];
    }
  }

  remove(userId: string): void {
    localStorage.setItem(KEY, JSON.stringify(this.list().filter((p) => p.userId !== userId)));
  }

  clear(): void {
    localStorage.removeItem(KEY);
  }
}
