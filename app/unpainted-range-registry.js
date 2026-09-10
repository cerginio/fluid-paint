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
    return this._nextBoundary(afterIndex, plan && plan.frameRanges);
  }

  previousPendingFrame(beforeIndex, plan) {
    return this._previousPendingBoundary(beforeIndex, plan && plan.frameRanges);
  }

  snapshot() {
    return this.ranges.map((range) => ({ ...range }));
  }

  _nextBoundary(afterIndex, boundaries) {
    if (!Array.isArray(boundaries)) return null;
    const current = boundaries.find((range) => afterIndex >= range.start && afterIndex < range.end);
    if (current && current.end < this.planLength) return current.end;
    const next = boundaries.find((range) => range.start > afterIndex);
    return next ? next.start : null;
  }

  _previousPendingBoundary(beforeIndex, boundaries) {
    if (!Array.isArray(boundaries)) return null;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      const boundary = boundaries[i];
      if (boundary.start >= beforeIndex) continue;
      for (let j = this.ranges.length - 1; j >= 0; j--) {
        const pending = this.ranges[j];
        const start = Math.max(boundary.start, pending.start);
        const end = Math.min(boundary.end, pending.end, beforeIndex);
        if (start < end) {
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
