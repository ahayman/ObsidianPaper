import { Camera, MIN_ZOOM, MAX_ZOOM } from "./Camera";

describe("Camera", () => {
  describe("constructor", () => {
    it("should initialize with default values", () => {
      const cam = new Camera();
      expect(cam.x).toBe(0);
      expect(cam.y).toBe(0);
      expect(cam.zoom).toBe(1);
    });

    it("should accept partial state", () => {
      const cam = new Camera({ x: 10, zoom: 2 });
      expect(cam.x).toBe(10);
      expect(cam.y).toBe(0);
      expect(cam.zoom).toBe(2);
    });

    it("should clamp zoom on construction", () => {
      const cam = new Camera({ zoom: 100 });
      expect(cam.zoom).toBe(MAX_ZOOM);

      const cam2 = new Camera({ zoom: 0.01 });
      expect(cam2.zoom).toBe(MIN_ZOOM);
    });
  });

  describe("screenToWorld / worldToScreen round-trip", () => {
    it("should round-trip at default zoom", () => {
      const cam = new Camera();
      const world = cam.screenToWorld(150, 200);
      const screen = cam.worldToScreen(world.x, world.y);
      expect(screen.x).toBeCloseTo(150);
      expect(screen.y).toBeCloseTo(200);
    });

    it("should round-trip at 2x zoom", () => {
      const cam = new Camera({ zoom: 2 });
      const world = cam.screenToWorld(150, 200);
      const screen = cam.worldToScreen(world.x, world.y);
      expect(screen.x).toBeCloseTo(150);
      expect(screen.y).toBeCloseTo(200);
    });

    it("should round-trip with pan offset", () => {
      const cam = new Camera({ x: 50, y: 100, zoom: 1.5 });
      const world = cam.screenToWorld(300, 400);
      const screen = cam.worldToScreen(world.x, world.y);
      expect(screen.x).toBeCloseTo(300);
      expect(screen.y).toBeCloseTo(400);
    });

    it("should correctly transform at zoom with offset", () => {
      const cam = new Camera({ x: 0, y: 0, zoom: 2 });
      // At 2x zoom, screen pixel 100 = world pixel 50
      const world = cam.screenToWorld(100, 100);
      expect(world.x).toBeCloseTo(50);
      expect(world.y).toBeCloseTo(50);
    });
  });

  describe("pan", () => {
    it("should move camera position", () => {
      const cam = new Camera();
      cam.pan(100, 50);
      expect(cam.x).toBe(-100);
      expect(cam.y).toBe(-50);
    });

    it("should account for zoom when panning", () => {
      const cam = new Camera({ zoom: 2 });
      cam.pan(100, 100);
      // At 2x zoom, 100 screen pixels = 50 world units
      expect(cam.x).toBe(-50);
      expect(cam.y).toBe(-50);
    });
  });

  describe("zoomAt", () => {
    it("should keep the world point under the screen position stationary", () => {
      const cam = new Camera({ x: 0, y: 0, zoom: 1 });
      const screenX = 200;
      const screenY = 300;

      // Get world point before zoom
      const worldBefore = cam.screenToWorld(screenX, screenY);

      cam.zoomAt(screenX, screenY, 2.0);

      // Get world point after zoom — should be the same
      const worldAfter = cam.screenToWorld(screenX, screenY);

      expect(worldAfter.x).toBeCloseTo(worldBefore.x);
      expect(worldAfter.y).toBeCloseTo(worldBefore.y);
    });

    it("should clamp zoom to limits", () => {
      const cam = new Camera();
      cam.zoomAt(100, 100, 0.001);
      expect(cam.zoom).toBe(MIN_ZOOM);

      cam.zoomAt(100, 100, 100);
      expect(cam.zoom).toBe(MAX_ZOOM);
    });
  });

  describe("getVisibleRect", () => {
    it("should return correct rect at default state", () => {
      const cam = new Camera();
      const rect = cam.getVisibleRect(800, 600);
      expect(rect).toEqual([0, 0, 800, 600]);
    });

    it("should return correct rect with pan offset", () => {
      const cam = new Camera({ x: 100, y: 200, zoom: 1 });
      const rect = cam.getVisibleRect(800, 600);
      expect(rect).toEqual([100, 200, 900, 800]);
    });

    it("should return correct rect at 2x zoom", () => {
      const cam = new Camera({ x: 0, y: 0, zoom: 2 });
      const rect = cam.getVisibleRect(800, 600);
      // At 2x zoom, visible area is half the screen size in world units
      expect(rect[0]).toBe(0);
      expect(rect[1]).toBe(0);
      expect(rect[2]).toBe(400);
      expect(rect[3]).toBe(300);
    });
  });

  describe("isVisible", () => {
    it("should detect overlapping bboxes", () => {
      const cam = new Camera();
      expect(cam.isVisible([50, 50, 150, 150], 800, 600)).toBe(true);
    });

    it("should reject non-overlapping bboxes", () => {
      const cam = new Camera();
      expect(cam.isVisible([900, 900, 1000, 1000], 800, 600)).toBe(false);
    });

    it("should detect partially overlapping bboxes", () => {
      const cam = new Camera();
      expect(cam.isVisible([750, 550, 850, 650], 800, 600)).toBe(true);
    });
  });

  describe("applyToContext / resetContext", () => {
    function createMockCtx() {
      return {
        save: jest.fn(),
        restore: jest.fn(),
        transform: jest.fn(),
      } as unknown as CanvasRenderingContext2D;
    }

    it("should call save and transform (not setTransform)", () => {
      const cam = new Camera({ x: 10, y: 20, zoom: 2 });
      const ctx = createMockCtx();
      cam.applyToContext(ctx);

      expect(ctx.save).toHaveBeenCalledTimes(1);
      expect(ctx.transform).toHaveBeenCalledWith(2, 0, 0, 2, -20, -40);
    });

    it("should call restore on resetContext", () => {
      const cam = new Camera();
      const ctx = createMockCtx();
      cam.resetContext(ctx);

      expect(ctx.restore).toHaveBeenCalledTimes(1);
    });

    it("should use transform (compose) not setTransform (replace)", () => {
      const cam = new Camera({ x: 0, y: 0, zoom: 1 });
      const ctx = createMockCtx();
      const setTransform = jest.fn();
      (ctx as unknown as Record<string, unknown>).setTransform = setTransform;

      cam.applyToContext(ctx);

      // Should use transform (compose) and NOT setTransform (replace)
      expect(ctx.transform).toHaveBeenCalledTimes(1);
      expect(setTransform).not.toHaveBeenCalled();
    });
  });

  describe("getOverscanVisibleRect", () => {
    it("returns wider rect than viewport for 2x overscan", () => {
      const cam = new Camera({ x: 0, y: 0, zoom: 1 });
      // Viewport: 800x600, overscan: 1600x1200, offset: -400, -300
      const rect = cam.getOverscanVisibleRect(1600, 1200, -400, -300);
      // screenToWorld(-400, -300) = { x: -400, y: -300 }
      // screenToWorld(-400+1600, -300+1200) = { x: 1200, y: 900 }
      expect(rect).toEqual([-400, -300, 1200, 900]);
    });

    it("accounts for camera pan", () => {
      const cam = new Camera({ x: 100, y: 200, zoom: 1 });
      const rect = cam.getOverscanVisibleRect(1600, 1200, -400, -300);
      // screenToWorld(-400, -300) = { x: -400 + 100, y: -300 + 200 } = { x: -300, y: -100 }
      // screenToWorld(1200, 900) = { x: 1200 + 100, y: 900 + 200 } = { x: 1300, y: 1100 }
      expect(rect).toEqual([-300, -100, 1300, 1100]);
    });

    it("accounts for zoom", () => {
      const cam = new Camera({ x: 0, y: 0, zoom: 2 });
      // At 2x zoom, screenToWorld divides by zoom
      const rect = cam.getOverscanVisibleRect(1600, 1200, -400, -300);
      // screenToWorld(-400, -300) = { x: -200, y: -150 }
      // screenToWorld(1200, 900) = { x: 600, y: 450 }
      expect(rect).toEqual([-200, -150, 600, 450]);
    });

    it("with zero offset matches getVisibleRect", () => {
      const cam = new Camera({ x: 50, y: 75, zoom: 1.5 });
      const viewportRect = cam.getVisibleRect(800, 600);
      const overscanRect = cam.getOverscanVisibleRect(800, 600, 0, 0);
      expect(overscanRect).toEqual(viewportRect);
    });
  });

  describe("getState / setState", () => {
    it("should round-trip state", () => {
      const cam = new Camera({ x: 10, y: 20, zoom: 1.5 });
      const state = cam.getState();

      const cam2 = new Camera();
      cam2.setState(state);

      expect(cam2.x).toBe(10);
      expect(cam2.y).toBe(20);
      expect(cam2.zoom).toBe(1.5);
    });
  });
});
