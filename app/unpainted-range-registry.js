'use strict';

/*
 * Tracks the parts of one immutable Tilecraft playback plan that have not yet
 * deposited paint. Ranges are half-open, sorted and non-overlapping. This is
 * application/session state, not a FluidEngine texture or history stack.
 */
class UnpaintedRangeRegistry {
  constructor(planLength = 0) {
    this.reset(planLength);
  }

  reset(planLength) {
    if (!Number.isInteger(planLength) || planLength < 0) {
      throw new TypeError('Playback plan length must be a non-negative integer.');
    }
    this.planLength = planLength;
    this.ranges = planLength ? [{ start: 0, end: planLength, reason: 'future' }] : [];
  }

  get pendingCount() {
    return this.ranges.reduce((total, range) => total + range.end - range.start, 0);
  }

  contains(index) {
    return this.ranges.some((range) => index >= range.start && index < range.end);
  }

  markPainted(start, end) {
    this._validateRange(start, end);
    const next = [];
    for (const range of this.ranges) {
      if (end <= range.start || start >= range.end) {
        next.push(range);
        continue;
      }
      if (range.start < start) {
        next.push({ start: range.start, end: start, reason: range.reason });
      }
      if (end < range.end) {
        next.push({ start: end, end: range.end, reason: range.reason });
      }
    }
    this.ranges = this._merge(next);
  }

  markJump(start, end, reason) {
    this._validateRange(start, end);
    if (!['frame-jump', 'interrupted', 'future'].includes(reason)) {
      throw new TypeError(`Unknown pending range reason: ${reason}.`);
    }
    const next = [];
    for (const range of this.ranges) {
      if (end <= range.start || start >= range.end) {
        next.push(range);
        continue;
      }
      const overlapStart = Math.max(start, range.start);
      const overlapEnd = Math.min(end, range.end);
      if (range.start < overlapStart) {
        next.push({ start: range.start, end: overlapStart, reason: range.reason });
      }
      next.push({ start: overlapStart, end: overlapEnd, reason });
      if (overlapEnd < range.end) {
        next.push({ start: overlapEnd, end: range.end, reason: range.reason });
      }
    }
    this.ranges = this._merge(next);
  }

  earliestPending() {
    return this.ranges.length ? { ...this.ranges[0] } : null;
  }

  nextFrameBoundary(afterIndex, plan) {
    const range = this._cyclicPendingBoundary(afterIndex, plan && plan.frameRanges, 1);
    return range ? range.start : null;
  }

  previousPendingFrame(beforeIndex, plan) {
    return this._cyclicPendingBoundary(beforeIndex, plan && plan.frameRanges, -1);
  }

  snapshot() {
    return this.ranges.map((range) => ({ ...range }));
  }

  /**
   * Find pending content in the next/previous logical frame, wrapping at both
   * ends. The current frame is considered only after one complete cycle, so
   * navigation produces sequences such as 1-2-3-4-1 and 3-2-1-4.
   */
  _cyclicPendingBoundary(position, boundaries, direction) {
    if (!Array.isArray(boundaries) || !boundaries.length || !this.ranges.length) return null;
    let currentIndex = boundaries.findIndex(
      (boundary) => position >= boundary.start && position < boundary.end
    );
    if (currentIndex < 0) {
      if (position >= this.planLength) {
        currentIndex = direction > 0 ? boundaries.length - 1 : 0;
      } else {
        currentIndex = direction > 0 ? -1 : 0;
      }
    }

    for (let step = 1; step <= boundaries.length; step++) {
      const index = (currentIndex + direction * step + boundaries.length) % boundaries.length;
      const boundary = boundaries[index];
      for (const pending of this.ranges) {
        const start = Math.max(boundary.start, pending.start);
        const end = Math.min(boundary.end, pending.end);
        if (start < end && start !== position) {
          return { start, end, reason: pending.reason, key: boundary.key, label: boundary.label };
        }
      }
    }
    return null;
  }

  _validateRange(start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) ||
        start < 0 || end < start || end > this.planLength) {
      throw new RangeError(`Invalid playback range [${start}, ${end}).`);
    }
  }

  _merge(ranges) {
    const merged = [];
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      if (range.start >= range.end) continue;
      const previous = merged[merged.length - 1];
      if (previous && previous.end === range.start && previous.reason === range.reason) {
        previous.end = range.end;
      } else {
        merged.push({ ...range });
      }
    }
    return merged;
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = UnpaintedRangeRegistry;
if (typeof globalThis !== 'undefined') globalThis.UnpaintedRangeRegistry = UnpaintedRangeRegistry;
