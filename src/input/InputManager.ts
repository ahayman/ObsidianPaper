import type { StrokePoint } from "../types";

export type PointerAction = "draw" | "pan" | "zoom" | "none";

// Minimum screen-space movement before a tap becomes a drag (squared for fast comparison)
const TAP_MOVE_THRESHOLD_SQ = 10 * 10; // 10px

// Minimum pinch distance or center movement change before pinch activates (screen px)
const PINCH_ACTIVATE_THRESHOLD = 8;

export interface InputCallbacks {
  onStrokeStart: (point: StrokePoint) => void;
  onStrokeMove: (points: StrokePoint[], predicted: StrokePoint[]) => void;
  onStrokeEnd: (point: StrokePoint) => void;
  onStrokeCancel: () => void;
  onPanStart: () => void;
  onPanMove: (dx: number, dy: number) => void;
  onPanEnd: () => void;
  onPinchMove: (centerX: number, centerY: number, scale: number, panDx: number, panDy: number) => void;
  onPinchEnd: () => void;
  onTwoFingerTap: () => void;
  onThreeFingerTap: () => void;
  onHover?: (x: number, y: number, pointerType: string) => void;
  onHoverEnd?: () => void;
}

interface ActiveTouch {
  id: number;
  x: number;
  y: number;
}

/**
 * Manages all pointer events on the canvas element.
 * Discriminates between pen (draw), touch (pan/zoom), and mouse (draw).
 * Handles coalesced/predicted events, palm rejection, and gesture recognition.
 *
 * Pen events are captured at the document level (capture phase) to prevent
 * Obsidian's framework from intercepting them. Touch/mouse events use
 * standard element-level listeners.
 */
export class InputManager {
  private el: HTMLElement;
  private callbacks: InputCallbacks;
  private penActive = false;
  private drawPointerId: number | null = null;
  private activeTouches = new Map<number, ActiveTouch>();
  private initialPinchDistance: number | null = null;
  private lastPinchCenterX = 0;
  private lastPinchCenterY = 0;
  private isPinchActive = false;
  private isPanning = false;
  private lastPanX = 0;
  private lastPanY = 0;
  private touchStartTime = 0;
  private touchStartCount = 0;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchMoved = false;

  // Bound handlers for cleanup
  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundPointerCancel: (e: PointerEvent) => void;
  private boundPointerLeave: (e: PointerEvent) => void;
  private boundContextMenu: (e: Event) => void;

  // Document-level capture handlers for pen events
  private boundDocDown: (e: PointerEvent) => void;
  private boundDocMove: (e: PointerEvent) => void;
  private boundDocUp: (e: PointerEvent) => void;
  private boundDocCancel: (e: PointerEvent) => void;

  constructor(el: HTMLElement, callbacks: InputCallbacks) {
    this.el = el;
    this.callbacks = callbacks;

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundPointerLeave = this.handlePointerLeave.bind(this);
    this.boundContextMenu = (e: Event) => e.preventDefault();

    // Document-level capture handlers — intercept pen events before anything else
    this.boundDocDown = this.handleDocPointerDown.bind(this);
    this.boundDocMove = this.handleDocPointerMove.bind(this);
    this.boundDocUp = this.handleDocPointerUp.bind(this);
    this.boundDocCancel = this.handleDocPointerCancel.bind(this);

    this.attach();
  }

  private attach(): void {
    // Document-level capture for pen events — fires before any other handler
    document.addEventListener("pointerdown", this.boundDocDown, true);
    document.addEventListener("pointermove", this.boundDocMove, true);
    document.addEventListener("pointerup", this.boundDocUp, true);
    document.addEventListener("pointercancel", this.boundDocCancel, true);

    // Element-level listeners for touch (pan/zoom) and mouse, plus hover
    this.el.addEventListener("pointerdown", this.boundPointerDown);
    this.el.addEventListener("pointermove", this.boundPointerMove);
    this.el.addEventListener("pointerup", this.boundPointerUp);
    this.el.addEventListener("pointercancel", this.boundPointerCancel);
    this.el.addEventListener("pointerleave", this.boundPointerLeave);
    this.el.addEventListener("contextmenu", this.boundContextMenu);
  }

  /**
   * Convert the current pen stroke into a pan gesture.
   * Called when stroke starts outside all pages.
   */
  switchToPan(startPoint: StrokePoint): void {
    // Cancel any in-progress stroke
    if (this.drawPointerId !== null) {
      this.callbacks.onStrokeCancel();
      // Keep drawPointerId so we continue tracking this pointer
    }

    // Begin pan tracking from the given point
    this.isPanning = true;
    this.lastPanX = startPoint.x;
    this.lastPanY = startPoint.y;
    this.callbacks.onPanStart();
  }

  destroy(): void {
    // Remove document-level listeners
    document.removeEventListener("pointerdown", this.boundDocDown, true);
    document.removeEventListener("pointermove", this.boundDocMove, true);
    document.removeEventListener("pointerup", this.boundDocUp, true);
    document.removeEventListener("pointercancel", this.boundDocCancel, true);

    // Remove element-level listeners
    this.el.removeEventListener("pointerdown", this.boundPointerDown);
    this.el.removeEventListener("pointermove", this.boundPointerMove);
    this.el.removeEventListener("pointerup", this.boundPointerUp);
    this.el.removeEventListener("pointercancel", this.boundPointerCancel);
    this.el.removeEventListener("pointerleave", this.boundPointerLeave);
    this.el.removeEventListener("contextmenu", this.boundContextMenu);

  }

  // ─── Document-level capture handlers (pen events) ───────────────────

  private isWithinElement(e: PointerEvent): boolean {
    const target = e.target as Node | null;
    return target !== null && this.el.contains(target);
  }

  /**
   * Check if the event target is within an interactive overlay (toolbar, popover)
   * that should receive pen events as normal clicks, not drawing strokes.
   */
  private isInteractiveOverlay(e: PointerEvent): boolean {
    const target = e.target as Element | null;
    if (!target) return false;
    return target.closest(".paper-toolbar, .paper-popover, .paper-popover__backdrop") !== null;
  }

  private handleDocPointerDown(e: PointerEvent): void {
    if (e.pointerType !== "pen") return;

    // Let interactive overlays (toolbar, popover) handle pen taps as normal clicks
    if (this.isInteractiveOverlay(e)) return;

    // Only handle if the event target is within our container
    if (!this.isWithinElement(e)) return;

    e.preventDefault();
    e.stopPropagation();

    // If a previous draw is still active (missed pointerup), cancel it
    if (this.drawPointerId !== null) {
      console.warn(`[PTR] orphaned draw id=${this.drawPointerId}, canceling before new stroke`);
      this.callbacks.onStrokeCancel();
    }

    this.drawPointerId = e.pointerId;
    this.penActive = true;
    this.callbacks.onStrokeStart(this.extractPoint(e));
  }

  private handleDocPointerMove(e: PointerEvent): void {
    if (e.pointerType !== "pen") return;
    if (e.pointerId !== this.drawPointerId) {
      // Hover detection: pen hovering (pressure === 0, not drawing)
      if (this.drawPointerId === null && e.pressure === 0 && this.isWithinElement(e) && !this.isInteractiveOverlay(e)) {
        const rect = this.el.getBoundingClientRect();
        this.callbacks.onHover?.(
          e.clientX - rect.left,
          e.clientY - rect.top,
          e.pointerType
        );
      }
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const coalesced = this.getCoalescedPoints(e);
    const predicted = this.getPredictedPoints(e);
    this.callbacks.onStrokeMove(coalesced, predicted);
  }

  private handleDocPointerUp(e: PointerEvent): void {
    if (e.pointerType !== "pen") return;
    if (e.pointerId !== this.drawPointerId) return;

    e.preventDefault();
    e.stopPropagation();

    this.callbacks.onStrokeEnd(this.extractPoint(e));
    this.drawPointerId = null;
    this.penActive = false;
  }

  private handleDocPointerCancel(e: PointerEvent): void {
    if (e.pointerType !== "pen") return;
    if (e.pointerId !== this.drawPointerId) return;

    e.stopPropagation();

    this.callbacks.onStrokeCancel();
    this.drawPointerId = null;
    this.penActive = false;
  }

  // ─── Element-level handlers (touch + mouse) ────────────────────────

  private handlePointerDown(e: PointerEvent): void {
    // Pen events are handled by document-level capture handlers
    if (e.pointerType === "pen") return;

    e.preventDefault();

    const action = this.classifyPointer(e);

    if (action === "draw") {
      // Mouse draw
      if (this.drawPointerId !== null) {
        this.callbacks.onStrokeCancel();
      }
      this.drawPointerId = e.pointerId;
      this.penActive = false;

      this.callbacks.onStrokeStart(this.extractPoint(e));
    } else if (action === "pan") {
      // Palm rejection: ignore touch while pen is drawing
      if (this.penActive) return;

      this.activeTouches.set(e.pointerId, {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      });

      // Track for tap detection
      if (this.activeTouches.size === 1) {
        this.touchStartTime = e.timeStamp;
        this.touchStartCount = 1;
        this.touchMoved = false;
      } else {
        this.touchStartCount = this.activeTouches.size;
      }

      if (this.activeTouches.size === 1) {
        this.isPanning = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        this.touchStartX = e.clientX;
        this.touchStartY = e.clientY;
        this.callbacks.onPanStart();
      } else if (this.activeTouches.size === 2) {
        // Start pinch — record initial state but don't activate yet
        const touches = Array.from(this.activeTouches.values());
        this.initialPinchDistance = this.touchDistance(
          touches[0],
          touches[1]
        );
        this.lastPinchCenterX = (touches[0].x + touches[1].x) / 2;
        this.lastPinchCenterY = (touches[0].y + touches[1].y) / 2;
        this.isPinchActive = false;
      }
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    // Pen events are handled by document-level capture handlers
    if (e.pointerType === "pen") return;

    if (e.pointerId === this.drawPointerId) {
      // Mouse draw
      const coalesced = this.getCoalescedPoints(e);
      const predicted = this.getPredictedPoints(e);
      this.callbacks.onStrokeMove(coalesced, predicted);
      return;
    }

    // Touch handling (pan/zoom)
    if (e.pointerType === "touch" && this.activeTouches.has(e.pointerId)) {
      if (this.penActive) return; // Palm rejection

      // Track movement for tap detection (require meaningful displacement)
      if (!this.touchMoved) {
        const dx = e.clientX - this.touchStartX;
        const dy = e.clientY - this.touchStartY;
        if (dx * dx + dy * dy > TAP_MOVE_THRESHOLD_SQ) {
          this.touchMoved = true;
        }
      }

      this.activeTouches.set(e.pointerId, {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      });

      const touches = Array.from(this.activeTouches.values());

      if (touches.length === 1 && this.isPanning) {
        const dx = e.clientX - this.lastPanX;
        const dy = e.clientY - this.lastPanY;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        this.callbacks.onPanMove(dx, dy);
      } else if (touches.length >= 2 && this.initialPinchDistance !== null) {
        const currentDistance = this.touchDistance(touches[0], touches[1]);

        // Don't activate pinch until distance changes meaningfully
        if (!this.isPinchActive) {
          const distDelta = Math.abs(currentDistance - this.initialPinchDistance);
          const centerX = (touches[0].x + touches[1].x) / 2;
          const centerY = (touches[0].y + touches[1].y) / 2;
          const centerDx = centerX - this.lastPinchCenterX;
          const centerDy = centerY - this.lastPinchCenterY;
          const centerDist = Math.sqrt(centerDx * centerDx + centerDy * centerDy);

          if (distDelta > PINCH_ACTIVATE_THRESHOLD || centerDist > PINCH_ACTIVATE_THRESHOLD) {
            this.isPinchActive = true;
          } else {
            return; // Below threshold — don't fire pinch
          }
        }

        const scale = currentDistance / this.initialPinchDistance;

        const centerX = (touches[0].x + touches[1].x) / 2;
        const centerY = (touches[0].y + touches[1].y) / 2;

        const panDx = centerX - this.lastPinchCenterX;
        const panDy = centerY - this.lastPinchCenterY;
        this.lastPinchCenterX = centerX;
        this.lastPinchCenterY = centerY;

        this.callbacks.onPinchMove(centerX, centerY, scale, panDx, panDy);
      }
    }

    // Hover detection for mouse
    if (
      this.drawPointerId === null &&
      e.pointerType === "mouse" &&
      e.pressure === 0
    ) {
      const rect = this.el.getBoundingClientRect();
      this.callbacks.onHover?.(
        e.clientX - rect.left,
        e.clientY - rect.top,
        e.pointerType
      );
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    // Pen events are handled by document-level capture handlers
    if (e.pointerType === "pen") return;

    if (e.pointerId === this.drawPointerId) {
      // Mouse draw end
      this.callbacks.onStrokeEnd(this.extractPoint(e));
      this.drawPointerId = null;
      this.penActive = false;
      return;
    }

    if (e.pointerType === "touch") {
      this.activeTouches.delete(e.pointerId);

      // Tap detection: quick touch with no movement
      if (
        this.activeTouches.size === 0 &&
        !this.touchMoved &&
        e.timeStamp - this.touchStartTime < 300
      ) {
        if (this.touchStartCount === 2) {
          this.callbacks.onTwoFingerTap();
        } else if (this.touchStartCount === 3) {
          this.callbacks.onThreeFingerTap();
        }
      }

      if (this.activeTouches.size === 0) {
        if (this.isPanning) {
          this.isPanning = false;
          this.callbacks.onPanEnd();
        }
        if (this.initialPinchDistance !== null) {
          this.initialPinchDistance = null;
          if (this.isPinchActive) {
            this.isPinchActive = false;
            this.callbacks.onPinchEnd();
          }
        }
        this.touchStartCount = 0;
      } else if (this.activeTouches.size === 1) {
        // Went from pinch back to single touch → resume panning
        this.initialPinchDistance = null;
        if (this.isPinchActive) {
          this.isPinchActive = false;
          this.callbacks.onPinchEnd();
        }
        const remaining = Array.from(this.activeTouches.values())[0];
        this.lastPanX = remaining.x;
        this.lastPanY = remaining.y;
        this.isPanning = true;
      }
    }
  }

  private handlePointerCancel(e: PointerEvent): void {
    // Pen events are handled by document-level capture handlers
    if (e.pointerType === "pen") return;

    if (e.pointerId === this.drawPointerId) {
      // Mouse draw cancel
      this.callbacks.onStrokeCancel();
      this.drawPointerId = null;
      this.penActive = false;
      return;
    }

    if (e.pointerType === "touch") {
      this.activeTouches.delete(e.pointerId);
      if (this.activeTouches.size === 0) {
        if (this.isPanning) {
          this.isPanning = false;
          this.callbacks.onPanEnd();
        }
        if (this.isPinchActive) {
          this.isPinchActive = false;
          this.callbacks.onPinchEnd();
        }
        this.initialPinchDistance = null;
        this.touchStartCount = 0;
      }
    }
  }

  private handlePointerLeave(e: PointerEvent): void {
    if (e.pointerType === "pen" || e.pointerType === "mouse") {
      this.callbacks.onHoverEnd?.();
    }
  }

  /**
   * Classify a pointer event into an action.
   * pen → draw, mouse → draw, touch → pan/zoom
   */
  private classifyPointer(e: PointerEvent): PointerAction {
    if (e.pointerType === "pen") return "draw";
    if (e.pointerType === "mouse") return "draw";
    if (e.pointerType === "touch") return "pan";
    return "none";
  }

  /**
   * Extract a StrokePoint from a PointerEvent.
   */
  extractPoint(e: PointerEvent): StrokePoint {
    const rect = this.el.getBoundingClientRect();
    let tiltX = e.tiltX;
    let tiltY = e.tiltY;

    // Convert altitudeAngle/azimuthAngle to tiltX/tiltY if needed
    if (
      tiltX === 0 &&
      tiltY === 0 &&
      "altitudeAngle" in e &&
      "azimuthAngle" in e
    ) {
      const alt = (e as PointerEvent & { altitudeAngle: number }).altitudeAngle;
      const azi = (e as PointerEvent & { azimuthAngle: number }).azimuthAngle;
      const converted = altAzToTilt(alt, azi);
      tiltX = converted.tiltX;
      tiltY = converted.tiltY;
    }

    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure,
      tiltX,
      tiltY,
      twist: e.twist ?? 0,
      timestamp: e.timeStamp,
    };
  }

  /**
   * Get coalesced events from a PointerEvent (high-frequency samples).
   * Falls back to the single event if API not available.
   */
  private getCoalescedPoints(e: PointerEvent): StrokePoint[] {
    if (typeof e.getCoalescedEvents === "function") {
      try {
        const coalesced = e.getCoalescedEvents();
        if (coalesced.length > 0) {
          return coalesced.map((ce) => this.extractPoint(ce));
        }
      } catch {
        // Fall through to single point
      }
    }
    return [this.extractPoint(e)];
  }

  /**
   * Get predicted events from a PointerEvent (estimated future positions).
   * Returns empty array if API not available.
   */
  private getPredictedPoints(e: PointerEvent): StrokePoint[] {
    if (typeof e.getPredictedEvents === "function") {
      try {
        const predicted = e.getPredictedEvents();
        return predicted.map((pe) => this.extractPoint(pe));
      } catch {
        return [];
      }
    }
    return [];
  }

  private touchDistance(a: ActiveTouch, b: ActiveTouch): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

}

/**
 * Convert altitudeAngle/azimuthAngle (radians) to tiltX/tiltY (degrees).
 * Used for Safari on iPad where tiltX/tiltY may not be directly available.
 */
function altAzToTilt(
  altitudeAngle: number,
  azimuthAngle: number
): { tiltX: number; tiltY: number } {
  // altitudeAngle: 0 = parallel to surface, PI/2 = perpendicular
  // azimuthAngle: 0 = pointing right, PI/2 = pointing toward user

  if (altitudeAngle >= Math.PI / 2) {
    return { tiltX: 0, tiltY: 0 };
  }

  const tanAlt = Math.tan(altitudeAngle);
  const tiltX =
    (Math.atan(Math.cos(azimuthAngle) / tanAlt) * 180) / Math.PI - 90;
  const tiltY =
    (Math.atan(Math.sin(azimuthAngle) / tanAlt) * 180) / Math.PI - 90;

  return {
    tiltX: Math.round(tiltX),
    tiltY: Math.round(tiltY),
  };
}
