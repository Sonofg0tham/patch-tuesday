/**
 * Accumulates visual animation time independently of wall time.
 *
 * Reduced motion freezes the visual phase while callers continue sampling the
 * wall clock. Restoring motion therefore resumes from the exact frozen pose
 * instead of jumping forward by the time spent reduced.
 */
export class MotionPhaseClock {
  private wallTime = 0;
  private phase = 0;
  private reducedMotion: boolean;

  constructor(reducedMotion = false) {
    this.reducedMotion = reducedMotion;
  }

  sample(wallTime: number, reducedMotion = this.reducedMotion): number {
    const nextWallTime = Math.max(this.wallTime, wallTime);
    if (!this.reducedMotion) {
      this.phase += nextWallTime - this.wallTime;
    }
    this.wallTime = nextWallTime;
    this.reducedMotion = reducedMotion;
    return this.phase;
  }
}
