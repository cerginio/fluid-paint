/** pointerApiClient */
class PointerDispatcher {
    constructor(el, options = {}) {
        this.el = el;
        this.events = {};
        this.pointers = new Map();
        this.sessionId = 0;
        this.opts = {
            capture: true,
            // double tap
            tapMaxMove: 50,
            tapMaxDuration: 300,
            doubleTapDelay: 300,
            // swipe
            swipeMinDistance: 300,     // px
            swipeMinVelocity: 0.3,     // px/ms  (≈400 px/s)
            swipeMaxDuration: 300,     // ms
            // inertia velocity smoothing window (ms)
            velocityWindowMs: 100,
            // inertia idle factor
            idleZeroMs: 180,      // pause >= this → no inertia
            idleMode: 'linear',   // 'linear' | 'exp'
            idleTauMs: 120,       // used when idleMode === 'exp'
            holdDelay: 500,          // ms to recognize hold
            holdMoveTolerance: 8,    // px max drift during hold
            holdIntervalMs: 250,    // ms between holdtick events
            ...options,
        };

        // centroid state
        this.center = null;
        this.startCenter = null;
        this.lastTime = null; // ms

        // 2-finger state
        this.prevDist2 = null;
        this.prevAngle2 = null;

        // 3-finger state
        this.prevAngle3 = null;

        // tap state
        this.doubleTapCandidate = null;  // {t0,x0,y0,maxMove}
        this.lastTapTime = 0;      // ms
        this.lastTapPos = null;    // {x,y}

        // deferred frame payloads
        this._pending = { pan: null, pan2: null, pinch: null, rotate2: null, rotate3: null };
        this._rafScheduled = false;
        this._lastFlushTs = performance.now();

        // --- NEW: gesture activity flags & velocity buffers ---
        this._active = { pan: false, pan2: false, pinch: false, rotate2: false, rotate3: false };
        this._vel = {
            pan: [],     // {t,x,y}
            pan2: [],    // {t,x,y}
            rotate2: [], // {t,aDeg}
            pinch: [],   // {t,sLog}
            rotate3: [], // {t,aDeg}
        };

        // cached element rect (see _rectOf)
        this._rectCache = null;

        // listeners
        el.addEventListener('pointerdown', this._down, { passive: true });
        el.addEventListener('pointermove', this._move, { passive: false });
        el.addEventListener('pointerup', this._up, { passive: true });
        el.addEventListener('pointercancel', this._up, { passive: true });

        // Anything that can move or resize the element invalidates the cached rect.
        window.addEventListener('scroll', this.invalidateRect, { passive: true, capture: true });
        window.addEventListener('resize', this.invalidateRect, { passive: true });
    }

    on = (type, fn) => { (this.events[type] ||= []).push(fn); return this; };
    off = (type, fn) => { this.events[type] = (this.events[type] || []).filter(f => f !== fn); return this; };
    emit = (type, e) => {
        (this.events[type] || []).forEach(fn => {
            e.sessionId = this.sessionId;
            fn(e);
        });
    };
    // (kept for compatibility; not used by core path)
    emitDeferred(type, data) {
        this._pending[type] = data;
        if (!this._rafScheduled) {
            this._rafScheduled = true;
            requestAnimationFrame(() => {
                this._rafScheduled = false;
                for (const [t, d] of Object.entries(this._pending)) {
                    (this.events[t] || []).forEach(fn => fn(d));
                }
                this._pending = { pan: null, pan2: null, pinch: null, rotate2: null, rotate3: null };
            });
        }
    }

    // reset intiated by external event f.e window.leavemouse
    //
    // Guarded on _active.pan, like every other _emitPanEnd call site (_up at :207, the
    // two-finger promotion at :155). Without the guard this fired panend for a gesture that
    // had already ended: the pointer merely crossing the #root-div boundary — an overlay edge
    // or the canvas edge — synthesised a second panend carrying the PREVIOUS stroke's
    // travelDistance, because that field is only refreshed while a pan is live.
    //
    // Reported with the journal in hand: two drawing.completed events, #21 and #22, identical
    // travelDistance=306.98, pointerType=mouse.custom.reset.onleave, and the second one passed
    // the "draw something" gate. The guide's own tile-count check (guide-events.js) cannot
    // catch this: the tiles from the real stroke ARE there, so the phantom looks like a
    // successful drawing. It has to not be emitted in the first place.
    resetPointer(pointerType) {
        if (this._active.pan) this._emitPanEnd(pointerType, this._calcCenter());
        this.pointers = new Map();
    }


    // _clone = e => { const { x, y } = toCanvasCoords(e, this.el); return { pointerId: e.pointerId, x, y }; };
    _clone = e => {
        const { x, y } = this._toCanvasCoords(e);
        if (isNaN(x) || isNaN(y)) throw 'Canvas Coords is NaN';

        return { x, y, startX: x, startY: y, pressure: e.pressure, pointerId: e.pointerId, pointerType: e.pointerType, button: e.button };
    };

    // to Array
    _points = (toNew = true) => {
        const arr = [...this.pointers.values()];
        return toNew
            ? arr.map(({ x, y }) => ({ x, y }))
            : arr;
    };
    // to Flat Array
    _pointsFlat = () => [...this.pointers.values()].flatMap(({ x, y }) => [x, y]);


    _down = e => {
        // A gesture may start after a layout change no listener told us about.
        this.invalidateRect();

        const wasN = this.pointers.size;
        const prevCenter = this._calcCenter();

        this.travelDistance = 0;

        if (this.opts.capture && (e.pointerType === 'touch') && this.pointers.size > 1) {
            this.el.setPointerCapture?.(e.pointerId);
        }

        const pt = this._clone(e);
        this.pointers.set(e.pointerId, pt);
        this.center = this._calcCenter();
        if (!this.startCenter && this.center) this.startCenter = { ...this.center };

        const n = this.pointers.size;
        if (n !== 2) { this.prevDist2 = null; this.prevAngle2 = null; }
        if (n !== 3) { this.prevAngle3 = null; }

        // --- START gestures on transitions ---
        if (!this._active.pan && n === 1) {
            this._active.pan = true;
            this._vel.pan.length = 0;
            this.emit('panstart', { type: 'panstart', centerX: this.center.x, centerY: this.center.y, pointerId: pt.pointerId, pointerType: pt.pointerType, button: pt.button, size: 1 });
        }
        if (n === 2 && wasN !== 2) {
            // if we were panning with 1 finger, end it now
            if (this._active.pan) this._emitPanEnd(e.pointerType, prevCenter);
            this._beginTwoFinger(e.pointerType);
        }
        if (n === 3 && wasN !== 3) {
            // end any 2-finger transforms
            if (this._active.pan2 || this._active.pinch || this._active.rotate2) this._emitTwoFingerEnds(e.pointerType, prevCenter);
            this._active.rotate3 = true; this._vel.rotate3.length = 0;
            this.emit('rotate3start', { type: 'rotate3start', centerX: this.center.x, centerY: this.center.y, size: 3 });
        }

        const tapPoint = { type: 'tapstart', x: pt.x, y: pt.y, pointerId: pt.pointerId, pointerType: pt.pointerType, button: pt.button, size: n };
        this.emit('tapstart', tapPoint);
        if (n === 1) {
            this.doubleTapCandidate = { t0: performance.now(), x0: pt.x, y0: pt.y, maxMove: 0 };
            this._swipeStart = { x: pt.x, y: pt.y, t: performance.now() };
            this._swipeCanceled = false;
            this._startHold(pt);

        } else {
            this.doubleTapCandidate = null;
            this._swipeCanceled = true; // multi-touch cancels swipe recognition
            this._cancelHold('multitouch');
        }
    };

    _up = e => {
        const prevN = this.pointers.size;
        const prevCenter = this._calcCenter();
        const prevSpan = this.prevDist2; // last known 2-finger distance

        const pt = this.pointers.get(e.pointerId);
        // hold: end or cancel on pointer up/cancel
        if (this._hold && this._hold.pointerId === e.pointerId) {
            if (this._hold.active)
                this._emitHoldEnd('up');
            else
                this._cancelHold('up');
        }
        this.pointers.delete(e.pointerId);
        this.center = this._calcCenter();
        const n = this.pointers.size;
        if (n !== 2) { this.prevDist2 = null; this.prevAngle2 = null; }
        if (n !== 3) { this.prevAngle3 = null; }

        // end gestures depending on previous pointer count
        if (prevN === 3 && this._active.rotate3) {
            this._emitRotate3End(e.pointerType, prevCenter);
        }
        if (prevN === 2 && (this._active.pan2 || this._active.pinch || this._active.rotate2)) {
            this._emitTwoFingerEnds(e.pointerType, prevCenter, prevSpan);
        }
        if (prevN === 1 && this._active.pan) {
            this._emitPanEnd(e.pointerType, prevCenter, e.button);
            this._pending.pan = null;
        }

        // single-finger swipe recognition on gesture end
        if (n === 0 && this._swipeStart && !this._swipeCanceled) {
            const now = performance.now();
            const end = pt || this.center || this._swipeStart;
            const dx = end.x - this._swipeStart.x;
            const dy = end.y - this._swipeStart.y;
            const dist = Math.hypot(dx, dy);
            const durMs = now - this._swipeStart.t;
            const vel = durMs ? dist / durMs : 0;

            if (dist >= this.opts.swipeMinDistance && vel >= this.opts.swipeMinVelocity && durMs < this.opts.swipeMaxDuration) {
                const dir = this._swipeDir(dx, dy);
                this.emit('swipe', {
                    type: 'swipe',
                    dir,
                    dx, dy,
                    startX: this._swipeStart.x,
                    startY: this._swipeStart.y,
                    distance: dist,
                    durationMs: durMs, velocity: vel,
                    pointerType: e.pointerType,
                    button: e.button,
                    size: n
                });
            }
        }
        // cleanup
        if (n === 0) {
            this._swipeStart = null;
            this._swipeCanceled = false;
            this.sessionId++;
        }

        // evaluate tap/doubletap when last pointer lifts
        if (n === 0 && this.doubleTapCandidate && pt) {
            const now = performance.now();
            const duration = now - this.doubleTapCandidate.t0;
            const move = this._distance({ x: this.doubleTapCandidate.x0, y: this.doubleTapCandidate.y0 }, pt);
            const withinTap = duration <= this.opts.tapMaxDuration &&
                move <= this.opts.tapMaxMove &&
                this.doubleTapCandidate.maxMove <= this.opts.tapMaxMove;
            if (withinTap) {
                const tapPoint = { x: pt.x, y: pt.y, pointerId: pt.pointerId, pointerType: pt.pointerType, button: e.button, size: n };
                if (now - this.lastTapTime <= this.opts.doubleTapDelay && this.lastTapPos) {
                    const d2 = this._distance(this.lastTapPos, tapPoint);
                    if (d2 <= this.opts.tapMaxMove) {
                        tapPoint.type = 'doubletap';
                        tapPoint.span = d2;
                        this.emit('doubletap', tapPoint);
                        this.lastTapTime = 0;
                        this.lastTapPos = null;
                    } else {
                        tapPoint.type = 'tap';
                        this.emit('tap', tapPoint);
                        this.lastTapTime = now;
                        this.lastTapPos = tapPoint;
                    }
                } else {
                    tapPoint.type = 'tap';
                    this.emit('tap', tapPoint);
                    this.lastTapTime = now;
                    this.lastTapPos = tapPoint;
                }
            }
        }

        if (n === 0) { this.startCenter = null; this.lastTime = null; this.doubleTapCandidate = null; }
    };


    _move = (e) => {
        // LOCAL PATCH (fluid-paint, Phase 6) -- see docs/UI-COMPONENTS.md.
        //
        // Upstream tests only whether getCoalescedEvents EXISTS, not whether it
        // returned anything. A synthetic PointerEvent (dispatchEvent, as the
        // golden harness and any automated test uses) has the method but returns
        // an EMPTY list, so `samples` was [], the loop below never ran, and no
        // pan/pan2/pinch was ever emitted -- panstart and panend still fired,
        // which is what makes it look like input works.
        //
        // Falling back to the event itself when the list is empty. Real input is
        // unaffected: a trusted move always coalesces to at least one sample.
        const coalesced = (typeof e.getCoalescedEvents === 'function')
            ? e.getCoalescedEvents()
            : null;
        const samples = (coalesced && coalesced.length) ? coalesced : [e];

        if (this.pointers.has(e.pointerId)) {

            if (this.pointers.size > 1) this._swipeCanceled = true;

            e.preventDefault();

            for (const ce of samples) {
                this._processMoveSample(ce);
            }
        } else {

            const pt = this._clone(e);
            pt.size = this.pointers.size;
            this.emit('cursormove', pt);
        }
    };

    _processMoveSample = e => {
        if (!this.pointers.has(e.pointerId)) return;

        const pt = this._clone(e);
        this.pointers.set(e.pointerId, pt);

        const n = this.pointers.size;

        const now = performance.now();
        // const dt = this.lastTime == null ? 0 : Math.max(0.000001, (now - this.lastTime) / 1000);

        const c = this._calcCenter();
        if (!this.center) this.center = c;
        if (!this.startCenter && c) this.startCenter = { x: c.x, y: c.y };

        if (c) {
            const dx = c.x - this.center.x;
            const dy = c.y - this.center.y;
            this.travelDistance += Math.hypot(dx, dy);
            const distFromStart = this.startCenter ? this._distance(c, this.startCenter) : 0;

            // --- velocity samples ---
            if (n === 1) this._addPanSample('pan', now, c.x, c.y);
            if (n >= 2) this._addPanSample('pan2', now, c.x, c.y);


            if ((dx || dy) && n >= 2) {
                const [p0, p1] = [...this.pointers.values()];
                const span = this._distance(p0, p1);
                const prev = (this.prevDist2 == null) ? span : this.prevDist2; // guard first frame
                const spanDelta = span - prev;

                if (n === 2) {
                    this._addPinchSample(now, span);
                }

                this._deferPan2(dx, dy, {
                    centerX: c.x,
                    centerY: c.y,
                    distance: distFromStart,
                    span,
                    spanDelta,
                    travelDistance: this.travelDistance,
                    pointerId: pt.pointerId,
                    pointerType: pt.pointerType,
                    size: n
                });
            }


            if ((dx || dy) && n === 1) {
                this._deferPan(dx, dy, {
                    centerX: c.x,
                    centerY: c.y,
                    distance: distFromStart,
                    pressure: pt.pressure,
                    travelDistance: this.travelDistance,
                    pointerId: pt.pointerId,
                    pointerType: pt.pointerType,
                    button: pt.button,
                    size: n
                });
            }

            if (this.doubleTapCandidate && n === 1) {
                const mv = this._distance({ x: this.doubleTapCandidate.x0, y: this.doubleTapCandidate.y0 }, pt);
                if (mv > this.doubleTapCandidate.maxMove) this.doubleTapCandidate.maxMove = mv;
            }
        }

        if (n === 2) {
            const [a, b] = [...this.pointers.values()];
            const dist = this._distance(a, b);
            const angRad = Math.atan2(b.y - a.y, b.x - a.x);

            if (this.prevDist2 == null) this.prevDist2 = dist;
            if (this.prevAngle2 == null) this.prevAngle2 = angRad;

            const spanDelta = dist - this.prevDist2;
            const scaleDelta = dist / this.prevDist2;

            if (scaleDelta !== 1 && Number.isFinite(scaleDelta)) {
                this._deferPinch(scaleDelta, {
                    centerX: c.x,
                    centerY: c.y,
                    span: dist,
                    spanDelta,
                    travelDistance: this.travelDistance,
                    pointerId: pt.pointerId,
                    pointerType: pt.pointerType,
                    size: n,
                });
            }

            let angleDegDelta = (angRad - this.prevAngle2) * 180 / Math.PI;
            angleDegDelta = ((angleDegDelta + 180) % 360) - 180;
            if (angleDegDelta) {
                const aDeg = (angRad * 180 / Math.PI);
                this._addRotateSample('rotate2', now, aDeg);
                this._deferRotate2(angleDegDelta, {
                    centerX: c.x,
                    centerY: c.y,
                    span: dist,
                    spanDelta,
                    travelDistance: this.travelDistance,
                    pointerId: pt.pointerId,
                    pointerType: pt.pointerType,
                    size: n,
                });
            }

            this.prevDist2 = dist;
            this.prevAngle2 = angRad;
            this.prevAngle3 = null;
        }
        else if (n === 3) {
            const ang3 = this._angle3Rad();
            const aDeg3 = (ang3 * 180 / Math.PI);
            this._addRotateSample('rotate3', now, aDeg3);

            if (this.prevAngle3 == null) this.prevAngle3 = ang3;
            let angleDegDelta3 = (ang3 - this.prevAngle3) * 180 / Math.PI;
            angleDegDelta3 = ((angleDegDelta3 + 180) % 360) - 180;
            if (angleDegDelta3) {
                this._deferRotate3(angleDegDelta3, {
                    centerX: c.x,
                    centerY: c.y,
                    travelDistance: this.travelDistance,
                    pointerId: pt.pointerId,
                    pointerType: pt.pointerType,
                    size: n,
                });
                this.prevAngle3 = ang3;
            }
            this.prevDist2 = null; this.prevAngle2 = null;
        } else {
            this.prevDist2 = null; this.prevAngle2 = null; this.prevAngle3 = null;
        }

        this.center = c;
        this.lastTime = now;
        this._updateHoldOnMove();
        // ensure 2-finger transforms are marked active while moving with 2 touches
        if (n === 2) {
            if (!this._active.pan2 || !this._active.pinch || !this._active.rotate2) this._beginTwoFinger();
        }
    };
    // --- helpers: starts/ends for 2-finger set ---
    _beginTwoFinger(pointerType) {
        if (!this._active.pan2) { this._active.pan2 = true; this._vel.pan2.length = 0; this.emit('pan2start', { type: 'pan2start', centerX: this.center?.x, centerY: this.center?.y, size: 2, pointerType }); }
        if (!this._active.pinch) { this._active.pinch = true; this._vel.pinch.length = 0; this.emit('pinchstart', { type: 'pinchstart', centerX: this.center?.x, centerY: this.center?.y, size: 2, pointerType }); }
        if (!this._active.rotate2) { this._active.rotate2 = true; this._vel.rotate2.length = 0; this.emit('rotate2start', { type: 'rotate2start', centerX: this.center?.x, centerY: this.center?.y, size: 2, pointerType }); }
    }

    _emitTwoFingerEnds(pointerType, prevCenter, prevSpan) {
        if (this._active.pan2) this._emitPan2End(pointerType, prevCenter);
        if (this._active.pinch) this._emitPinchEnd(pointerType, prevCenter, prevSpan);
        if (this._active.rotate2) this._emitRotate2End(pointerType, prevCenter, prevSpan);
    }


    _emitPanEnd(pointerType, prevCenter, button) {
        const idleMs = Math.max(0, performance.now() - (this.lastTime ?? performance.now()));
        const k = this._idleFactor(idleMs);
        let { vx, vy } = this._computePanVelocity(this._vel.pan);
        vx *= k; vy *= k;
        this.emit('panend', { type: 'panend', vx, vy, idleMs, centerX: prevCenter?.x, centerY: prevCenter?.y, pointerType, button, size: 1, travelDistance: this.travelDistance });
        this._active.pan = false; this._vel.pan.length = 0;
    }

    _emitPan2End(pointerType, prevCenter) {
        const idleMs = Math.max(0, performance.now() - (this.lastTime ?? performance.now()));
        const k = this._idleFactor(idleMs);
        let { vx, vy } = this._computePanVelocity(this._vel.pan2);
        vx *= k; vy *= k;
        this.emit('pan2end', { type: 'pan2end', vx, vy, idleMs, centerX: prevCenter?.x, centerY: prevCenter?.y, pointerType, size: 2, travelDistance: this.travelDistance });
        this._active.pan2 = false; this._vel.pan2.length = 0;
    }

    _emitPinchEnd(pointerType, prevCenter, prevSpan) {
        const idleMs = Math.max(0, performance.now() - (this.lastTime ?? performance.now()));
        const k = this._idleFactor(idleMs);
        let vScale = this._computeScaleVelocity(this._vel.pinch) * k;
        this.emit('pinchend', { type: 'pinchend', vScale, idleMs, centerX: prevCenter?.x, centerY: prevCenter?.y, span: prevSpan, pointerType, size: 2, travelDistance: this.travelDistance });
        this._active.pinch = false; this._vel.pinch.length = 0;
    }

    _emitRotate2End(pointerType, prevCenter, prevSpan) {
        const idleMs = Math.max(0, performance.now() - (this.lastTime ?? performance.now()));
        const k = this._idleFactor(idleMs);
        let omega = this._computeOmega(this._vel.rotate2) * k;
        this.emit('rotate2end', { type: 'rotate2end', omega, idleMs, centerX: prevCenter?.x, centerY: prevCenter?.y, span: prevSpan, pointerType, size: 2, travelDistance: this.travelDistance });
        this._active.rotate2 = false; this._vel.rotate2.length = 0;
    }

    _emitRotate3End(pointerType, prevCenter) {
        const idleMs = Math.max(0, performance.now() - (this.lastTime ?? performance.now()));
        const k = this._idleFactor(idleMs);
        let omega = this._computeOmega(this._vel.rotate3) * k;
        this.emit('rotate3end', { type: 'rotate3end', omega, idleMs, centerX: prevCenter?.x, centerY: prevCenter?.y, pointerType, size: 3, travelDistance: this.travelDistance });
        this._active.rotate3 = false; this._vel.rotate3.length = 0;
    }


    // --- velocity sample helpers ---
    _addPanSample(which, t, x, y) {
        const buf = this._vel[which];
        buf.push({ t, x, y });
        this._prune(buf, t);
    }

    _addRotateSample(which, t, aDeg) {
        const buf = this._vel[which];
        buf.push({ t, aDeg });
        this._prune(buf, t);
    }

    _addPinchSample(t, span) {
        const buf = this._vel.pinch;
        const sLog = Math.log(Math.max(1e-6, span));
        buf.push({ t, sLog });
        this._prune(buf, t);
    }

    _prune(buf, now) {
        const cutoff = now - this.opts.velocityWindowMs;
        while (buf.length && buf[0].t < cutoff) buf.shift();
    }

    _computePanVelocity(buf) {
        if (buf.length < 2) return { vx: 0, vy: 0 };
        const a = buf[0], b = buf[buf.length - 1];
        const dt = Math.max(1, b.t - a.t); // ms
        return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt }; // px/ms
    }

    _computeOmega(buf) { // deg/ms
        if (buf.length < 2) return 0;
        let total = 0;
        for (let i = 1; i < buf.length; i++) {
            let d = buf[i].aDeg - buf[i - 1].aDeg;
            d = ((d + 180) % 360) - 180; // wrap
            total += d;
        }
        const dt = Math.max(1, buf[buf.length - 1].t - buf[0].t);
        return total / dt;
    }

    _computeScaleVelocity(buf) { // 1/ms in log-domain
        if (buf.length < 2) return 0;
        const a = buf[0], b = buf[buf.length - 1];
        const dt = Math.max(1, b.t - a.t);
        return (b.sLog - a.sLog) / dt;
    }

    _swipeDir(dx, dy) {
        return Math.abs(dx) >= Math.abs(dy)
            ? (dx > 0 ? 'right' : 'left')
            : (dy > 0 ? 'down' : 'up');
    }

    // --- HOLD gesture ---
    _startHold = (pt) => {
        if (this.opts.holdDelay <= 0) return;
        this._cancelHold();
        this._hold = {
            t0: performance.now(), x0: pt.x, y0: pt.y,
            pointerId: pt.pointerId, pointerType: pt.pointerType, button: pt.button,
            active: false, maxDrift: 0,
            timer: setTimeout(() => {
                const H = this._hold;
                if (!H) return;
                if (this.pointers.size !== 1) return this._cancelHold('multitouch');
                const p = this.pointers.get(H.pointerId);
                if (!p) return this._cancelHold('gone');
                const drift = this._distance({ x: H.x0, y: H.y0 }, p);
                H.maxDrift = Math.max(H.maxDrift, drift);
                if (drift <= this.opts.holdMoveTolerance) {
                    H.active = true;
                    this.doubleTapCandidate = null; // don't treat as tap
                    this.emit('hold', {
                        type: 'hold',
                        durationMs: performance.now() - H.t0,
                        x: p.x, y: p.y,
                        centerX: this.center?.x, centerY: this.center?.y,
                        drift,
                        pointerId: H.pointerId,
                        pointerType: H.pointerType,
                        button: H.button,
                        size: 1
                    });
                    // start ticking
                    H.ticks = 0;
                    this.emit('holdtick', { type: 'holdtick', tick: H.ticks++, durationMs: performance.now() - H.t0, x: p.x, y: p.y, centerX: this.center?.x, centerY: this.center?.y, pointerId: H.pointerId, pointerType: H.pointerType, button: H.button, size: 1 });
                    H.interval = setInterval(() => {
                        const q = this.pointers.get(H.pointerId) || p;
                        this.emit('holdtick', { type: 'holdtick', tick: H.ticks++, durationMs: performance.now() - H.t0, x: q.x, y: q.y, centerX: this.center?.x, centerY: this.center?.y, pointerId: H.pointerId, pointerType: H.pointerType, button: H.button, size: 1 });
                    }, this.opts.holdIntervalMs);
                } else {
                    this._cancelHold('moved');
                }
            }, this.opts.holdDelay)
        };
    };


    _emitHoldEnd = (reason) => {
        const H = this._hold;
        if (!H) return;
        clearTimeout(H.timer);
        if (H.interval) clearInterval(H.interval);

        const p = this.pointers.get(H.pointerId) || { x: H.x0, y: H.y0 };
        if (H.active) this.emit('holdend', {
            type: 'holdend', reason,
            durationMs: performance.now() - H.t0,
            x: p.x, y: p.y,
            centerX: this.center?.x, centerY: this.center?.y,
            pointerId: H.pointerId, pointerType: H.pointerType, button: H.button, size: 1
        });
        this._hold = null;
    };

    _cancelHold = (reason) => {
        const H = this._hold;
        if (!H) return;
        clearTimeout(H.timer);
        if (H.interval) clearInterval(H.interval);
        this._hold = null;
    };


    _updateHoldOnMove = () => {
        const H = this._hold;
        if (!H) return;
        if (this.pointers.size !== 1) return this._cancelHold('multitouch');
        const p = this.pointers.get(H.pointerId);
        if (!p) return this._cancelHold('gone');
        const drift = this._distance({ x: H.x0, y: H.y0 }, p);
        H.maxDrift = Math.max(H.maxDrift, drift);
        if (!H.active) {
            if (drift > this.opts.holdMoveTolerance) this._cancelHold('moved');
        } else {
            if (drift > this.opts.holdMoveTolerance) this._emitHoldEnd('moved');
        }
    };

    /**
     * The element rect, reused within a frame.
     *
     * getBoundingClientRect() forces a synchronous layout. `_move` walks every
     * coalesced sample, so a 1000Hz pointer triggers 10-20 layout flushes per
     * frame against the whole document. The rect cannot change between samples
     * of one event, so one read per frame is equivalent — scroll, resize and
     * pointerdown drop the cache in case the canvas moved.
     */
    _rectOf(element) {
        const now = performance.now();
        if (!this._rectCache || this._rectCache.el !== element || now - this._rectCache.t > 16) {
            this._rectCache = { el: element, t: now, rect: element.getBoundingClientRect() };
        }
        return this._rectCache.rect;
    }

    /** Drop the cached rect — the element may have moved or resized. */
    invalidateRect = () => { this._rectCache = null; };

    _toCanvasCoords(e, element) {
        if (!element) element = this.el;
        const rect = this._rectOf(this.el);
        const x = (e.clientX - rect.left) * ((element.width ?? element.offsetWidth) / rect.width);
        const y = (e.clientY - rect.top) * ((element.height ?? element.offsetHeight) / rect.height);
        return { x, y };
    }

    _scheduleFlush = () => {
        if (this._rafScheduled) return;
        this._rafScheduled = true;
        requestAnimationFrame((ts) => {
            this._rafScheduled = false;
            const dt = Math.max(0.000001, (ts - this._lastFlushTs) / 1000);

            const P = this._pending;
            this._pending = { pan: null, pan2: null, pinch: null, rotate2: null, rotate3: null };

            if (P.pan) {
                const { dx, dy, centerX, centerY, distance, pressure, travelDistance, pointerId, pointerType, button, size } = P.pan;
                const speedX = dx / dt, speedY = dy / dt; // px/s
                this.emit('pan', { type: 'pan', dx, dy, speedX, speedY, distance, travelDistance, centerX, centerY, pressure, pointerId, pointerType, button, size });
            }
            if (P.pan2) {
                const { dx, dy, centerX, centerY, distance, span, spanDelta, travelDistance, pointerId, pointerType, size } = P.pan2;
                const speedX = dx / dt, speedY = dy / dt; // px/s
                this.emit('pan2', { type: 'pan2', dx, dy, speedX, speedY, distance, span, spanDelta, travelDistance, centerX, centerY, pointerId, pointerType, size, points: this._pointsFlat() });
            }
            if (P.pinch) {
                const { scale, centerX, centerY, span, spanDelta, travelDistance, pointerId, pointerType, size } = P.pinch;
                this.emit('pinch', { type: 'pinch', scale, centerX, centerY, span, spanDelta, travelDistance, pointerId, pointerType, size, points: this._pointsFlat() });
            }
            if (P.rotate2) {
                const { angle, centerX, centerY, span, spanDelta, travelDistance, pointerId, pointerType, size } = P.rotate2;
                const angleSpeed = angle / dt; // deg/s
                this.emit('rotate2', { type: 'rotate2', angle, angleSpeed, centerX, centerY, span, spanDelta, travelDistance, pointerId, pointerType, size, points: this._pointsFlat() });
            }
            if (P.rotate3) {
                const { angle, centerX, centerY, travelDistance, pointerId, pointerType, size } = P.rotate3;
                const angleSpeed = angle / dt; // deg/s
                this.emit('rotate3', { type: 'rotate3', angle, angleSpeed, centerX, centerY, travelDistance, pointerId, pointerType, size, points: this._pointsFlat() });
            }

            this._lastFlushTs = ts;
        });
    };

    // helpers to accumulate for per-frame emission
    _deferPan = (dx, dy, payload) => {
        const p = this._pending.pan ||= { dx: 0, dy: 0, ...payload };
        p.dx += dx;
        p.dy += dy;
        p.distance = payload.distance;
        p.pressure = payload.pressure;
        this._mapDeferPayload(p, payload);
    };

    _deferPan2 = (dx, dy, payload) => {
        const p = this._pending.pan2 ||= { dx: 0, dy: 0, ...payload };
        p.dx += dx;// additive
        p.dy += dy;
        p.distance = payload.distance;
        p.span = payload.span;
        p.spanDelta = payload.spanDelta;
        this._mapDeferPayload(p, payload);
    };

    _deferPinch = (scale, payload) => {
        const p = this._pending.pinch ||= { scale: 1, ...payload };
        p.scale *= scale; // multiplicative accumulation
        p.span = payload.span;
        p.spanDelta = payload.spanDelta;
        this._mapDeferPayload(p, payload);

    };
    _deferRotate2 = (angleDelta, payload) => {
        const p = this._pending.rotate2 ||= { angle: 0, ...payload };
        p.angle += angleDelta; // additive
        p.span = payload.span;
        p.spanDelta = payload.spanDelta;
        this._mapDeferPayload(p, payload);

    };
    _deferRotate3 = (angleDelta, payload) => {
        const p = this._pending.rotate3 ||= { angle: 0, ...payload };
        p.angle += angleDelta; // additive
        this._mapDeferPayload(p, payload);
    };

    _mapDeferPayload = (p, payload) => {
        p.id = payload.id;
        p.centerX = payload.centerX;
        p.centerY = payload.centerY;
        p.travelDistance = payload.travelDistance;
        p.size = payload.size;
        this._scheduleFlush();
    };

    _calcCenter = () => {
        const arr = [...this.pointers.values()];
        if (!arr.length) return null;
        const s = arr.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
        return { x: s.x / arr.length, y: s.y / arr.length };
    };

    _angle3Rad = () => {
        const c = this._calcCenter();
        const arr = [...this.pointers.values()];
        const angs = arr.map(p => Math.atan2(p.y - c.y, p.x - c.x));
        const sx = angs.reduce((s, a) => s + Math.cos(a), 0);
        const sy = angs.reduce((s, a) => s + Math.sin(a), 0);
        return Math.atan2(sy, sx);
    };

    _idleFactor(idleMs) {
        if (this.opts.idleMode === 'linear') {
            const Z = this.opts.idleZeroMs;
            return Math.max(0, Math.min(1, 1 - idleMs / Z));
        } else { // 'exp'
            const tau = this.opts.idleTauMs;
            return Math.exp(-idleMs / tau);
        }
    }


    _distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
}
