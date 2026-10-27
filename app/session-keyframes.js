'use strict';

/*
 * Format C of a painting session: keyframes derived from the ticks of format A
 * (docs/PLAYER-MAX-SPEED-AND-SESSION-RECORDING-SPEC.md §2.5, fluid-session
 * phase 5). A file whose ticks this engine cannot replay exactly (another
 * engineContract) is replayed approximately from these points instead.
 *
 * A stroke's points are its begin point (t = 0), one point per tick (t = 1..n)
 * and the final contact, if any (t = n). Kept are the first and last point,
 * Ramer-Douglas-Peucker in (x, y) with EPSILON world px, every point whose
 * pressure moved more than PRESSURE_STEP from the last one kept for pressure,
 * and the pressure's turning points (with PRESSURE_HYSTERESIS, so float noise
 * on a flat pressure is no turning point).
 *
 * The section is JSON of integer arrays, the first value absolute and the rest
 * deltas: t in ticks, x and y in 1/64 px, pressure in 1/4096.
 *   { quanta: { xy: 64, p: 4096 }, strokes: [{ begin, t, x, y, p }] }
 * `begin` is the stroke's ordinal among the STROKE_BEGIN records: colour,
 * brush and variation come from there and are not repeated.
 */
const SessionKeyframes = (() => {
  const EPSILON = 0.5;
  const PRESSURE_STEP = 0.02;
  const PRESSURE_HYSTERESIS = 0.005;
  const XY_QUANTUM = 64;
  const P_QUANTUM = 4096;

  function formatError(message) {
    const error = new Error(`Session keyframes: ${message}`);
    error.name = 'SessionFormatError';
    return error;
  }

  /** Every stroke of a record stream as points { t, x, y, p }. */
  function strokePoints(records, heightScale) {
    const strokes = [];
    let points = null;
    let brushSize = 0;
    let tick = 0;
    for (const record of records) {
      switch (record.type) {
        case 'begin':
          brushSize = record.params.brushSize;
          tick = 0;
          points = [{ t: 0, x: record.params.x, y: record.params.y, p: record.params.pressure }];
          break;
        case 'ticks': {
          const data = record.data;
          // A tick carries the brush height, 2 * brushSize * max(pressure, 0.15)
          // (STROKE_HEIGHT_SCALE); the floor is lost, and it paints the same.
          for (let i = 0; i < data.length; i += 3) {
            tick++;
            const p = Math.min(1, Math.max(0, data[i + 2] / (heightScale * brushSize)));
            points.push({ t: tick, x: data[i], y: data[i + 1], p });
          }
          break;
        }
        case 'contact':
          if (points) points.push({ t: tick, x: record.x, y: record.y, p: record.pressure });
          break;
        case 'end':
          if (points) strokes.push(points);
          points = null;
          break;
      }
    }
    return strokes;
  }

  function segmentDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    let t = lengthSquared > 0 ? ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
  }

  /** Indices of the points kept, ascending. */
  function simplify(points, { epsilon = EPSILON, pressureStep = PRESSURE_STEP,
    hysteresis = PRESSURE_HYSTERESIS } = {}) {
    const last = points.length - 1;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[last] = 1;
    // RDP with an explicit stack: a 2-hour stroke must not overflow the call stack.
    const stack = [[0, last]];
    while (stack.length) {
      const [first, end] = stack.pop();
      let farthest = -1;
      let distance = epsilon;
      for (let i = first + 1; i < end; i++) {
        const d = segmentDistance(points[i], points[first], points[end]);
        if (d > distance) {
          distance = d;
          farthest = i;
        }
      }
      if (farthest < 0) continue;
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, end]);
    }
    let reference = points[0].p;
    for (let i = 1; i < last; i++) {
      if (Math.abs(points[i].p - reference) > pressureStep) {
        keep[i] = 1;
        reference = points[i].p;
      }
    }
    // Turning points of the pressure: an extreme is confirmed once the pressure
    // has come back from it by more than the hysteresis.
    let direction = 0;
    let extreme = 0;
    for (let i = 1; i <= last; i++) {
      const p = points[i].p;
      if (direction === 0) {
        if (Math.abs(p - points[0].p) > hysteresis) {
          direction = Math.sign(p - points[0].p);
          extreme = i;
        }
      } else if ((p - points[extreme].p) * direction > 0) {
        extreme = i;
      } else if ((points[extreme].p - p) * direction > hysteresis) {
        keep[extreme] = 1;
        direction = -direction;
        extreme = i;
      }
    }
    const indices = [];
    for (let i = 0; i <= last; i++) if (keep[i]) indices.push(i);
    return indices;
  }

  function deltas(values) {
    return values.map((value, i) => (i === 0 ? value : value - values[i - 1]));
  }

  /** The KEYFRAMES section for a session's records. */
  function build(records, { heightScale, ...options } = {}) {
    if (!(heightScale > 0)) throw new RangeError('SessionKeyframes.build needs the engine\'s brush height scale.');
    const strokes = strokePoints(records, heightScale).map((points, begin) => {
      const kept = simplify(points, options).map((i) => points[i]);
      return {
        begin,
        t: deltas(kept.map((point) => point.t)),
        x: deltas(kept.map((point) => Math.round(point.x * XY_QUANTUM))),
        y: deltas(kept.map((point) => Math.round(point.y * XY_QUANTUM))),
        p: deltas(kept.map((point) => Math.round(point.p * P_QUANTUM))),
      };
    });
    return { quanta: { xy: XY_QUANTUM, p: P_QUANTUM }, strokes };
  }

  /** Back to absolute points: [{ begin, t: [], x: [], y: [], p: [] }], validated. */
  function decode(section) {
    if (!section || !Array.isArray(section.strokes)) throw formatError('there is no stroke list.');
    const quanta = section.quanta || {};
    const xy = quanta.xy || XY_QUANTUM;
    const pq = quanta.p || P_QUANTUM;
    if (!(xy > 0) || !(pq > 0)) throw formatError('the quanta are not positive.');
    return section.strokes.map((stroke, index) => {
      const arrays = [stroke && stroke.t, stroke && stroke.x, stroke && stroke.y, stroke && stroke.p];
      if (!arrays.every((array) => Array.isArray(array) && array.length === arrays[0].length && array.length > 0 &&
          array.every(Number.isInteger))) {
        throw formatError(`stroke ${index} has malformed points.`);
      }
      if (stroke.begin !== index) throw formatError(`stroke ${index} refers to begin ${stroke.begin}.`);
      const sum = (array) => {
        let total = 0;
        return array.map((delta) => (total += delta));
      };
      const t = sum(stroke.t);
      if (t[0] < 0 || stroke.t.some((delta, i) => i > 0 && delta < 0)) {
        throw formatError(`stroke ${index} goes back in time.`);
      }
      return {
        begin: stroke.begin,
        t,
        x: sum(stroke.x).map((value) => value / xy),
        y: sum(stroke.y).map((value) => value / xy),
        p: sum(stroke.p).map((value) => Math.min(1, Math.max(0, value / pq))),
      };
    });
  }

  return Object.freeze({
    EPSILON, PRESSURE_STEP, PRESSURE_HYSTERESIS, XY_QUANTUM, P_QUANTUM,
    strokePoints, simplify, build, decode,
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SessionKeyframes;
if (typeof globalThis !== 'undefined') globalThis.SessionKeyframes = SessionKeyframes;
