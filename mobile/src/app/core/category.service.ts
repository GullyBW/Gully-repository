import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { ApiService } from './api.service';
import { Category } from './models';

/** Service categories (cached — the list is small and stable). */
@Injectable({ providedIn: 'root' })
export class CategoryService {
  private api = inject(ApiService);
  private cache$?: Observable<Category[]>;

  list(): Observable<Category[]> {
    if (!this.cache$) {
      this.cache$ = this.api.get<Category[]>('/categories').pipe(shareReplay(1));
    }
    return this.cache$;
  }
}
