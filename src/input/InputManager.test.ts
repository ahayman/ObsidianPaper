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
    onTwoFingerTap: jest.fn(),
    onThreeFingerTap: jest.fn(),
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

  describe("cleanup", () => {
    it("should remove event listeners on destroy", () => {
      manager.destroy();

      // After destroy, pen events on document should not trigger callbacks
      el.dispatchEvent(createPointerEvent("pointerdown", { pointerType: "pen" }));
      expect(callbacks.onStrokeStart).not.toHaveBeenCalled();
    });
  });
});
