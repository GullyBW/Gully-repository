import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class BlockService {
  private api = inject(ApiService);

  list(): Observable<string[]> {
    return this.api.get<string[]>('/blocks');
  }

  block(userId: string): Observable<unknown> {
    return this.api.post(`/blocks/${userId}`, {});
  }

  unblock(userId: string): Observable<unknown> {
    return this.api.delete(`/blocks/${userId}`);
  }
}
