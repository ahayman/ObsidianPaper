import { TextFileView, WorkspaceLeaf, Platform } from "obsidian";
import type { PaperDocument, PenStyle, PenType, Stroke, StrokePoint } from "../types";
import { Camera } from "../canvas/Camera";
import { Renderer } from "../canvas/Renderer";
import { InputManager } from "../input/InputManager";
import type { InputCallbacks } from "../input/InputManager";
import { StrokeBuilder } from "../stroke/StrokeBuilder";
import { UndoManager } from "../document/UndoManager";
import { createEmptyDocument } from "../document/Document";
import { serializeDocument, deserializeDocument, precompressStroke } from "../document/Serializer";
import { getPenConfig } from "../stroke/PenConfigs";
import { findHitStrokes } from "../eraser/StrokeEraser";
import { ThemeDetector } from "../color/ThemeDetector";
import { ToolPalette } from "./ToolPalette";
import type { ActiveTool, ToolPaletteCallbacks } from "./ToolPalette";
import type { PaperSettings } from "../settings/PaperSettings";
import { DEFAULT_SETTINGS } from "../settings/PaperSettings";
import { HoverCursor } from "../input/HoverCursor";
import { SpatialIndex } from "../spatial/SpatialIndex";

export const VIEW_TYPE_PAPER = "paper-view";
export const PAPER_EXTENSION = "paper";

const DEFAULT_ERASER_RADIUS = 10;

export class PaperView extends TextFileView {
  private document: PaperDocument = createEmptyDocument();
  private camera: Camera = new Camera();
  private renderer: Renderer | null = null;
  private inputManager: InputManager | null = null;
  private strokeBuilder: StrokeBuilder | null = null;
  private undoManager = new UndoManager();
  private spatialIndex = new SpatialIndex();
  private resizeObserver: ResizeObserver | null = null;
  private themeDetector: ThemeDetector | null = null;
  private toolPalette: ToolPalette | null = null;
  private hoverCursor: HoverCursor | null = null;
  private pinchBaseZoom = 1;
  private settings: PaperSettings = DEFAULT_SETTINGS;
  private staticRafId: number | null = null;
  private precompressTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Active tool state
  private activeTool: ActiveTool = "pen";
  private currentPenType: PenType = "ballpoint";
  private currentColorId = "ink-black";
  private currentWidth = 2;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_PAPER;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "Paper";
  }

  getIcon(): string {
    return "pencil";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("paper-view-container");

    // Theme detection
    this.themeDetector = new ThemeDetector();
    this.themeDetector.onChange((isDark) => {
      if (this.renderer) {
        this.renderer.isDarkMode = isDark;
        this.renderer.invalidateCache();
        this.requestStaticRender();
      }
      this.toolPalette?.setDarkMode(isDark);
    });
    this.themeDetector.start();

    // Create multi-layer renderer
    this.renderer = new Renderer(container, this.camera, Platform.isMobile);
    this.renderer.isDarkMode = this.themeDetector.isDarkMode;
    this.renderer.setBackgroundConfig({
      paperType: this.document.canvas.paperType,
      lineSpacing: this.document.canvas.lineSpacing,
      gridSize: this.document.canvas.gridSize,
    });

    // Initial resize
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.renderer.resize(rect.width, rect.height);
    }

    // Setup input handling
    this.inputManager = new InputManager(container, this.createInputCallbacks());

    // Create tool palette
    this.toolPalette = new ToolPalette(
      container,
      this.createToolPaletteCallbacks(),
      {
        activeTool: this.activeTool,
        penType: this.currentPenType,
        colorId: this.currentColorId,
        width: this.currentWidth,
      }
    );
    this.toolPalette.setDarkMode(this.themeDetector.isDarkMode);

    // Hover cursor
    this.hoverCursor = new HoverCursor(container);

    // Watch for container resizes
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.handleResize(width, height);
        }
      }
    });
    this.resizeObserver.observe(container);
  }

  async onClose(): Promise<void> {
    this.cancelPrecompression();
    this.renderer?.flushFinalizations();
    if (this.staticRafId !== null) {
      cancelAnimationFrame(this.staticRafId);
      this.staticRafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeDetector?.stop();
    this.themeDetector = null;
    this.inputManager?.destroy();
    this.inputManager = null;
    this.toolPalette?.destroy();
    this.toolPalette = null;
    this.hoverCursor?.destroy();
    this.hoverCursor = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.strokeBuilder = null;
    this.undoManager.clear();
    this.spatialIndex.clear();
  }

  getViewData(): string {
    this.renderer?.flushFinalizations();
    this.document.meta.modified = Date.now();
    this.document.viewport = this.camera.getState();
    return serializeDocument(this.document);
  }

  setViewData(data: string, clear: boolean): void {
    // Flush pending stroke finalizations to the current document before replacing it
    this.renderer?.flushFinalizations();
    // Always deserialize the file data. The `clear` flag means this is a
    // fresh file load (vs an in-place update), so we reset undo history.
    this.document = deserializeDocument(data);

    // Restore viewport
    this.camera.setState({
      x: this.document.viewport.x,
      y: this.document.viewport.y,
      zoom: this.document.viewport.zoom,
    });

    if (clear) {
      this.undoManager.clear();
    }
    this.spatialIndex.buildFromStrokes(this.document.strokes);
    this.renderer?.setBackgroundConfig({
      paperType: this.document.canvas.paperType,
      lineSpacing: this.document.canvas.lineSpacing,
      gridSize: this.document.canvas.gridSize,
    });
    this.renderer?.invalidateCache();
    this.renderer?.renderStaticLayer(this.document, this.spatialIndex);
    this.precompressLoadedStrokes();
  }

  clear(): void {
    this.cancelPrecompression();
    this.renderer?.flushFinalizations();
    this.document = createEmptyDocument();
    this.camera = new Camera();
    this.undoManager.clear();
    this.spatialIndex.clear();
    this.renderer?.invalidateCache();
    this.renderer?.renderStaticLayer(this.document, this.spatialIndex);
  }

  setSettings(settings: PaperSettings): void {
    this.settings = settings;
    this.currentPenType = settings.defaultPenType;
    this.currentColorId = settings.defaultColorId;
    this.currentWidth = settings.defaultWidth;
    this.toolPalette?.setPenType(settings.defaultPenType);
    this.toolPalette?.setWidth(settings.defaultWidth);
  }

  onResize(): void {
    const rect = this.contentEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.handleResize(rect.width, rect.height);
    }
  }

  undo(): void {
    this.renderer?.flushFinalizations();
    const action = this.undoManager.undo();
    if (!action) return;

    switch (action.type) {
      case "add-stroke": {
        const idx = this.document.strokes.findIndex(
          (s) => s.id === action.stroke.id
        );
        if (idx !== -1) {
          this.document.strokes.splice(idx, 1);
          this.spatialIndex.remove(action.stroke.id);
          this.renderer?.invalidateCache(action.stroke.id);
        }
        break;
      }
      case "remove-stroke": {
        const insertIdx = Math.min(
          action.index,
          this.document.strokes.length
        );
        this.document.strokes.splice(insertIdx, 0, action.stroke);
        this.spatialIndex.insert(action.stroke, insertIdx);
        break;
      }
      case "remove-strokes": {
        const sorted = [...action.strokes].sort((a, b) => a.index - b.index);
        for (const entry of sorted) {
          const insertIdx = Math.min(
            entry.index,
            this.document.strokes.length
          );
          this.document.strokes.splice(insertIdx, 0, entry.stroke);
          this.spatialIndex.insert(entry.stroke, insertIdx);
        }
        break;
      }
    }

    this.renderer?.renderStaticLayer(this.document, this.spatialIndex);
    this.requestSave();
  }

  redo(): void {
    this.renderer?.flushFinalizations();
    const action = this.undoManager.redo();
    if (!action) return;

    switch (action.type) {
      case "add-stroke": {
        this.document.strokes.push(action.stroke);
        this.spatialIndex.insert(action.stroke, this.document.strokes.length - 1);
        break;
      }
      case "remove-stroke": {
        const idx = this.document.strokes.findIndex(
          (s) => s.id === action.stroke.id
        );
        if (idx !== -1) {
          this.document.strokes.splice(idx, 1);
          this.spatialIndex.remove(action.stroke.id);
          this.renderer?.invalidateCache(action.stroke.id);
        }
        break;
      }
      case "remove-strokes": {
        for (const entry of action.strokes) {
          const idx = this.document.strokes.findIndex(
            (s) => s.id === entry.stroke.id
          );
          if (idx !== -1) {
            this.document.strokes.splice(idx, 1);
            this.spatialIndex.remove(entry.stroke.id);
            this.renderer?.invalidateCache(entry.stroke.id);
          }
        }
        break;
      }
    }

    this.renderer?.renderStaticLayer(this.document, this.spatialIndex);
    this.requestSave();
  }

  /**
   * Coalesce multiple static layer render requests into a single RAF frame.
   * Prevents 30-60 full redraws per second during pinch/pan gestures.
   */
  private requestStaticRender(): void {
    if (this.staticRafId !== null) return;
    this.staticRafId = requestAnimationFrame(() => {
      this.staticRafId = null;
      this.renderer?.renderStaticLayer(this.document, this.spatialIndex);
    });
  }

  private handleResize(width: number, height: number): void {
    this.renderer?.resize(width, height);
    this.renderer?.renderStaticLayer(this.document, this.spatialIndex);
  }

  /**
   * Pre-compress all loaded strokes in background batches.
   * Yields to the event loop between batches so drawing is never blocked.
   */
  private precompressLoadedStrokes(): void {
    this.cancelPrecompression();
    const strokes = this.document.strokes;
    let i = 0;
    const BATCH_SIZE = 10;
    const processBatch = () => {
      const end = Math.min(i + BATCH_SIZE, strokes.length);
      for (; i < end; i++) {
        precompressStroke(strokes[i]);
      }
      if (i < strokes.length) {
        this.precompressTimeoutId = setTimeout(processBatch, 0);
      } else {
        this.precompressTimeoutId = null;
      }
    };
    this.precompressTimeoutId = setTimeout(processBatch, 200);
  }

  private cancelPrecompression(): void {
    if (this.precompressTimeoutId !== null) {
      clearTimeout(this.precompressTimeoutId);
      this.precompressTimeoutId = null;
    }
  }

  private getCurrentStyle(): PenStyle {
    const penConfig = getPenConfig(this.currentPenType);
    return {
      pen: this.currentPenType,
      color: this.currentColorId,
      width: this.currentWidth,
      opacity: penConfig.baseOpacity,
      smoothing: penConfig.smoothing,
      pressureCurve: penConfig.pressureCurve,
      tiltSensitivity: penConfig.tiltSensitivity,
    };
  }

  private getCurrentStyleName(): string {
    // Check if the current settings match a named style in the document
    // If not, use "_default" and apply overrides
    return "_default";
  }

  private createToolPaletteCallbacks(): ToolPaletteCallbacks {
    return {
      onToolChange: (tool: ActiveTool) => {
        this.activeTool = tool;
      },
      onPenTypeChange: (penType: PenType) => {
        this.currentPenType = penType;
        // Update width to pen type default
        const config = getPenConfig(penType);
        this.currentWidth = config.baseWidth;
        this.toolPalette?.setWidth(config.baseWidth);
      },
      onColorChange: (colorId: string) => {
        this.currentColorId = colorId;
      },
      onWidthChange: (width: number) => {
        this.currentWidth = width;
      },
    };
  }

  private createInputCallbacks(): InputCallbacks {
    return {
      onStrokeStart: (point: StrokePoint) => {
        this.hoverCursor?.hide();
        if (this.activeTool === "eraser") return;

        const world = this.camera.screenToWorld(point.x, point.y);
        const style = this.getCurrentStyle();
        this.strokeBuilder = new StrokeBuilder(
          this.getCurrentStyleName(),
          { smoothing: style.smoothing },
        );
        this.strokeBuilder.addPoint({ ...point, x: world.x, y: world.y });
      },

      onStrokeMove: (points: StrokePoint[], predicted: StrokePoint[]) => {
        if (this.activeTool === "eraser") {
          for (const point of points) {
            this.handleEraserPoint(point);
          }
          return;
        }

        if (!this.strokeBuilder) return;
        const style = this.getCurrentStyle();

        for (const point of points) {
          const world = this.camera.screenToWorld(point.x, point.y);
          this.strokeBuilder.addPoint({ ...point, x: world.x, y: world.y });
        }

        this.renderer?.renderActiveStroke(
          this.strokeBuilder.getPoints(),
          style
        );

        // Render prediction
        if (predicted.length > 0) {
          const predictedWorld = predicted.map((p) => {
            const w = this.camera.screenToWorld(p.x, p.y);
            return { ...p, x: w.x, y: w.y };
          });
          this.renderer?.renderPrediction(
            this.strokeBuilder.getPoints(),
            predictedWorld,
            style
          );
        }
      },

      onStrokeEnd: (point: StrokePoint) => {
        if (!this.strokeBuilder) return;

        const world = this.camera.screenToWorld(point.x, point.y);
        this.strokeBuilder.addPoint({ ...point, x: world.x, y: world.y });

        if (this.strokeBuilder.pointCount >= 2) {
          // Capture references for the deferred finalization closure
          const builder = this.strokeBuilder;
          const style = this.getCurrentStyle();
          const styleName = this.getCurrentStyleName();
          const docStyles = this.document.styles;

          // Ensure the stroke's style exists in the document
          if (!docStyles[styleName]) {
            docStyles[styleName] = style;
          }

          // Defer ALL heavy work to the next RAF frame.
          // This keeps the event loop free for the next pointerdown.
          this.renderer?.scheduleFinalization(() => {
            const stroke = builder.finalize();

            // Push to document
            this.document.strokes.push(stroke);
            this.spatialIndex.insert(stroke, this.document.strokes.length - 1);
            this.undoManager.pushAddStroke(stroke);

            // Bake to static canvas (also deferred to same RAF)
            this.renderer?.bakeStroke(stroke, this.document.styles);

            // Pre-compress for fast saves
            precompressStroke(stroke);

            // Clear active layer now that stroke is baked to static
            this.renderer?.clearActiveLayer();

            this.requestSave();
          });
        } else {
          this.renderer?.clearActiveLayer();
        }

        // Clear prediction layer immediately, leave active layer visible
        // until the deferred bake paints the stroke to static
        this.renderer?.clearPredictionLayer();
        this.strokeBuilder = null;
      },

      onStrokeCancel: () => {
        this.strokeBuilder?.discard();
        this.strokeBuilder = null;
        this.renderer?.clearActiveLayer();
      },

      onPanStart: () => {},

      onPanMove: (dx: number, dy: number) => {
        this.camera.pan(dx, dy);
        this.requestStaticRender();
      },

      onPanEnd: () => {
        this.requestSave();
      },

      onPinchMove: (centerX: number, centerY: number, scale: number) => {
        if (this.pinchBaseZoom === 1) {
          this.pinchBaseZoom = this.camera.zoom;
        }
        const newZoom = this.pinchBaseZoom * scale;
        this.camera.zoomAt(centerX, centerY, newZoom);
        this.requestStaticRender();
      },

      onPinchEnd: () => {
        this.pinchBaseZoom = 1;
        this.requestSave();
      },

      onTwoFingerTap: () => {
        this.undo();
      },

      onThreeFingerTap: () => {
        this.redo();
      },

      onHover: (x: number, y: number) => {
        this.hoverCursor?.show(x, y, {
          colorId: this.currentColorId,
          width: this.currentWidth,
          isDarkMode: this.themeDetector?.isDarkMode ?? false,
          isEraser: this.activeTool === "eraser",
          zoom: this.camera.zoom,
        });
      },

      onHoverEnd: () => {
        this.hoverCursor?.hide();
      },
    };
  }

  private handleEraserPoint(point: StrokePoint): void {
    const world = this.camera.screenToWorld(point.x, point.y);
    const radius = DEFAULT_ERASER_RADIUS / this.camera.zoom;

    const hitIndices = findHitStrokes(
      world.x,
      world.y,
      radius,
      this.document.strokes,
      this.spatialIndex
    );

    if (hitIndices.length === 0) return;

    // Remove strokes in reverse order to preserve indices
    const removedEntries: { stroke: Stroke; index: number }[] = [];
    const sortedDesc = [...hitIndices].sort((a, b) => b - a);

    for (const idx of sortedDesc) {
      const removed = this.document.strokes.splice(idx, 1)[0];
      this.spatialIndex.remove(removed.id);
      this.renderer?.invalidateCache(removed.id);
      removedEntries.push({ stroke: removed, index: idx });
    }

    if (removedEntries.length === 1) {
      this.undoManager.pushRemoveStroke(
        removedEntries[0].stroke,
        removedEntries[0].index
      );
    } else {
      this.undoManager.pushRemoveStrokes(removedEntries);
    }

    this.requestStaticRender();
    this.requestSave();
  }
}
