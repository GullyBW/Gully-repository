import { Injectable } from '@angular/core';

/**
 * Client-side conversation preferences (pin / archive / mute) and locally
 * deleted messages. These are device-local only and never touch the backend,
 * so they don't require API changes.
 */
@Injectable({ providedIn: 'root' })
export class ChatPrefsService {
  private read(key: string): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
    } catch {
      return new Set();
    }
  }

  private write(key: string, set: Set<string>): void {
    localStorage.setItem(key, JSON.stringify([...set]));
  }

  private toggle(key: string, id: string): boolean {
    const set = this.read(key);
    let on: boolean;
    if (set.has(id)) {
      set.delete(id);
      on = false;
    } else {
      set.add(id);
      on = true;
    }
    this.write(key, set);
    return on;
  }

  isPinned(ref: string): boolean {
    return this.read('tirelo_chat_pinned').has(ref);
  }
  togglePin(ref: string): boolean {
    return this.toggle('tirelo_chat_pinned', ref);
  }

  isArchived(ref: string): boolean {
    return this.read('tirelo_chat_archived').has(ref);
  }
  toggleArchive(ref: string): boolean {
    return this.toggle('tirelo_chat_archived', ref);
  }

  isMuted(ref: string): boolean {
    return this.read('tirelo_chat_muted').has(ref);
  }
  toggleMute(ref: string): boolean {
    return this.toggle('tirelo_chat_muted', ref);
  }

  hiddenMessages(): Set<string> {
    return this.read('tirelo_chat_hidden_msgs');
  }
  hideMessage(id: string): void {
    const set = this.read('tirelo_chat_hidden_msgs');
    set.add(id);
    this.write('tirelo_chat_hidden_msgs', set);
  }
}
