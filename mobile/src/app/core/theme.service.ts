import { Injectable, signal } from '@angular/core';

const KEY = 'tirelo_theme';

/**
 * Dark-mode controller. Persists the choice and toggles Ionic's dark palette
 * class on <html>. Defaults to the OS preference on first run.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal<boolean>(false);

  init(): void {
    const stored = localStorage.getItem(KEY);
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.apply(stored ? stored === 'dark' : !!prefersDark);
  }

  toggle(): void {
    this.apply(!this.dark());
  }

  apply(isDark: boolean): void {
    this.dark.set(isDark);
    localStorage.setItem(KEY, isDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('ion-palette-dark', isDark);
  }
}
