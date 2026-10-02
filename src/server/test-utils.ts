export class FakeClock {
  private ms: number;
  constructor(start: Date = new Date('2026-01-01T12:00:00.000Z')) {
    this.ms = start.getTime();
  }
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}
