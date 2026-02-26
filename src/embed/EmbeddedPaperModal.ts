import { Modal, Platform } from "obsidian";
import type { App, TFile } from "obsidian";
import type { PaperDocument, PenStyle, PenType, Stroke, StrokePoint, Page, PageSize, PageDefaults, PaperType, PageOrientation, PageBackgroundColor, PageBackgroundTheme, PageMargins, RenderPipeline } from "../types";
import { PAGE_SIZE_PRESETS, PPI, CM_PER_INCH } from "../types";
import { Camera } from "../canvas/Camera";
import { Renderer } from "../canvas/Renderer";
import { InputManager } from "../input/InputManager";
import type { InputCallbacks } from "../input/InputManager";
import { StrokeBuilder } from "../stroke/StrokeBuilder";
import { UndoManager } from "../document/UndoManager";
import { createEmptyDocument, generatePageId } from "../document/Document";
import { serializeDocument, deserializeDocument, precompressStroke } from "../document/Serializer";
import { getPenConfig } from "../stroke/PenConfigs";
import { findHitStrokes } from "../eraser/StrokeEraser";
import { ThemeDetector } from "../color/ThemeDetector";
import { Toolbar } from "../view/toolbar/Toolbar";
import type { ActiveTool, ToolbarCallbacks, ToolbarQueries, ToolbarState } from "../view/toolbar/ToolbarTypes";
import type { PaperSettings } from "../settings/PaperSettings";
import { DEFAULT_SETTINGS, resolvePageSize, resolveMargins } from "../settings/PaperSettings";
import type { DeviceSettings } from "../settings/DeviceSettings";
import { DEFAULT_DEVICE_SETTINGS } from "../settings/DeviceSettings";
import { HoverCursor } from "../input/HoverCursor";
import { SpatialIndex } from "../spatial/SpatialIndex";
import { computePageLayout, findPageAtPoint, getDocumentBounds, getEffectiveSize } from "../document/PageLayout";
import type { PageRect } from "../document/PageLayout";
import { PageMenuButton } from "../view/PageMenuButton";
import { PageMenuPopover } from "../view/PageMenuPopover";
import { DocumentSettingsPopover } from "../view/toolbar/DocumentSettingsPopover";
import { decodePoints, encodePoints } from "../document/PointEncoder";
import { resolvePageBackground } from "../color/ColorUtils";
import { DEFAULT_GRAIN_VALUE } from "../stamp/GrainMapping";

const DEFAULT_ERASER_RADIUS = 10;

/**
 * Fullscreen modal for editing a .paper file.
 * Replicates PaperView's drawing infrastructure inside an Obsidian Modal.
 */
export class EmbeddedPaperModal extends Modal {
  private file: TFile;
  private settings: PaperSettings;
  private deviceSettings: DeviceSettings;
  private onDismiss: () => void;
  private onSettingsChange: ((changes: Partial<PaperSettings>) => void) | null = null;
  private onDeviceSettingsChanged: ((changes: Partial<DeviceSettings>) => void) | null = null;

  private document: PaperDocument = createEmptyDocument();
  private camera: Camera = new Camera();
  private renderer: Renderer | null = null;
  private inputManager: InputManager | null = null;
  private strokeBuilder: StrokeBuilder | null = null;
  private undoManager = new UndoManager();
  private spatialIndex = new SpatialIndex();
  private resizeObserver: ResizeObserver | null = null;
  private themeDetector: ThemeDetector | null = null;
  private toolbar: Toolbar | null = null;
  private hoverCursor: HoverCursor | null = null;
  private pageMenuButton: PageMenuButton | null = null;
  private activePopover: { destroy: () => void } | null = null;
  private docSettingsPopover: DocumentSettingsPopover | null = null;
  private pinchBaseZoom: number | null = null;
  private gestureBaseCamera: { x: number; y: number; zoom: number } | null = null;
  private midGestureRenderPending = false;
  private lastMidGestureRenderTime = 0;
  private static readonly MID_GESTURE_THROTTLE_MS = 250;
  private staticRafId: number | null = null;
  private saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private precompressTimeoutId: ReturnType<typeof setTimeout> | null = null;

  private cssWidth = 0;
  private cssHeight = 0;
  private pageLayout: PageRect[] = [];
  private activeStrokePageIndex = -1;

  private activeTool: ActiveTool = "pen";
  private currentPenType: PenType = "ballpoint";
  private currentColorId = "#1a1a1a|#e8e8e8";
  private currentWidth = 2;
  private currentSmoothing = 0.5;
  private currentNibAngle = Math.PI / 6;
  private currentNibThickness = 0.25;
  private currentNibPressure = 0.5;
  private currentGrain = DEFAULT_GRAIN_VALUE;
  private currentInkPreset = "standard";
  private currentUseBarrelRotation = false;

  constructor(
    app: App,
    file: TFile,
    settings: PaperSettings,
    deviceSettings: DeviceSettings,
    onDismiss: () => void,
    onSettingsChange?: (changes: Partial<PaperSettings>) => void,
    onDeviceSettingsChanged?: (changes: Partial<DeviceSettings>) => void,
  ) {
    super(app);
    this.file = file;
    this.settings = settings;
    this.deviceSettings = deviceSettings;
    this.onDismiss = onDismiss;
    this.onSettingsChange = onSettingsChange ?? null;
    this.onDeviceSettingsChanged = onDeviceSettingsChanged ?? null;
    this.applySettings(settings);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("paper-fullscreen-modal");
    this.contentEl.empty();

    const container = this.contentEl.createDiv({ cls: "paper-view-container" });

    // Theme detection
    this.themeDetector = new ThemeDetector();
    this.themeDetector.onChange((isDark) => {
      if (this.renderer) {
        this.renderer.isDarkMode = isDark;
        this.renderer.invalidateCache();
        this.requestStaticRender();
      }
      this.toolbar?.setDarkMode(isDark);
    });
    this.themeDetector.start();

    // Create multi-layer renderer
    this.renderer = new Renderer(container, this.camera, Platform.isMobile, this.deviceSettings.defaultRenderEngine);
    this.renderer.isDarkMode = this.themeDetector.isDarkMode;
    this.renderer.initGrain();
    this.renderer.initStamps();
    this.renderer.initInkStamps();
    this.renderer.setGrainStrength("pencil", this.settings.pencilGrainStrength);
    this.renderer.enableTiling();

    // Initial resize
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.cssWidth = rect.width;
      this.cssHeight = rect.height;
      this.renderer.resize(rect.width, rect.height);
    }

    // Input handling
    this.inputManager = new InputManager(container, this.createInputCallbacks());

    // Toolbar
    this.toolbar = new Toolbar(
      container,
      this.createToolbarCallbacks(),
      this.createToolbarQueries(),
      {
        activeTool: this.activeTool,
        activePresetId: this.settings.activePresetId,
        penType: this.currentPenType,
        colorId: this.currentColorId,
        width: this.currentWidth,
        smoothing: this.currentSmoothing,
        nibAngle: this.currentNibAngle,
        nibThickness: this.currentNibThickness,
        nibPressure: this.currentNibPressure,
        useBarrelRotation: this.currentUseBarrelRotation,
        grain: this.currentGrain,
        inkPreset: this.currentInkPreset,
      },
      this.settings.penPresets,
      this.deviceSettings.toolbarPosition,
      this.themeDetector.isDarkMode,
    );

    // Page menu button
    this.pageMenuButton = new PageMenuButton(container, this.camera, {
      onPageMenuTap: (pageIndex, anchorEl) => {
        this.openPageMenu(pageIndex, anchorEl);
      },
    });

    // Hover cursor
    this.hoverCursor = new HoverCursor(container);

    // Resize observer
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          this.handleResize(width, height);
        }
      }
    });
    this.resizeObserver.observe(container);

    // Load file data
    const data = await this.app.vault.read(this.file);
    this.loadDocument(data);
  }

  async onClose(): Promise<void> {
    // Flush and save
    this.cancelPrecompression();
    this.renderer?.flushFinalizations();
    await this.saveNow();

    if (this.staticRafId !== null) {
      cancelAnimationFrame(this.staticRafId);
      this.staticRafId = null;
    }
    if (this.saveTimeoutId !== null) {
      clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.themeDetector?.stop();
    this.themeDetector = null;
    this.inputManager?.destroy();
    this.inputManager = null;
    this.toolbar?.destroy();
    this.toolbar = null;
    this.activePopover?.destroy();
    this.activePopover = null;
    this.docSettingsPopover?.destroy();
    this.docSettingsPopover = null;
    this.pageMenuButton?.destroy();
    this.pageMenuButton = null;
    this.hoverCursor?.destroy();
    this.hoverCursor = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.strokeBuilder = null;
    this.undoManager.clear();
    this.spatialIndex.clear();

    this.onDismiss();
  }

  // ─── Document Lifecycle ─────────────────────────────────────

  private loadDocument(data: string): void {
    this.document = deserializeDocument(data);
    this.spatialIndex.buildFromStrokes(this.document.strokes);
    this.recomputeLayout();

    const vp = this.document.viewport;
    const isDefaultViewport = vp.x === 0 && vp.y === 0 && vp.zoom === 1.0;

    if (isDefaultViewport && this.pageLayout.length > 0) {
      this.centerOnFirstPage();
    } else {
      this.camera.setState({ x: vp.x, y: vp.y, zoom: vp.zoom });
    }

    this.renderer?.setPipeline(this.getResolvedPipeline());
    this.renderer?.invalidateCache();
    this.renderStaticWithIcons();
    this.precompressLoadedStrokes();
  }

  private async saveNow(): Promise<void> {
    this.renderer?.flushFinalizations();
    this.document.meta.modified = Date.now();
    this.document.viewport = this.camera.getState();
    const content = serializeDocument(this.document);
    await this.app.vault.modify(this.file, content);
  }

  private requestSave(): void {
    if (this.saveTimeoutId !== null) clearTimeout(this.saveTimeoutId);
    this.saveTimeoutId = setTimeout(() => {
      this.saveTimeoutId = null;
      void this.saveNow();
    }, 500);
  }

  // ─── Settings ──────────────────────────────────────────────

  private applySettings(settings: PaperSettings): void {
    if (settings.activePresetId) {
      const preset = settings.penPresets.find((p) => p.id === settings.activePresetId);
      if (preset) {
        this.currentPenType = preset.penType;
        this.currentColorId = preset.colorId;
        this.currentWidth = preset.width;
        this.currentSmoothing = preset.smoothing;
        this.currentGrain = preset.grain ?? DEFAULT_GRAIN_VALUE;
        this.currentInkPreset = preset.inkPreset ?? "standard";
        this.currentUseBarrelRotation = preset.useBarrelRotation ?? false;
        if (preset.nibAngle !== undefined) this.currentNibAngle = preset.nibAngle;
        if (preset.nibThickness !== undefined) this.currentNibThickness = preset.nibThickness;
        if (preset.nibPressure !== undefined) this.currentNibPressure = preset.nibPressure;
      }
    } else {
      this.currentPenType = settings.defaultPenType;
      this.currentColorId = settings.defaultColorId;
      this.currentWidth = settings.defaultWidth;
      this.currentSmoothing = settings.defaultSmoothing;
      this.currentNibAngle = settings.defaultNibAngle;
      this.currentNibThickness = settings.defaultNibThickness;
      this.currentNibPressure = settings.defaultNibPressure;
    }
  }

  // ─── Rendering Pipeline ──────────────────────────────────────

  private getResolvedPipeline(): RenderPipeline {
    return this.document.renderPipeline ?? this.deviceSettings.defaultRenderPipeline;
  }

  updateRenderPipeline(pipeline: RenderPipeline): void {
    this.document.renderPipeline = pipeline;
    this.renderer?.setPipeline(pipeline);
    this.renderer?.invalidateCache();
    this.requestStaticRender();
    this.requestSave();
  }

  // ─── Document Settings ──────────────────────────────────────

  private openDocumentSettings(): void {
    this.docSettingsPopover?.destroy();
    this.docSettingsPopover = new DocumentSettingsPopover(
      {
        renderPipeline: this.getResolvedPipeline(),
        pageDefaults: this.document.pageDefaults ?? {},
        globalSettings: this.settings,
        spacingUnit: this.settings.spacingUnit,
        isDarkMode: this.themeDetector?.isDarkMode ?? false,
      },
      this.toolbar!.getDocSettingsAnchor(),
      {
        onRenderPipelineChange: (pipeline) => this.updateRenderPipeline(pipeline),
        onPageDefaultsChange: (defaults) => this.updatePageDefaults(defaults),
        onDismiss: () => {
          this.docSettingsPopover?.destroy();
          this.docSettingsPopover = null;
        },
      },
    );
  }

  private updatePageDefaults(defaults: PageDefaults): void {
    const hasAny = Object.values(defaults).some(v => v !== undefined);
    this.document.pageDefaults = hasAny ? defaults : undefined;
    this.requestSave();
  }

  // ─── Page Management ─────────────────────────────────────────

  private addPage(size?: PageSize, orientation?: Page["orientation"], paperType?: Page["paperType"]): void {
    const pd = this.document.pageDefaults;
    const page: Page = {
      id: generatePageId(),
      size: size ?? this.resolveNewPageSize(pd),
      orientation: orientation ?? pd?.orientation ?? this.settings.defaultOrientation,
      paperType: paperType ?? pd?.paperType ?? this.settings.defaultPaperType,
      lineSpacing: pd?.lineSpacing ?? this.settings.lineSpacing,
      gridSize: pd?.gridSize ?? this.settings.gridSize,
      margins: {
        top: pd?.margins?.top ?? this.settings.marginTop,
        bottom: pd?.margins?.bottom ?? this.settings.marginBottom,
        left: pd?.margins?.left ?? this.settings.marginLeft,
        right: pd?.margins?.right ?? this.settings.marginRight,
      },
    };
    if (pd?.backgroundColor) {
      page.backgroundColor = pd.backgroundColor;
      page.backgroundColorTheme = pd.backgroundColorTheme;
    }
    this.document.pages.push(page);
    this.recomputeLayout();
    this.requestStaticRender();
    this.requestSave();
  }

  private resolveNewPageSize(pd?: PageDefaults): PageSize {
    if (pd?.pageSize) {
      if (pd.pageSize === "custom") {
        const unit = pd.customPageUnit ?? this.settings.customPageUnit;
        const w = pd.customPageWidth ?? this.settings.customPageWidth;
        const h = pd.customPageHeight ?? this.settings.customPageHeight;
        const factor = unit === "in" ? PPI : PPI / CM_PER_INCH;
        return { width: Math.round(w * factor), height: Math.round(h * factor) };
      }
      return PAGE_SIZE_PRESETS[pd.pageSize];
    }
    return resolvePageSize(this.settings);
  }

  private openPageMenu(pageIndex: number, anchorEl: HTMLElement): void {
    this.activePopover?.destroy();
    this.activePopover = null;

    const page = this.document.pages[pageIndex];
    if (!page) return;

    const hasStrokes = this.document.strokes.some(s => s.pageIndex === pageIndex);

    this.activePopover = new PageMenuPopover(
      {
        page,
        pageIndex,
        totalPages: this.document.pages.length,
        hasStrokes,
        isDarkMode: this.themeDetector?.isDarkMode ?? false,
        spacingUnit: this.settings.spacingUnit,
      },
      anchorEl,
      {
        onDeletePage: (idx) => this.deletePage(idx),
        onUpdateStyle: (idx, changes) => this.updatePageStyle(idx, changes),
        onUpdateBackground: (idx, bg, bgt) => this.updatePageBackground(idx, bg, bgt),
        onUpdateSize: (idx, size, orientation, scale) => this.updatePageSize(idx, size, orientation, scale),
        onDismiss: () => {
          this.activePopover?.destroy();
          this.activePopover = null;
        },
      },
    );
  }

  private deletePage(pageIndex: number): void {
    if (this.document.pages.length <= 1) return;
    this.document.strokes = this.document.strokes.filter(s => s.pageIndex !== pageIndex);
    for (const stroke of this.document.strokes) {
      if (stroke.pageIndex > pageIndex) stroke.pageIndex--;
    }
    this.document.pages.splice(pageIndex, 1);
    this.spatialIndex.buildFromStrokes(this.document.strokes);
    this.renderer?.invalidateCache();
    this.recomputeLayout();
    this.requestStaticRender();
    this.requestSave();
  }

  private updatePageStyle(
    pageIndex: number,
    changes: { paperType?: PaperType; lineSpacing?: number; gridSize?: number; margins?: Partial<PageMargins> },
  ): void {
    const page = this.document.pages[pageIndex];
    if (!page) return;
    if (changes.paperType !== undefined) page.paperType = changes.paperType;
    if (changes.lineSpacing !== undefined) page.lineSpacing = changes.lineSpacing;
    if (changes.gridSize !== undefined) page.gridSize = changes.gridSize;
    if (changes.margins) {
      if (changes.margins.top !== undefined) page.margins.top = changes.margins.top;
      if (changes.margins.bottom !== undefined) page.margins.bottom = changes.margins.bottom;
      if (changes.margins.left !== undefined) page.margins.left = changes.margins.left;
      if (changes.margins.right !== undefined) page.margins.right = changes.margins.right;
    }
    this.renderer?.invalidateCache();
    this.requestStaticRender();
    this.requestSave();
  }

  private updatePageBackground(
    pageIndex: number,
    backgroundColor: PageBackgroundColor,
    backgroundColorTheme?: PageBackgroundTheme,
  ): void {
    const page = this.document.pages[pageIndex];
    if (!page) return;
    page.backgroundColor = backgroundColor;
    page.backgroundColorTheme = backgroundColorTheme ?? "auto";
    this.renderer?.invalidateCache();
    this.requestStaticRender();
    this.requestSave();
  }

  private updatePageSize(
    pageIndex: number,
    newSize: PageSize,
    newOrientation: PageOrientation,
    scaleStrokes: boolean,
  ): void {
    const page = this.document.pages[pageIndex];
    if (!page) return;
    const oldEffective = getEffectiveSize(page);
    page.size = newSize;
    page.orientation = newOrientation;
    if (scaleStrokes) {
      const newEffective = getEffectiveSize(page);
      this.scaleStrokesForPage(pageIndex, oldEffective, newEffective);
    }
    this.recomputeLayout();
    this.renderer?.invalidateCache();
    this.requestStaticRender();
    this.requestSave();
  }

  private scaleStrokesForPage(
    pageIndex: number,
    oldSize: { width: number; height: number },
    newSize: { width: number; height: number },
  ): void {
    if (oldSize.width === 0 || oldSize.height === 0) return;
    const scaleX = newSize.width / oldSize.width;
    const scaleY = newSize.height / oldSize.height;
    if (scaleX === 1 && scaleY === 1) return;

    const oldLayout = computePageLayout(this.document.pages.map((p, i) => {
      if (i === pageIndex) {
        return { ...p, size: { width: oldSize.width, height: oldSize.height }, orientation: "portrait" as const };
      }
      return p;
    }), this.document.layoutDirection);

    const newLayout = computePageLayout(this.document.pages, this.document.layoutDirection);
    const oldPageRect = oldLayout[pageIndex];
    const newPageRect = newLayout[pageIndex];
    if (!oldPageRect || !newPageRect) return;

    for (const stroke of this.document.strokes) {
      if (stroke.pageIndex !== pageIndex) continue;
      const points = decodePoints(stroke.pts);
      for (const pt of points) {
        const relX = pt.x - oldPageRect.x;
        const relY = pt.y - oldPageRect.y;
        pt.x = newPageRect.x + relX * scaleX;
        pt.y = newPageRect.y + relY * scaleY;
      }
      stroke.pts = encodePoints(points);
      stroke.pointCount = points.length;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      stroke.bbox = [minX, minY, maxX, maxY];
      this.renderer?.invalidateCache(stroke.id);
    }
    this.spatialIndex.buildFromStrokes(this.document.strokes);
  }

  // ─── Page Layout ───────────────────────────────────────────

  private centerOnFirstPage(): void {
    const rect = this.pageLayout[0];
    const container = this.contentEl.querySelector(".paper-view-container");
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;

    const horizontalPadding = 40;
    const fitZoom = (bounds.width - horizontalPadding) / rect.width;
    const zoom = Camera.clampZoom(fitZoom);
    const pageCenterX = rect.x + rect.width / 2;
    const x = pageCenterX - bounds.width / (2 * zoom);
    const topPadding = 20 / zoom;
    const y = rect.y - topPadding;

    this.camera.setState({ x, y, zoom });
    this.camera.clampPan(bounds.width, bounds.height);
  }

  private recomputeLayout(): void {
    this.pageLayout = computePageLayout(this.document.pages, this.document.layoutDirection);
    const bounds = getDocumentBounds(this.pageLayout);
    this.camera.setDocumentBounds(bounds);
    this.updateZoomLimits();
  }

  private updateZoomLimits(): void {
    if (this.cssWidth === 0 || this.cssHeight === 0) return;
    if (this.pageLayout.length === 0) return;

    const isVertical = this.document.layoutDirection === "vertical";
    const screenSize = isVertical ? this.cssWidth : this.cssHeight;

    let largestPageSize = 0;
    let smallestPageSize = Infinity;
    for (const rect of this.pageLayout) {
      const pageSize = isVertical ? rect.width : rect.height;
      largestPageSize = Math.max(largestPageSize, pageSize);
      smallestPageSize = Math.min(smallestPageSize, pageSize);
    }
    if (largestPageSize === 0 || smallestPageSize === 0) return;

    const minZoom = screenSize / (3 * largestPageSize);
    const maxZoom = (3 * screenSize) / smallestPageSize;
    this.camera.setZoomLimits(Math.max(0.05, minZoom), Math.min(10, maxZoom));
  }

  // ─── Rendering ──────────────────────────────────────────────

  private renderStaticWithIcons(): void {
    const isDark = this.themeDetector?.isDarkMode ?? false;
    this.renderer?.renderStaticLayer(
      this.document,
      this.pageLayout,
      this.spatialIndex,
      (ctx, visibleRect) => {
        this.pageMenuButton?.renderIcons(ctx, this.pageLayout, this.document.pages, visibleRect, isDark);
      },
    );
    this.pageMenuButton?.updateHitAreas(this.pageLayout);
  }

  private requestStaticRender(): void {
    if (this.staticRafId !== null) return;
    this.staticRafId = requestAnimationFrame(() => {
      this.staticRafId = null;
      this.renderStaticWithIcons();
    });
  }

  private handleResize(width: number, height: number): void {
    const oldWidth = this.cssWidth;
    const oldHeight = this.cssHeight;
    this.cssWidth = width;
    this.cssHeight = height;

    if (oldWidth > 0 && oldHeight > 0) {
      const centerWorldX = this.camera.x + oldWidth / (2 * this.camera.zoom);
      const centerWorldY = this.camera.y + oldHeight / (2 * this.camera.zoom);
      this.camera.x = centerWorldX - width / (2 * this.camera.zoom);
      this.camera.y = centerWorldY - height / (2 * this.camera.zoom);
    }

    this.renderer?.resize(width, height);
    this.updateZoomLimits();
    this.camera.clampPan(width, height);
    this.renderStaticWithIcons();
  }

  // ─── Precompression ─────────────────────────────────────────

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

  // ─── Gesture Transforms ─────────────────────────────────────

  private applyGestureTransform(): void {
    if (!this.gestureBaseCamera || !this.renderer) return;
    const base = this.gestureBaseCamera;
    const cam = this.camera;
    const scale = cam.zoom / base.zoom;
    const tx = (base.x - cam.x) * cam.zoom;
    const ty = (base.y - cam.y) * cam.zoom;
    this.renderer.setGestureTransform(tx, ty, scale);

    if (!this.isOverscanSufficient(tx, ty, scale)) {
      this.requestMidGestureRender();
    }
  }

  private isOverscanSufficient(tx: number, ty: number, scale: number): boolean {
    if (!this.renderer) return true;
    if (this.renderer.isTilingEnabled) return true;

    const { x: ox, y: oy } = this.renderer.getOverscanOffset();
    const { width: ow, height: oh } = this.renderer.getOverscanCssSize();
    const txAdj = tx + ox * (scale - 1);
    const tyAdj = ty + oy * (scale - 1);
    const leftEdge = ox + txAdj;
    const topEdge = oy + tyAdj;
    const rightEdge = ox + txAdj + ow * scale;
    const bottomEdge = oy + tyAdj + oh * scale;
    return leftEdge <= 2 && topEdge <= 2
      && rightEdge >= this.cssWidth - 2
      && bottomEdge >= this.cssHeight - 2;
  }

  private requestMidGestureRender(): void {
    if (this.midGestureRenderPending) return;
    const now = performance.now();
    const elapsed = now - this.lastMidGestureRenderTime;
    if (elapsed < EmbeddedPaperModal.MID_GESTURE_THROTTLE_MS) {
      this.midGestureRenderPending = true;
      setTimeout(() => {
        this.midGestureRenderPending = false;
        this.executeMidGestureRender();
      }, EmbeddedPaperModal.MID_GESTURE_THROTTLE_MS - elapsed);
    } else {
      this.executeMidGestureRender();
    }
  }

  private executeMidGestureRender(): void {
    if (!this.renderer) return;
    this.lastMidGestureRenderTime = performance.now();
    this.gestureBaseCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
    this.renderer.clearGestureTransform();
    this.renderStaticWithIcons();
  }

  // ─── Style Helpers ──────────────────────────────────────────

  private getCurrentStyle(): PenStyle {
    const penConfig = getPenConfig(this.currentPenType);
    const style: PenStyle = {
      pen: this.currentPenType,
      color: this.currentColorId,
      width: this.currentWidth,
      opacity: penConfig.baseOpacity,
      smoothing: this.currentSmoothing,
      pressureCurve: penConfig.pressureCurve,
      tiltSensitivity: penConfig.tiltSensitivity,
    };
    if (penConfig.nibAngle !== null) {
      style.nibAngle = this.currentNibAngle;
      style.nibThickness = this.currentNibThickness;
      style.nibPressure = this.currentNibPressure;
      style.useBarrelRotation = this.currentUseBarrelRotation;
    }
    if (penConfig.stamp) {
      style.grain = this.currentGrain;
    }
    if (penConfig.inkStamp) {
      style.inkPreset = this.currentInkPreset;
    }
    return style;
  }

  private getCurrentStyleName(): string {
    return "_default";
  }

  // ─── Undo/Redo ──────────────────────────────────────────────

  private undo(): void {
    this.renderer?.flushFinalizations();
    const action = this.undoManager.undo();
    if (!action) return;

    switch (action.type) {
      case "add-stroke": {
        const idx = this.document.strokes.findIndex(s => s.id === action.stroke.id);
        if (idx !== -1) {
          this.document.strokes.splice(idx, 1);
          this.spatialIndex.remove(action.stroke.id);
          this.renderer?.invalidateCache(action.stroke.id);
        }
        break;
      }
      case "remove-stroke": {
        const insertIdx = Math.min(action.index, this.document.strokes.length);
        this.document.strokes.splice(insertIdx, 0, action.stroke);
        this.spatialIndex.insert(action.stroke, insertIdx);
        break;
      }
      case "remove-strokes": {
        const sorted = [...action.strokes].sort((a, b) => a.index - b.index);
        for (const entry of sorted) {
          const insertIdx = Math.min(entry.index, this.document.strokes.length);
          this.document.strokes.splice(insertIdx, 0, entry.stroke);
          this.spatialIndex.insert(entry.stroke, insertIdx);
        }
        break;
      }
    }

    this.renderStaticWithIcons();
    this.toolbar?.refreshUndoRedo();
    this.requestSave();
  }

  private redo(): void {
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
        const idx = this.document.strokes.findIndex(s => s.id === action.stroke.id);
        if (idx !== -1) {
          this.document.strokes.splice(idx, 1);
          this.spatialIndex.remove(action.stroke.id);
          this.renderer?.invalidateCache(action.stroke.id);
        }
        break;
      }
      case "remove-strokes": {
        for (const entry of action.strokes) {
          const idx = this.document.strokes.findIndex(s => s.id === entry.stroke.id);
          if (idx !== -1) {
            this.document.strokes.splice(idx, 1);
            this.spatialIndex.remove(entry.stroke.id);
            this.renderer?.invalidateCache(entry.stroke.id);
          }
        }
        break;
      }
    }

    this.renderStaticWithIcons();
    this.toolbar?.refreshUndoRedo();
    this.requestSave();
  }

  // ─── Toolbar Callbacks ──────────────────────────────────────

  private createToolbarCallbacks(): ToolbarCallbacks {
    return {
      onToolChange: (tool: ActiveTool) => {
        this.activeTool = tool;
      },
      onPenSettingsChange: (state: ToolbarState) => {
        this.currentPenType = state.penType;
        this.currentColorId = state.colorId;
        this.currentWidth = state.width;
        this.currentSmoothing = state.smoothing;
        this.currentNibAngle = state.nibAngle;
        this.currentNibThickness = state.nibThickness;
        this.currentNibPressure = state.nibPressure;
        this.currentUseBarrelRotation = state.useBarrelRotation;
        this.currentGrain = state.grain;
        this.currentInkPreset = state.inkPreset;
        this.renderer?.setCurrentInkPreset(state.inkPreset);
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onAddPage: () => this.addPage(),
      onOpenDocumentSettings: () => this.openDocumentSettings(),
      onPresetSave: (presets, activePresetId) => {
        this.settings.penPresets = presets;
        this.settings.activePresetId = activePresetId;
        this.onSettingsChange?.({ penPresets: presets, activePresetId });
      },
      onPositionChange: (position) => {
        this.deviceSettings.toolbarPosition = position;
        this.onDeviceSettingsChanged?.({ toolbarPosition: position });
      },
    };
  }

  private createToolbarQueries(): ToolbarQueries {
    return {
      canUndo: () => this.undoManager.canUndo(),
      canRedo: () => this.undoManager.canRedo(),
      pageCount: () => this.document.pages.length,
    };
  }

  // ─── Input Callbacks ────────────────────────────────────────

  private getActivePageRect(): PageRect | undefined {
    if (this.activeStrokePageIndex < 0 || this.activeStrokePageIndex >= this.pageLayout.length) {
      return undefined;
    }
    return this.pageLayout[this.activeStrokePageIndex];
  }

  private getActivePageDarkColors(): boolean | undefined {
    if (this.activeStrokePageIndex < 0 || this.activeStrokePageIndex >= this.document.pages.length) {
      return undefined;
    }
    const page = this.document.pages[this.activeStrokePageIndex];
    const isDark = this.themeDetector?.isDarkMode ?? false;
    const { patternTheme } = resolvePageBackground(
      page.backgroundColor,
      page.backgroundColorTheme,
      isDark,
    );
    return patternTheme === "dark";
  }

  private createInputCallbacks(): InputCallbacks {
    return {
      onStrokeStart: (point: StrokePoint) => {
        this.hoverCursor?.hide();
        this.toolbar?.notifyStrokeStart();
        this.pageMenuButton?.setDrawingActive(true);
        if (this.activeTool === "eraser") return;

        const world = this.camera.screenToWorld(point.x, point.y);
        const pageIndex = findPageAtPoint(world.x, world.y, this.pageLayout);

        if (pageIndex === -1) {
          this.activeStrokePageIndex = -1;
          this.inputManager?.switchToPan(point);
          return;
        }

        this.activeStrokePageIndex = pageIndex;
        const style = this.getCurrentStyle();
        const styleName = this.getCurrentStyleName();
        const baseStyle = this.document.styles[styleName];
        const overrides = baseStyle ? computeStyleOverrides(baseStyle, style) : undefined;
        this.strokeBuilder = new StrokeBuilder(
          styleName,
          pageIndex,
          { smoothing: style.smoothing },
          overrides,
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
        const pageRect = this.getActivePageRect();
        const pageDark = this.getActivePageDarkColors();

        for (const point of points) {
          const world = this.camera.screenToWorld(point.x, point.y);
          this.strokeBuilder.addPoint({ ...point, x: world.x, y: world.y });
        }

        this.renderer?.renderActiveStroke(
          this.strokeBuilder.getPoints(),
          style,
          pageRect,
          pageDark,
        );

        if (predicted.length > 0) {
          const predictedWorld = predicted.map((p) => {
            const w = this.camera.screenToWorld(p.x, p.y);
            return { ...p, x: w.x, y: w.y };
          });
          this.renderer?.renderPrediction(
            this.strokeBuilder.getPoints(),
            predictedWorld,
            style,
            pageRect,
            pageDark,
          );
        }
      },

      onStrokeEnd: (point: StrokePoint) => {
        this.toolbar?.notifyStrokeEnd();
        this.pageMenuButton?.setDrawingActive(false);
        if (!this.strokeBuilder) return;

        const world = this.camera.screenToWorld(point.x, point.y);
        this.strokeBuilder.addPoint({ ...point, x: world.x, y: world.y });

        if (this.strokeBuilder.pointCount >= 2) {
          const builder = this.strokeBuilder;
          const style = this.getCurrentStyle();
          const styleName = this.getCurrentStyleName();
          const docStyles = this.document.styles;
          const pageRect = this.getActivePageRect();
          const pageDark = this.getActivePageDarkColors();

          if (!docStyles[styleName]) {
            docStyles[styleName] = style;
          }

          this.renderer?.scheduleFinalization(() => {
            const penConfig = getPenConfig(style.pen);
            let bboxMargin = style.width * 2;
            if (penConfig.stamp && penConfig.tiltConfig) {
              const tc = penConfig.tiltConfig;
              bboxMargin = style.width * (tc.crossAxisMultiplier + tc.maxSkewOffset);
            }
            const stroke = builder.finalize(bboxMargin);
            this.document.strokes.push(stroke);
            this.spatialIndex.insert(stroke, this.document.strokes.length - 1);
            this.undoManager.pushAddStroke(stroke);
            this.renderer?.bakeStroke(
              stroke, this.document.styles, pageRect, pageDark,
              this.document, this.pageLayout, this.spatialIndex,
            );
            precompressStroke(stroke);
            this.renderer?.clearActiveLayer();
            this.toolbar?.refreshUndoRedo();
            this.requestSave();
          });
        } else {
          this.renderer?.clearActiveLayer();
        }

        this.renderer?.clearPredictionLayer();
        this.strokeBuilder = null;
        this.activeStrokePageIndex = -1;
      },

      onStrokeCancel: () => {
        this.pageMenuButton?.setDrawingActive(false);
        this.strokeBuilder?.discard();
        this.strokeBuilder = null;
        this.activeStrokePageIndex = -1;
        this.renderer?.clearActiveLayer();
      },

      onPanStart: () => {
        this.gestureBaseCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
      },

      onPanMove: (dx: number, dy: number) => {
        this.camera.pan(dx, dy);
        this.camera.clampPan(this.cssWidth, this.cssHeight);
        if (!this.gestureBaseCamera) {
          this.gestureBaseCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
        }
        this.applyGestureTransform();
      },

      onPanEnd: () => {
        this.midGestureRenderPending = false;
        this.gestureBaseCamera = null;
        this.renderer?.clearGestureTransform();
        this.requestStaticRender();
        this.requestSave();
      },

      onPinchMove: (centerX: number, centerY: number, scale: number, panDx: number, panDy: number) => {
        if (this.pinchBaseZoom === null) {
          this.pinchBaseZoom = this.camera.zoom;
        }
        this.camera.pan(panDx, panDy);
        const newZoom = this.pinchBaseZoom * scale;
        this.camera.zoomAt(centerX, centerY, newZoom);
        this.camera.clampPan(this.cssWidth, this.cssHeight);
        if (!this.gestureBaseCamera) {
          this.gestureBaseCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
        }
        this.applyGestureTransform();
      },

      onPinchEnd: () => {
        this.midGestureRenderPending = false;
        this.pinchBaseZoom = null;
        this.gestureBaseCamera = null;
        this.renderer?.clearGestureTransform();
        this.requestStaticRender();
        this.requestSave();
      },

      onTwoFingerTap: () => this.undo(),
      onThreeFingerTap: () => this.redo(),

      onHover: (x: number, y: number, _pointerType: string, twist: number) => {
        const penConfig = getPenConfig(this.currentPenType);
        const hasNib = penConfig.nibAngle !== null;
        let nibAngle = hasNib ? this.currentNibAngle : null;
        if (hasNib && this.currentUseBarrelRotation && twist !== 0) {
          nibAngle = twist * Math.PI / 180;
        }
        this.hoverCursor?.show(x, y, {
          colorId: this.currentColorId,
          width: this.currentWidth,
          isDarkMode: this.themeDetector?.isDarkMode ?? false,
          isEraser: this.activeTool === "eraser",
          zoom: this.camera.zoom,
          nibThickness: hasNib ? this.currentNibThickness : null,
          nibAngle,
        });
      },

      onHoverEnd: () => {
        this.hoverCursor?.hide();
      },

      onWheel: (screenX: number, screenY: number, deltaX: number, deltaY: number, isPinch: boolean) => {
        if (isPinch) {
          const zoomFactor = Math.exp(-deltaY * 0.01);
          const newZoom = this.camera.zoom * zoomFactor;
          this.camera.zoomAt(screenX, screenY, newZoom);
        } else {
          const world = this.camera.screenToWorld(screenX, screenY);
          const pageIndex = findPageAtPoint(world.x, world.y, this.pageLayout);
          if (pageIndex !== -1) {
            const zoomFactor = Math.exp(-deltaY * 0.005);
            const newZoom = this.camera.zoom * zoomFactor;
            this.camera.zoomAt(screenX, screenY, newZoom);
          } else {
            this.camera.pan(-deltaX, -deltaY);
          }
        }
        this.camera.clampPan(this.cssWidth, this.cssHeight);
        this.requestStaticRender();
      },

      onWheelEnd: () => {
        this.requestSave();
      },
    };
  }

  private handleEraserPoint(point: StrokePoint): void {
    const world = this.camera.screenToWorld(point.x, point.y);
    const radius = DEFAULT_ERASER_RADIUS / this.camera.zoom;

    const hitIndices = findHitStrokes(world.x, world.y, radius, this.document.strokes, this.spatialIndex);
    if (hitIndices.length === 0) return;

    const removedEntries: { stroke: Stroke; index: number }[] = [];
    const sortedDesc = [...hitIndices].sort((a, b) => b - a);

    for (const idx of sortedDesc) {
      const removed = this.document.strokes.splice(idx, 1)[0];
      this.spatialIndex.remove(removed.id);
      this.renderer?.invalidateCache(removed.id);
      removedEntries.push({ stroke: removed, index: idx });
    }

    if (removedEntries.length === 1) {
      this.undoManager.pushRemoveStroke(removedEntries[0].stroke, removedEntries[0].index);
    } else {
      this.undoManager.pushRemoveStrokes(removedEntries);
    }

    this.toolbar?.refreshUndoRedo();
    this.requestStaticRender();
    this.requestSave();
  }
}

function computeStyleOverrides(
  base: PenStyle,
  current: PenStyle
): Partial<PenStyle> | undefined {
  const overrides: Partial<PenStyle> = {};
  let has = false;

  if (current.pen !== base.pen) { overrides.pen = current.pen; has = true; }
  if (current.color !== base.color) { overrides.color = current.color; has = true; }
  if (current.width !== base.width) { overrides.width = current.width; has = true; }
  if (current.opacity !== base.opacity) { overrides.opacity = current.opacity; has = true; }
  if (current.smoothing !== base.smoothing) { overrides.smoothing = current.smoothing; has = true; }
  if (current.pressureCurve !== base.pressureCurve) { overrides.pressureCurve = current.pressureCurve; has = true; }
  if (current.tiltSensitivity !== base.tiltSensitivity) { overrides.tiltSensitivity = current.tiltSensitivity; has = true; }
  if (current.nibAngle !== base.nibAngle) { overrides.nibAngle = current.nibAngle; has = true; }
  if (current.nibThickness !== base.nibThickness) { overrides.nibThickness = current.nibThickness; has = true; }
  if (current.nibPressure !== base.nibPressure) { overrides.nibPressure = current.nibPressure; has = true; }
  if (current.grain !== base.grain) { overrides.grain = current.grain; has = true; }
  if (current.inkPreset !== base.inkPreset) { overrides.inkPreset = current.inkPreset; has = true; }
  if (current.useBarrelRotation !== base.useBarrelRotation) { overrides.useBarrelRotation = current.useBarrelRotation; has = true; }

  return has ? overrides : undefined;
}
