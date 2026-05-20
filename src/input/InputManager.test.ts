import { InputManager } from "./InputManager";
import type { InputCallbacks } from "./InputManager";

// Polyfill PointerEvent for jsdom
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly pressure: number;
    readonly tiltX: number;
    readonly tiltY: number;
    readonly twist: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.pressure = init.pressure ?? 0;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

function createMockCallbacks(): InputCallbacks {
  return {
    onStrokeStart: jest.fn(),
    onStrokeMove: jest.fn(),
    onStrokeEnd: jest.fn(),
    onStrokeCancel: jest.fn(),
    onPanStart: jest.fn(),
    onPanMove: jest.fn(),
    onPanEnd: jest.fn(),
    onPinchMove: jest.fn(),
    onPinchEnd: jest.fn(),
    onPinchRebase: jest.fn(),
    onTwoFingerTap: jest.fn(),
    onThreeFingerTap: jest.fn(),
    onWheel: jest.fn(),
    onWheelEnd: jest.fn(),
  };
}

function createPointerEvent(
  type: string,
  overrides: Partial<PointerEvent> = {}
): PointerEvent {
  return new PointerEvent(type, {
    pointerId: 1,
    pointerType: "pen",
    clientX: 100,
    clientY: 200,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    bubbles: true,
    cancelable: true,
    ...overrides,
  } as PointerEventInit);
}

describe("InputManager", () => {
  let el: HTMLElement;
  let callbacks: InputCallbacks;
  let manager: InputManager;

  beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    // Mock getBoundingClientRect
    el.getBoundingClientRect = jest.fn(() => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

    callbacks = createMockCallbacks();
    manager = new InputManager(el, callbacks);
  });

  afterEach(() => {
    manager.destroy();
    el.remove();
  });

  describe("pen input (draw) — document-level capture", () => {
    it("should call onStrokeStart on pen pointerdown", () => {
      // Pen events are captured at document level, so dispatch on a child or the element itself
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen" }));
      expect(callbacks.onStrokeStart).toHaveBeenCalledTimes(1);
    });

    it("should call onStrokeMove on pen pointermove", () => {
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen", pointerId: 1 }));
      // pointermove captured at document level
      el.dispatchEvent(createPointerEvent("pointermove", { pointerType: "pen", pointerId: 1 }));
      expect(callbacks.onStrokeMove).toHaveBeenCalledTimes(1);
    });

    it("should call onStrokeEnd on pen pointerup", () => {
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen", pointerId: 1 }));
      el.dispatchEvent(createPointerEvent("pointerup", { pointerType: "pen", pointerId: 1 }));
      expect(callbacks.onStrokeEnd).toHaveBeenCalledTimes(1);
    });

    it("should call onStrokeCancel on pointercancel", () => {
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen", pointerId: 1 }));
      el.dispatchEvent(createPointerEvent("pointercancel", { pointerType: "pen", pointerId: 1 }));
      expect(callbacks.onStrokeCancel).toHaveBeenCalledTimes(1);
    });

    it("should handle rapid pen strokes without missing events", () => {
      // Simulate rapid: stroke 1 (down, move, up), stroke 2 (down, move, up)
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen", pointerId: 1 }));
      el.dispatchEvent(createPointerEvent("pointermove", { pointerType: "pen", pointerId: 1 }));
      el.dispatchEvent(createPointerEvent("pointerup", { pointerType: "pen", pointerId: 1 }));

      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen", pointerId: 2 }));
      el.dispatchEvent(createPointerEvent("pointermove", { pointerType: "pen", pointerId: 2 }));
      el.dispatchEvent(createPointerEvent("pointerup", { pointerType: "pen", pointerId: 2 }));

      expect(callbacks.onStrokeStart).toHaveBeenCalledTimes(2);
      expect(callbacks.onStrokeEnd).toHaveBeenCalledTimes(2);
    });

    it("should cancel orphaned stroke on new pointerdown", () => {
      // Start stroke but skip pointerup (simulate missed event)
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen", pointerId: 1 }));
      // New stroke starts without pointerup for first
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen", pointerId: 2 }));

      expect(callbacks.onStrokeStart).toHaveBeenCalledTimes(2);
      expect(callbacks.onStrokeCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe("mouse input (draw)", () => {
    it("should treat mouse as draw input", () => {
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "mouse" }));
      expect(callbacks.onStrokeStart).toHaveBeenCalledTimes(1);
    });
  });

  describe("touch input (pan)", () => {
    it("should call onPanStart on single touch", () => {
      el.dispatchEvent(
        createPointerEvent("pointerdown", { pointerType: "touch", pointerId: 10 })
      );
      expect(callbacks.onPanStart).toHaveBeenCalledTimes(1);
    });

    it("should call onPanMove on touch move", () => {
      el.dispatchEvent(
        createPointerEvent("pointerdown", { pointerType: "touch", pointerId: 10, clientX: 100, clientY: 100 })
      );
      el.dispatchEvent(
        createPointerEvent("pointermove", { pointerType: "touch", pointerId: 10, clientX: 150, clientY: 120 })
      );
      expect(callbacks.onPanMove).toHaveBeenCalledWith(50, 20);
    });

    it("should not trigger pan during active pen stroke (palm rejection)", () => {
      // Start pen stroke (via document capture)
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen", pointerId: 1 }));

      // Touch arrives during pen stroke — should be ignored
      el.dispatchEvent(
        createPointerEvent("pointerdown", { pointerType: "touch", pointerId: 10 })
      );

      expect(callbacks.onPanStart).not.toHaveBeenCalled();
    });
  });

  describe("context menu prevention", () => {
    it("should prevent context menu", () => {
      const event = new Event("contextmenu", { cancelable: true });
      el.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe("point extraction", () => {
    it("should extract screen coordinates relative to element", () => {
      el.dispatchEvent(
        createPointerEvent("pointerdown", {
          pointerType: "pen",
          clientX: 150,
          clientY: 250,
          pressure: 0.7,
        })
      );

      expect(callbacks.onStrokeStart).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 150,
          y: 250,
          pressure: 0.7,
        })
      );
    });
  });

  describe("wheel events", () => {
    it("should fire onWheel with correct screen coords and deltas", () => {
      const event = new WheelEvent("wheel", {
        clientX: 200,
        clientY: 300,
        deltaX: 10,
        deltaY: 20,
        cancelable: true,
        bubbles: true,
      });
      el.dispatchEvent(event);

      expect(callbacks.onWheel).toHaveBeenCalledWith(200, 300, 10, 20, false);
    });

    it("should set isPinch=true when ctrlKey is set", () => {
      const event = new WheelEvent("wheel", {
        clientX: 100,
        clientY: 100,
        deltaX: 0,
        deltaY: -5,
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      });
      el.dispatchEvent(event);

      expect(callbacks.onWheel).toHaveBeenCalledWith(100, 100, 0, -5, true);
    });

    it("should call preventDefault on wheel events", () => {
      const event = new WheelEvent("wheel", {
        cancelable: true,
        bubbles: true,
      });
      el.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it("should debounce onWheelEnd (fires once after 150ms idle)", () => {
      jest.useFakeTimers();

      // Fire several wheel events quickly
      for (let i = 0; i < 5; i++) {
        el.dispatchEvent(new WheelEvent("wheel", { cancelable: true, bubbles: true }));
      }

      expect(callbacks.onWheelEnd).not.toHaveBeenCalled();

      // Advance past the debounce window
      jest.advanceTimersByTime(150);

      expect(callbacks.onWheelEnd).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it("should normalize deltaMode LINE to pixels", () => {
      // deltaMode=1 means DOM_DELTA_LINE, should multiply by 16
      const event = new WheelEvent("wheel", {
        clientX: 50,
        clientY: 50,
        deltaX: 2,
        deltaY: 3,
        deltaMode: 1,
        cancelable: true,
        bubbles: true,
      });
      el.dispatchEvent(event);

      expect(callbacks.onWheel).toHaveBeenCalledWith(50, 50, 32, 48, false);
    });
  });

  describe("pinch gestures (rotation/scale/pan outlier rejection)", () => {
    function touchDown(id: number, x: number, y: number) {
      el.dispatchEvent(
        createPointerEvent("pointerdown", {
          pointerType: "touch",
          pointerId: id,
          clientX: x,
          clientY: y,
        }),
      );
    }
    function touchMove(id: number, x: number, y: number) {
      el.dispatchEvent(
        createPointerEvent("pointermove", {
          pointerType: "touch",
          pointerId: id,
          clientX: x,
          clientY: y,
        }),
      );
    }
    function touchUp(id: number, x: number, y: number) {
      el.dispatchEvent(
        createPointerEvent("pointerup", {
          pointerType: "touch",
          pointerId: id,
          clientX: x,
          clientY: y,
        }),
      );
    }
    function lastPinchCallArgs(): {
      centerX: number;
      centerY: number;
      scale: number;
      panDx: number;
      panDy: number;
      rotationDelta: number;
    } {
      const calls = (callbacks.onPinchMove as jest.Mock).mock.calls;
      const last = calls[calls.length - 1] as [number, number, number, number, number, number];
      return {
        centerX: last[0],
        centerY: last[1],
        scale: last[2],
        panDx: last[3],
        panDy: last[4],
        rotationDelta: last[5],
      };
    }

    it("rebases on activation crossing — first onPinchMove starts from current angle, not from touchdown", () => {
      // Two touches go down vertically (angle = π/2).
      touchDown(10, 100, 100);
      touchDown(11, 100, 200);

      // Small drift keeps us below the 8 px activation threshold. Distance
      // delta = 5 < 8, center delta = 2.5 < 8 — no activation, no callback.
      touchMove(11, 100, 205);
      expect(callbacks.onPinchMove).not.toHaveBeenCalled();
      expect(callbacks.onPinchRebase).not.toHaveBeenCalled();

      // Now jump touch 11 in a way that crosses activation AND swings the
      // angle ~45°. Without the activation rebase the first onPinchMove
      // would carry a cumulative ~45° rotationDelta. With the rebase the
      // first frame is suppressed and the baseline is anchored at "now".
      touchMove(11, 200, 200);
      expect(callbacks.onPinchMove).not.toHaveBeenCalled();
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(1);

      // Small follow-up move — first real onPinchMove. rotationDelta should
      // be tiny (~degrees), not ~45°.
      touchMove(11, 205, 200);
      expect(callbacks.onPinchMove).toHaveBeenCalledTimes(1);
      const args = lastPinchCallArgs();
      expect(Math.abs(args.rotationDelta)).toBeLessThan(0.1); // < ~5.7°
    });

    it("rebases when one of the original pinch touches lifts mid-gesture", () => {
      // Vertical pair A (10) at top, B (11) below.
      touchDown(10, 100, 100);
      touchDown(11, 100, 200);
      // Activate the pinch (crosses 8 px threshold) — this fires one rebase.
      touchMove(11, 100, 220);
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(1);

      // Third touch arrives horizontally from A — does not change pinch pair.
      touchDown(12, 200, 100);
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(1);

      // A lifts. Surviving pair is now (B id=11, C id=12) — totally different
      // angle than the original (A,B) baseline. Without the touch-set rebase
      // the next onPinchMove would carry a huge rotationDelta jump.
      touchUp(10, 100, 100);
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(2);

      // Small post-rebase nudge — rotationDelta should be tiny.
      const beforeMove = (callbacks.onPinchMove as jest.Mock).mock.calls.length;
      touchMove(12, 205, 100);
      expect((callbacks.onPinchMove as jest.Mock).mock.calls.length).toBeGreaterThan(beforeMove);
      const args = lastPinchCallArgs();
      expect(Math.abs(args.rotationDelta)).toBeLessThan(0.1);
    });

    it("rejects single-frame rotation outliers (>30°/frame) and rebases", () => {
      touchDown(10, 100, 100);
      touchDown(11, 200, 100);
      // Activate — this is one rebase.
      touchMove(11, 220, 100);
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(1);

      // Small legitimate move so we have a "last" frame baseline (and one
      // real onPinchMove call recorded).
      touchMove(11, 222, 102);
      const callsAfterNormal = (callbacks.onPinchMove as jest.Mock).mock.calls.length;
      expect(callsAfterNormal).toBeGreaterThanOrEqual(1);

      // Now teleport touch 11 to create a ~90° per-frame angle swing. This
      // is the palm-induced outlier we want to reject.
      touchMove(11, 100, 300);
      // onPinchMove should NOT have fired for the outlier frame.
      expect((callbacks.onPinchMove as jest.Mock).mock.calls.length).toBe(callsAfterNormal);
      // Rebase should have fired.
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(2);
    });

    it("rejects single-frame scale outliers (>1.5× ratio in one frame) and rebases", () => {
      touchDown(10, 100, 100);
      touchDown(11, 200, 100);
      touchMove(11, 220, 100); // activate
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(1);

      // Tiny normal move so lastScale is anchored at ~1.
      touchMove(11, 222, 100);
      const callsAfterNormal = (callbacks.onPinchMove as jest.Mock).mock.calls.length;

      // Distance jumps from ~122 px to ~400 px in a single frame — ratio > 3×.
      touchMove(11, 500, 100);
      expect((callbacks.onPinchMove as jest.Mock).mock.calls.length).toBe(callsAfterNormal);
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(2);
    });

    it("rejects single-frame pan outliers (>150 px/frame center jump) and rebases", () => {
      touchDown(10, 100, 100);
      touchDown(11, 200, 100);
      touchMove(11, 220, 100); // activate
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(1);

      // Tiny normal move so lastPinchCenter is anchored.
      touchMove(11, 222, 100);
      const callsAfterNormal = (callbacks.onPinchMove as jest.Mock).mock.calls.length;

      // Both touches translate together by ~250 px — pure pan, but a much
      // bigger frame jump than any plausible swipe. Center shifts by ~250 px.
      touchMove(10, 400, 100);
      touchMove(11, 522, 100);
      // Expect at least one of these moves to have been rejected (outlier).
      // The rebase counter must have bumped.
      expect((callbacks.onPinchRebase as jest.Mock).mock.calls.length).toBeGreaterThan(1);
    });

    it("does not rebase during a normal smooth pinch gesture", () => {
      touchDown(10, 100, 100);
      touchDown(11, 200, 100);
      // Activate — this is the only rebase that should fire.
      touchMove(11, 220, 100);
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(1);

      // Smooth zoom-in over many frames — each step is small.
      for (let i = 1; i <= 20; i++) {
        const x = 220 + i * 4; // small per-frame step
        touchMove(11, x, 100);
      }
      // No extra rebases.
      expect(callbacks.onPinchRebase).toHaveBeenCalledTimes(1);
      // Plenty of onPinchMove calls.
      expect((callbacks.onPinchMove as jest.Mock).mock.calls.length).toBeGreaterThan(15);
      // Final scale reflects cumulative zoom (distance 200 / initialDistance 120 ≈ 1.67).
      const args = lastPinchCallArgs();
      expect(args.scale).toBeGreaterThan(1.5);
      expect(args.scale).toBeLessThan(2);
    });
  });

  describe("cleanup", () => {
    it("should remove event listeners on destroy", () => {
      manager.destroy();

      // After destroy, pen events on document should not trigger callbacks
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen" }));
      expect(callbacks.onStrokeStart).not.toHaveBeenCalled();
    });

    it("should not fire onWheelEnd after destroy", () => {
      jest.useFakeTimers();

      el.dispatchEvent(new WheelEvent("wheel", { cancelable: true, bubbles: true }));
      manager.destroy();

      jest.advanceTimersByTime(200);
      expect(callbacks.onWheelEnd).not.toHaveBeenCalled();

      jest.useRealTimers();
    });
  });
});
