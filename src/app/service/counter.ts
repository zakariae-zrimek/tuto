import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'   // service singleton (recommandé)
})
export class Counter {

  private count = 0;

  increment() {
    this.count++;
  }

  decrement() {
    this.count--;
  }

  getCount() {
    return this.count;
  }

  reset() {
    this.count = 0;
  }
}
