import { TextFileView, WorkspaceLeaf, Platform } from "obsidian";
import type { PaperDocument, PenStyle, PenType, Stroke, StrokePoint, Page, PageSize, PageDefaults, PaperType, PageOrientation, PageBackgroundColor, PageBackgroundTheme, PageMargins, RenderPipeline } from "../types";
import { PAGE_SIZE_PRESETS, PPI, CM_PER_INCH } from "../types";
import { Camera } from "../canvas/Camera";
import { Renderer } from "../canvas/Renderer";
import { InputManager } from "../input/InputManager";
import type { InputCallbacks } from "../input/InputManager";
import { StrokeBuilder } from "../stroke/StrokeBuilder";
import { UndoManager } from "../document/UndoManager";
import { createEmptyDocument, generatePageId, generateStrokeId } from "../document/Document";
import { serializeDocument, deserializeDocument, precompressStroke, clearCompressedCache } from "../document/Serializer";
import { getPenConfig } from "../stroke/PenConfigs";
import { findHitStrokes } from "../eraser/StrokeEraser";
import { ThemeDetector } from "../color/ThemeDetector";
import { Toolbar } from "./toolbar/Toolbar";
import type { ActiveTool, ToolbarCallbacks, ToolbarQueries, ToolbarState } from "./toolbar/ToolbarTypes";
import type { PaperSettings } from "../settings/PaperSettings";
import { DEFAULT_SETTINGS, resolvePageSize, resolveMargins } from "../settings/PaperSettings";
import type { DeviceSettings } from "../settings/DeviceSettings";
import { DEFAULT_DEVICE_SETTINGS } from "../settings/DeviceSettings";
import { HoverCursor } from "../input/HoverCursor";
import { SpatialIndex } from "../spatial/SpatialIndex";
import { computePageLayout, findPageAtPoint, getDocumentBounds, getEffectiveSize } from "../document/PageLayout";
import type { PageRect } from "../document/PageLayout";
import { PageMenuButton } from "./PageMenuButton";
import { PageMenuPopover } from "./PageMenuPopover";
import { DocumentSettingsPopover } from "./toolbar/DocumentSettingsPopover";
import { decodePoints, encodePoints } from "../document/PointEncoder";
import { resolvePageBackground } from "../color/ColorUtils";
import { DEFAULT_GRAIN_VALUE } from "../stamp/GrainMapping";
import { selectStrokesInLasso, previewLassoSelection } from "../selection/LassoSelector";
import type { Point2D } from "../selection/PointInPolygon";
import { SelectionOverlay } from "../selection/SelectionOverlay";
import { computeSelectionBBox, hitTestSelection } from "../selection/SelectionState";
import type { SelectionState, SelectionBBox, HandleCorner, HandleMidpoint } from "../selection/SelectionState";
import { cloneStroke, translateStroke, scaleStroke, stretchStroke, rotateStroke, snapAngle } from "../selection/SelectionTransform";
import { findNearestStroke } from "../selection/StrokeHitTester";
import { SelectionActionBar } from "../selection/SelectionActionBar";
import type { ClipboardQueue } from "../selection/Clipboard";
import { getEffectiveDPR } from "../canvas/HighDPI";

export const VIEW_TYPE_PAPER = "paper-view";
export const PAPER_EXTENSION = "paper";

const DEFAULT_ERASER_RADIUS = 10;
/** Max screen-space movement (squared) for a pen gesture to count as a tap */
const TAP_DISTANCE_SQ = 15 * 15;
/** World-space radius for tap-to-select hit testing */
const TAP_HIT_RADIUS = 20;

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
  private settings: PaperSettings = DEFAULT_SETTINGS;
  private deviceSettings: DeviceSettings = DEFAULT_DEVICE_SETTINGS;
  private staticRafId: number | null = null;
  private precompressTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Container size tracking for resize anchoring
  private cssWidth = 0;
  private cssHeight = 0;

  // Page layout
  private pageLayout: PageRect[] = [];
  private activeStrokePageIndex = -1;

  // Lasso / selection state
  private lassoPoints: Point2D[] = [];
  private lassoPageIndex = -1;
  private lassoStartScreen: { x: number; y: number } | null = null;
  /** Cached highlight bboxes for incremental lasso feedback */
  private lassoHighlights: [number, number, number, number][] = [];
  /** Lasso point count at last preview computation */
  private lassoPreviewAt = 0;
  private selectionState: SelectionState | null = null;
  private selectionOverlay: SelectionOverlay | null = null;
  private selectionDragType: "move" | "resize" | "stretch" | "rotate" | null = null;
  private selectionDragHandle: HandleCorner | null = null;
  private selectionDragMidpoint: HandleMidpoint | null = null;
  private selectionDragStart: { x: number; y: number } | null = null;
  /** Initial angle from selection center to pointer at rotation start */
  private selectionRotateBaseAngle = 0;
  private selectionActionBar: SelectionActionBar | null = null;
  /** Shared clipboard queue — set by the plugin, shared across all views */
  clipboard: ClipboardQueue | null = null;

  // Active tool state
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
  private currentInkDepletion = 0;
  private currentUseBarrelRotation = false;

  /**
   * Callback for persisting settings changes (presets) back to the plugin.
   */
  onSettingsChange: ((changes: Partial<PaperSettings>) => void) | null = null;

  /**
   * Callback for persisting device-specific settings changes back to the plugin.
   */
  onDeviceSettingsChange: ((changes: Partial<DeviceSettings>) => void) | null = null;

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
      this.toolbar?.setDarkMode(isDark);
    });
    this.themeDetector.start();

    // Create multi-layer renderer
    this.renderer = new Renderer(container, this.camera, Platform.isMobile, this.deviceSettings.defaultRenderEngine);
    this.renderer.isDarkMode = this.themeDetector.isDarkMode;
    this.renderer.initGrain();
    this.renderer.initStamps();
    this.renderer.initInkStamps();
    this.renderer.initMarkerStamps();
    this.renderer.setGrainStrength("pencil", this.settings.pencilGrainStrength);

    // Enable tile-based rendering for better zoom/pan performance
    this.renderer.enableTiling();

    // Selection overlay (on top of all drawing canvases)
    this.selectionOverlay = new SelectionOverlay(container);

    // Selection action bar (hidden until strokes are selected)
    this.selectionActionBar = new SelectionActionBar(
      container,
      {
        onColorChange: (colorId) => this.applySelectionColor(colorId),
        onPenTypeChange: (penType) => this.applySelectionPenType(penType),
        onWidthChange: (width) => this.applySelectionWidth(width),
        onCopy: () => this.copySelection(),
        onCut: () => this.cutSelection(),
        onPaste: () => this.pasteClipboard(),
        onDuplicate: () => this.duplicateSelection(),
        onDelete: () => this.deleteSelection(),
      },
    );
    this.selectionActionBar.hide();

    // Initial resize
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.cssWidth = rect.width;
      this.cssHeight = rect.height;
      this.renderer.resize(rect.width, rect.height);
      this.selectionOverlay.resize(rect.width, rect.height, getEffectiveDPR(Platform.isMobile));
    }

    // Setup input handling
    this.inputManager = new InputManager(container, this.createInputCallbacks());

    // Create toolbar
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
        inkDepletion: this.currentInkDepletion,
      },
      this.settings.penPresets,
      this.deviceSettings.toolbarPosition,
      this.themeDetector.isDarkMode
    );

    // Show paste button if clipboard already has content (shared across views)
    if (this.clipboard && !this.clipboard.isEmpty) {
      this.toolbar.showPasteButton(true, this.clipboard?.size ?? 0);
    }

    // Page menu button (per-page settings icon + hit areas)
    this.pageMenuButton = new PageMenuButton(container, this.camera, {
      onPageMenuTap: (pageIndex, anchorEl) => {
        this.openPageMenu(pageIndex, anchorEl);
      },
    });

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
    this.selectionActionBar?.destroy();
    this.selectionActionBar = null;
    this.selectionOverlay?.destroy();
    this.selectionOverlay = null;
    this.selectionState = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.strokeBuilder = null;
    this.undoManager.clear();
    this.spatialIndex.clear();
  }

  getViewData(): string {
    this.renderer?.flushFinalizations();
    this.document.meta.modified = Date.now();
    return serializeDocument(this.document);
  }

  setViewData(data: string, clear: boolean): void {
    this.renderer?.flushFinalizations();
    this.document = deserializeDocument(data);

    if (clear) {
      this.undoManager.clear();
    }
    this.spatialIndex.buildFromStrokes(this.document.strokes);
    this.recomputeLayout();

    // Always open at first page, centered and fit to width
    if (this.pageLayout.length > 0) {
      this.centerOnFirstPage();
    }

    this.renderer?.setPipeline(this.getResolvedPipeline());
    this.renderer?.invalidateCache();
    this.renderStaticWithIcons();
    this.precompressLoadedStrokes();
  }

  clear(): void {
    this.cancelPrecompression();
    this.renderer?.flushFinalizations();
    this.document = createEmptyDocument();
    // Reset the existing camera — do NOT replace with `new Camera()`.
    // Renderer, InputManager, and TiledStaticLayer hold references to this object.
    this.camera.setState({ x: 0, y: 0, zoom: 1.0 });
    this.undoManager.clear();
    this.spatialIndex.clear();
    this.recomputeLayout();
    this.renderer?.invalidateCache();
    this.renderStaticWithIcons();
  }

  setSettings(settings: PaperSettings): void {
    this.settings = settings;
    this.renderer?.setPipeline(this.getResolvedPipeline());
    this.renderer?.setGrainStrength("pencil", settings.pencilGrainStrength);

    // If there's an active preset, load its values
    if (settings.activePresetId) {
      const preset = settings.penPresets.find((p) => p.id === settings.activePresetId);
      if (preset) {
        this.currentPenType = preset.penType;
        this.currentColorId = preset.colorId;
        this.currentWidth = preset.width;
        this.currentSmoothing = preset.smoothing;
        this.currentGrain = preset.grain ?? DEFAULT_GRAIN_VALUE;
        this.currentInkPreset = preset.inkPreset ?? "standard";
        this.currentInkDepletion = preset.inkDepletion ?? 0;
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

    this.toolbar?.setState({
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
      inkDepletion: this.currentInkDepletion,
      activePresetId: settings.activePresetId,
    });
    this.toolbar?.updatePresets(settings.penPresets, settings.activePresetId);
  }

  setDeviceSettings(ds: DeviceSettings): void {
    this.deviceSettings = ds;
    this.renderer?.setPipeline(this.getResolvedPipeline());
    this.toolbar?.setPosition(ds.toolbarPosition);
  }

  onResize(): void {
    const rect = this.contentEl.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.handleResize(rect.width, rect.height);
    }
  }

  undo(): void {
    this.clearSelection();
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
      case "add-strokes": {
        for (const stroke of action.strokes) {
          const idx = this.document.strokes.findIndex(s => s.id === stroke.id);
          if (idx !== -1) {
            this.document.strokes.splice(idx, 1);
            this.spatialIndex.remove(stroke.id);
            this.renderer?.invalidateCache(stroke.id);
          }
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
      case "transform-strokes":
      case "modify-strokes": {
        // Undo: restore "before" versions
        for (const entry of action.entries) {
          const idx = this.document.strokes.findIndex(s => s.id === entry.strokeId);
          if (idx !== -1) {
            this.document.strokes[idx] = entry.before;
            this.spatialIndex.remove(entry.strokeId);
            this.spatialIndex.insert(entry.before, idx);
          }
        }
        // Strokes may have moved — invalidate all tiles
        this.renderer?.invalidateCache();
        break;
      }
    }

    this.renderStaticWithIcons();
    this.toolbar?.refreshUndoRedo();
    this.requestSave();
  }

  redo(): void {
    this.clearSelection();
    this.renderer?.flushFinalizations();
    const action = this.undoManager.redo();
    if (!action) return;

    switch (action.type) {
      case "add-stroke": {
        this.document.strokes.push(action.stroke);
        this.spatialIndex.insert(action.stroke, this.document.strokes.length - 1);
        break;
      }
      case "add-strokes": {
        for (const stroke of action.strokes) {
          this.document.strokes.push(stroke);
          this.spatialIndex.insert(stroke, this.document.strokes.length - 1);
        }
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
      case "transform-strokes":
      case "modify-strokes": {
        // Redo: restore "after" versions
        for (const entry of action.entries) {
          const idx = this.document.strokes.findIndex(s => s.id === entry.strokeId);
          if (idx !== -1) {
            this.document.strokes[idx] = entry.after;
            this.spatialIndex.remove(entry.strokeId);
            this.spatialIndex.insert(entry.after, idx);
          }
        }
        // Strokes may have moved — invalidate all tiles
        this.renderer?.invalidateCache();
        break;
      }
    }

    this.renderStaticWithIcons();
    this.toolbar?.refreshUndoRedo();
    this.requestSave();
  }

  /**
   * Add a new page to the document.
   */
  addPage(size?: PageSize, orientation?: Page["orientation"], paperType?: Page["paperType"]): void {
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
    // Background from page defaults
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

  /**
   * Get the current page layout.
   */
  getPageLayout(): readonly PageRect[] {
    return this.pageLayout;
  }

  /**
   * Get the current document.
   */
  getDocument(): PaperDocument {
    return this.document;
  }

  /**
   * Scroll viewport to center on a specific page.
   */
  scrollToPage(pageIndex: number): void {
    if (pageIndex < 0 || pageIndex >= this.pageLayout.length) return;
    const rect = this.pageLayout[pageIndex];
    const container = this.contentEl.getBoundingClientRect();
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    this.camera.x = centerX - container.width / (2 * this.camera.zoom);
    this.camera.y = centerY - container.height / (2 * this.camera.zoom);
    this.camera.clampPan(container.width, container.height);
    this.requestStaticRender();
  }

  /**
   * Set the layout direction and recompute.
   */
  setLayoutDirection(direction: PaperDocument["layoutDirection"]): void {
    this.document.layoutDirection = direction;
    this.recomputeLayout();
    this.requestStaticRender();
    this.requestSave();
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

  openDocumentSettings(): void {
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

  updatePageDefaults(defaults: PageDefaults): void {
    const hasAny = Object.values(defaults).some(v => v !== undefined);
    this.document.pageDefaults = hasAny ? defaults : undefined;
    this.requestSave();
  }

  // ─── Page Management ─────────────────────────────────────────

  /**
   * Open the page settings popover for a specific page.
   */
  private openPageMenu(pageIndex: number, anchorEl: HTMLElement): void {
    // Close any existing popover
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
        onDeletePage: (idx) => {
          this.deletePage(idx);
        },
        onUpdateStyle: (idx, changes) => {
          this.updatePageStyle(idx, changes);
        },
        onUpdateBackground: (idx, bg, bgt) => {
          this.updatePageBackground(idx, bg, bgt);
        },
        onUpdateSize: (idx, size, orientation, scale) => {
          this.updatePageSize(idx, size, orientation, scale);
        },
        onDismiss: () => {
          this.activePopover?.destroy();
          this.activePopover = null;
        },
      },
    );
  }

  /**
   * Delete a page and its strokes.
   */
  deletePage(pageIndex: number): void {
    if (this.document.pages.length <= 1) return; // Can't delete last page

    // Remove all strokes belonging to this page
    this.document.strokes = this.document.strokes.filter(s => s.pageIndex !== pageIndex);

    // Update pageIndex for strokes on later pages
    for (const stroke of this.document.strokes) {
      if (stroke.pageIndex > pageIndex) {
        stroke.pageIndex--;
      }
    }

    // Remove the page
    this.document.pages.splice(pageIndex, 1);

    // Rebuild spatial index (stroke indices changed)
    this.spatialIndex.buildFromStrokes(this.document.strokes);
    this.renderer?.invalidateCache();

    this.recomputeLayout();
    this.requestStaticRender();
    this.requestSave();
  }

  /**
   * Update a page's paper type, line spacing, and grid size.
   */
  updatePageStyle(
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

  /**
   * Update a page's background color and optional pattern theme override.
   */
  updatePageBackground(
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

  /**
   * Update a page's size and orientation.
   * If scaleStrokes is true, existing strokes are scaled to fit the new dimensions.
   */
  updatePageSize(
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

  /**
   * Scale all strokes on a page from old dimensions to new dimensions.
   */
  private scaleStrokesForPage(
    pageIndex: number,
    oldSize: { width: number; height: number },
    newSize: { width: number; height: number },
  ): void {
    if (oldSize.width === 0 || oldSize.height === 0) return;

    const scaleX = newSize.width / oldSize.width;
    const scaleY = newSize.height / oldSize.height;

    if (scaleX === 1 && scaleY === 1) return;

    // Compute old layout (before size change) to find old page origin.
    // page.size/orientation are already updated, so reconstruct old page temporarily.
    const oldLayout = computePageLayout(this.document.pages.map((p, i) => {
      if (i === pageIndex) {
        return { ...p, size: { width: oldSize.width, height: oldSize.height }, orientation: "portrait" as const };
      }
      return p;
    }), this.document.layoutDirection);

    // Compute new layout (with updated size) to find new page origin.
    const newLayout = computePageLayout(this.document.pages, this.document.layoutDirection);

    const oldPageRect = oldLayout[pageIndex];
    const newPageRect = newLayout[pageIndex];
    if (!oldPageRect || !newPageRect) return;

    for (const stroke of this.document.strokes) {
      if (stroke.pageIndex !== pageIndex) continue;

      // Decode points
      const points = decodePoints(stroke.pts);

      // Scale relative to old page origin, remap to new page origin
      for (const pt of points) {
        const relX = pt.x - oldPageRect.x;
        const relY = pt.y - oldPageRect.y;
        pt.x = newPageRect.x + relX * scaleX;
        pt.y = newPageRect.y + relY * scaleY;
      }

      // Re-encode
      stroke.pts = encodePoints(points);
      stroke.pointCount = points.length;

      // Recompute bbox
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of points) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      stroke.bbox = [minX, minY, maxX, maxY];

      // Invalidate path cache for this stroke
      this.renderer?.invalidateCache(stroke.id);
    }

    // Rebuild spatial index since bboxes changed
    this.spatialIndex.buildFromStrokes(this.document.strokes);
  }

  // ─── Page Layout ───────────────────────────────────────────────

  /**
   * Center the viewport on the first page, fitting it to the screen width.
   */
  private centerOnFirstPage(): void {
    const rect = this.pageLayout[0];
    const container = this.contentEl.getBoundingClientRect();
    if (container.width === 0 || container.height === 0) return;

    // Fit page width to container with some padding
    const horizontalPadding = 40; // 20px on each side in screen coords
    const fitZoom = (container.width - horizontalPadding) / rect.width;
    const zoom = Camera.clampZoom(fitZoom);

    // Center horizontally on page
    const pageCenterX = rect.x + rect.width / 2;
    const x = pageCenterX - container.width / (2 * zoom);

    // Position so top of page is near top of screen with a small offset
    const topPadding = 20 / zoom; // 20px screen offset
    const y = rect.y - topPadding;

    this.camera.setState({ x, y, zoom });
    this.camera.clampPan(container.width, container.height);
  }

  private recomputeLayout(): void {
    this.pageLayout = computePageLayout(this.document.pages, this.document.layoutDirection);
    const bounds = getDocumentBounds(this.pageLayout);
    this.camera.setDocumentBounds(bounds);
    this.updateZoomLimits();
  }

  private updateZoomLimits(): void {
    const container = this.contentEl.getBoundingClientRect();
    if (container.width === 0 || container.height === 0) return;
    if (this.pageLayout.length === 0) return;

    const isVertical = this.document.layoutDirection === "vertical";
    const screenSize = isVertical ? container.width : container.height;

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

    this.camera.setZoomLimits(
      Math.max(0.05, minZoom),
      Math.min(10, maxZoom)
    );
  }

  // ─── Rendering ──────────────────────────────────────────────────

  /**
   * Coalesce multiple static layer render requests into a single RAF frame.
   */
  /**
   * Render the static layer with page menu icons and update hit areas.
   */
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

  /**
   * Coalesce multiple static layer render requests into a single RAF frame.
   */
  private requestStaticRender(): void {
    if (this.staticRafId !== null) return;
    this.staticRafId = requestAnimationFrame(() => {
      this.staticRafId = null;
      this.renderStaticWithIcons();
    });
  }

  private handleResize(width: number, height: number): void {
    // Preserve the world-space center point during resize
    const oldWidth = this.cssWidth;
    const oldHeight = this.cssHeight;
    this.cssWidth = width;
    this.cssHeight = height;

    if (oldWidth > 0 && oldHeight > 0) {
      // Compute world center before resize
      const centerWorldX = this.camera.x + oldWidth / (2 * this.camera.zoom);
      const centerWorldY = this.camera.y + oldHeight / (2 * this.camera.zoom);

      // Adjust camera so the same world point stays at screen center
      this.camera.x = centerWorldX - width / (2 * this.camera.zoom);
      this.camera.y = centerWorldY - height / (2 * this.camera.zoom);
    }

    this.renderer?.resize(width, height);
    this.selectionOverlay?.resize(width, height, getEffectiveDPR(Platform.isMobile));
    this.updateZoomLimits();
    this.camera.clampPan(width, height);
    this.renderStaticWithIcons();
    this.renderSelectionUI();
  }

  // ─── Precompression ─────────────────────────────────────────────

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

  /**
   * Compute and apply a CSS transform to all canvas layers based on the
   * delta from gestureBaseCamera to the current camera. This provides a
   * smooth preview during gestures without re-rendering strokes.
   */
  private applyGestureTransform(): void {
    if (!this.gestureBaseCamera || !this.renderer) return;
    const base = this.gestureBaseCamera;
    const cam = this.camera;
    const scale = cam.zoom / base.zoom;
    const tx = (base.x - cam.x) * cam.zoom;
    const ty = (base.y - cam.y) * cam.zoom;
    this.renderer.setGestureTransform(tx, ty, scale);
    this.selectionOverlay?.setTransform(tx, ty, scale);

    // If the CSS-transformed overscan canvas no longer covers the viewport,
    // trigger a throttled re-render to recenter the buffer.
    if (!this.isOverscanSufficient(tx, ty, scale)) {
      this.requestMidGestureRender();
    }
  }

  /**
   * Check whether the CSS-transformed overscan canvas still fully covers the viewport.
   * When tile-based rendering is active, mid-gesture re-renders are not needed
   * since tiles provide pre-rendered content beyond the viewport.
   */
  private isOverscanSufficient(tx: number, ty: number, scale: number): boolean {
    if (!this.renderer) return true;

    // Tile-based rendering handles edge content via overscan tiles
    if (this.renderer.isTilingEnabled) return true;

    const { x: ox, y: oy } = this.renderer.getOverscanOffset();
    const { width: ow, height: oh } = this.renderer.getOverscanCssSize();

    // Adjusted translation for overscan canvas (same math as setGestureTransform)
    const txAdj = tx + ox * (scale - 1);
    const tyAdj = ty + oy * (scale - 1);

    // Edges of the overscan canvas after CSS transform, relative to viewport
    const leftEdge = ox + txAdj;
    const topEdge = oy + tyAdj;
    const rightEdge = ox + txAdj + ow * scale;
    const bottomEdge = oy + tyAdj + oh * scale;

    // Allow 2px tolerance to avoid jitter
    return leftEdge <= 2 && topEdge <= 2
      && rightEdge >= this.cssWidth - 2
      && bottomEdge >= this.cssHeight - 2;
  }

  private requestMidGestureRender(): void {
    if (this.midGestureRenderPending) return;

    const now = performance.now();
    const elapsed = now - this.lastMidGestureRenderTime;

    if (elapsed < PaperView.MID_GESTURE_THROTTLE_MS) {
      this.midGestureRenderPending = true;
      setTimeout(() => {
        this.midGestureRenderPending = false;
        this.executeMidGestureRender();
      }, PaperView.MID_GESTURE_THROTTLE_MS - elapsed);
    } else {
      this.executeMidGestureRender();
    }
  }

  private executeMidGestureRender(): void {
    if (!this.renderer) return;

    this.lastMidGestureRenderTime = performance.now();

    // Reset gesture base to current camera position
    this.gestureBaseCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };

    // Clear CSS transform (base = current, so delta is zero)
    this.renderer.clearGestureTransform();
    this.selectionOverlay?.clearTransform();

    // Re-render centered on new viewport (synchronous)
    this.renderStaticWithIcons();
    this.renderSelectionUI();
  }

  // ─── Style Helpers ──────────────────────────────────────────────

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
    // Store nib params for fountain pen (and future directional pens)
    if (penConfig.nibAngle !== null) {
      style.nibAngle = this.currentNibAngle;
      style.nibThickness = this.currentNibThickness;
      style.nibPressure = this.currentNibPressure;
      style.useBarrelRotation = this.currentUseBarrelRotation;
    }
    // Store grain for stamp-based pens (pencil)
    if (penConfig.stamp) {
      style.grain = this.currentGrain;
    }
    // Store ink preset for fountain pen
    if (penConfig.inkStamp) {
      style.inkPreset = this.currentInkPreset;
    }
    // Store ink depletion for marker stamp pens (felt-tip)
    if (penConfig.markerStamp) {
      style.inkDepletion = this.currentInkDepletion;
    }
    return style;
  }

  private getCurrentStyleName(): string {
    return "_default";
  }

  // ─── Toolbar ────────────────────────────────────────────────────

  private createToolbarCallbacks(): ToolbarCallbacks {
    return {
      onToolChange: (tool: ActiveTool) => {
        if (this.activeTool === "lasso" && tool !== "lasso") {
          this.clearSelection();
        }
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
        this.currentInkDepletion = state.inkDepletion;
        this.renderer?.setCurrentInkPreset(state.inkPreset);
      },
      onUndo: () => {
        this.undo();
      },
      onRedo: () => {
        this.redo();
      },
      onPaste: () => {
        this.pasteClipboard();
      },
      onAddPage: () => {
        this.addPage();
      },
      onOpenDocumentSettings: () => {
        this.openDocumentSettings();
      },
      onPresetSave: (presets, activePresetId) => {
        this.settings.penPresets = presets;
        this.settings.activePresetId = activePresetId;
        this.onSettingsChange?.({ penPresets: presets, activePresetId });
      },
      onPositionChange: (position) => {
        this.deviceSettings.toolbarPosition = position;
        this.onDeviceSettingsChange?.({ toolbarPosition: position });
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

  // ─── Input Callbacks ────────────────────────────────────────────

  private getActivePageRect(): PageRect | undefined {
    if (this.activeStrokePageIndex < 0 || this.activeStrokePageIndex >= this.pageLayout.length) {
      return undefined;
    }
    return this.pageLayout[this.activeStrokePageIndex];
  }

  /**
   * Compute whether strokes on the active page should use dark-mode colors,
   * based on the page's background color and theme settings.
   */
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
          // Outside all pages — treat as pan gesture
          this.activeStrokePageIndex = -1;
          this.inputManager?.switchToPan(point);
          return;
        }

        if (this.activeTool === "lasso") {
          // If there's an active selection, test if the tap is on it
          if (this.selectionState) {
            const hit = hitTestSelection(
              point.x, point.y,
              this.selectionState.boundingBox,
              this.camera,
            );

            if (hit.type === "handle") {
              this.selectionDragType = "resize";
              this.selectionDragHandle = hit.corner;
              this.selectionDragStart = { x: point.x, y: point.y };
              return;
            }

            if (hit.type === "midpoint") {
              this.selectionDragType = "stretch";
              this.selectionDragMidpoint = hit.edge;
              this.selectionDragStart = { x: point.x, y: point.y };
              return;
            }

            if (hit.type === "rotation") {
              this.selectionDragType = "rotate";
              this.selectionDragStart = { x: point.x, y: point.y };
              // Compute initial angle from bbox center to pointer
              const bbox = this.selectionState.boundingBox;
              const center = this.camera.worldToScreen(
                bbox.x + bbox.width / 2,
                bbox.y + bbox.height / 2,
              );
              this.selectionRotateBaseAngle = Math.atan2(
                point.y - center.y,
                point.x - center.x,
              );
              return;
            }

            if (hit.type === "inside") {
              this.selectionDragType = "move";
              this.selectionDragStart = { x: point.x, y: point.y };
              return;
            }

            // Outside: deselect and start a new lasso
            this.clearSelection();
          }

          this.lassoPoints = [{ x: world.x, y: world.y }];
          this.lassoStartScreen = { x: point.x, y: point.y };
          this.lassoPageIndex = pageIndex;
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

        if (this.activeTool === "lasso") {
          if (this.selectionDragType && this.selectionDragStart) {
            const last = points[points.length - 1];
            this.handleSelectionDrag(last.x, last.y);
            return;
          }

          for (const point of points) {
            const world = this.camera.screenToWorld(point.x, point.y);
            this.lassoPoints.push({ x: world.x, y: world.y });
          }

          // Update incremental preview every ~10 points
          if (this.lassoPoints.length >= 3 &&
              this.lassoPoints.length - this.lassoPreviewAt >= 10) {
            this.lassoPreviewAt = this.lassoPoints.length;
            this.lassoHighlights = previewLassoSelection(
              this.lassoPoints,
              this.document.strokes,
              this.spatialIndex,
              0.75,
              this.lassoPageIndex,
            );
          }

          this.renderer?.renderLassoPath(this.lassoPoints, this.lassoHighlights);
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

        // Render prediction
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

        if (this.activeTool === "lasso") {
          if (this.selectionDragType) {
            this.commitSelectionDrag(point.x, point.y);
            return;
          }

          // Detect tap: minimal screen movement from start
          if (this.lassoStartScreen) {
            const dx = point.x - this.lassoStartScreen.x;
            const dy = point.y - this.lassoStartScreen.y;
            if (dx * dx + dy * dy < TAP_DISTANCE_SQ) {
              this.handleLassoTap(point);
              return;
            }
          }

          const world = this.camera.screenToWorld(point.x, point.y);
          this.lassoPoints.push({ x: world.x, y: world.y });
          this.finalizeLassoSelection();
          return;
        }

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
            // Compute bbox margin for stamp-based pens: particles scatter
            // well beyond center points, especially with tilt.
            const penConfig = getPenConfig(style.pen);
            let bboxMargin = style.width * 2; // base margin for stroke width
            if (penConfig.stamp && penConfig.tiltConfig) {
              // Max scatter spread per side from center: radius × (crossAxisMultiplier + maxSkewOffset).
              // Use width (diameter) × factor for generous coverage, ensuring the spatial index
              // routes strokes to all tiles that could contain scattered particles.
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
        if (this.activeTool === "lasso") {
          if (this.selectionDragType) {
            this.cancelSelectionDrag();
          }
          this.lassoPoints = [];
          this.lassoStartScreen = null;
          this.lassoHighlights = [];
          this.lassoPreviewAt = 0;
          this.lassoPageIndex = -1;
          this.renderer?.clearActiveLayer();
          return;
        }
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
        // Snapshot base on first move if not set (e.g. pinch-to-pan transition)
        if (!this.gestureBaseCamera) {
          this.gestureBaseCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
        }
        this.applyGestureTransform();
      },

      onPanEnd: () => {
        this.midGestureRenderPending = false;
        this.gestureBaseCamera = null;
        this.renderer?.clearGestureTransform();
        this.selectionOverlay?.clearTransform();
        this.requestStaticRender();
        this.renderSelectionUI();
      },

      onPinchMove: (centerX: number, centerY: number, scale: number, panDx: number, panDy: number) => {
        if (this.pinchBaseZoom === null) {
          this.pinchBaseZoom = this.camera.zoom;
        }
        // Apply pan first, then zoom
        this.camera.pan(panDx, panDy);
        const newZoom = this.pinchBaseZoom * scale;
        this.camera.zoomAt(centerX, centerY, newZoom);
        this.camera.clampPan(this.cssWidth, this.cssHeight);
        // Snapshot base on first pinch move
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
        this.selectionOverlay?.clearTransform();
        this.requestStaticRender();
        this.renderSelectionUI();
      },

      onTwoFingerTap: () => {
        this.undo();
      },

      onThreeFingerTap: () => {
        this.redo();
      },

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
        // Snapshot gesture base on first wheel event of a gesture
        if (!this.gestureBaseCamera) {
          this.gestureBaseCamera = { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom };
        }

        if (isPinch) {
          // Trackpad pinch or Ctrl+wheel → zoom at cursor
          const zoomFactor = Math.exp(-deltaY * 0.01);
          const newZoom = this.camera.zoom * zoomFactor;
          this.camera.zoomAt(screenX, screenY, newZoom);
        } else {
          // Regular scroll — hit-test to decide zoom vs pan
          const world = this.camera.screenToWorld(screenX, screenY);
          const pageIndex = findPageAtPoint(world.x, world.y, this.pageLayout);
          if (pageIndex !== -1) {
            // Over a page → zoom at cursor
            const zoomFactor = Math.exp(-deltaY * 0.005);
            const newZoom = this.camera.zoom * zoomFactor;
            this.camera.zoomAt(screenX, screenY, newZoom);
          } else {
            // Off-page → pan
            this.camera.pan(-deltaX, -deltaY);
          }
        }
        this.camera.clampPan(this.cssWidth, this.cssHeight);
        this.applyGestureTransform();
      },

      onWheelEnd: () => {
        this.midGestureRenderPending = false;
        this.gestureBaseCamera = null;
        this.renderer?.clearGestureTransform();
        this.selectionOverlay?.clearTransform();
        this.requestStaticRender();
        this.renderSelectionUI();
      },
    };
  }

  // ─── Lasso Selection ────────────────────────────────────────────

  private handleLassoTap(point: StrokePoint): void {
    this.renderer?.clearActiveLayer();
    this.lassoPoints = [];
    this.lassoStartScreen = null;
    this.lassoHighlights = [];
    this.lassoPreviewAt = 0;

    const world = this.camera.screenToWorld(point.x, point.y);
    const pageIndex = findPageAtPoint(world.x, world.y, this.pageLayout);
    const radius = TAP_HIT_RADIUS / this.camera.zoom;

    const hitId = findNearestStroke(
      world.x, world.y, radius,
      this.document.strokes, this.spatialIndex,
      pageIndex,
    );

    if (!hitId) {
      // Tap on empty space → deselect
      this.clearSelection();
      return;
    }

    // If a selection exists, toggle the tapped stroke (Phase 7)
    if (this.selectionState) {
      if (this.selectionState.strokeIds.has(hitId)) {
        // Remove from selection
        this.selectionState.strokeIds.delete(hitId);
        if (this.selectionState.strokeIds.size === 0) {
          this.clearSelection();
          return;
        }
      } else {
        // Add to selection (must be on same page)
        if (pageIndex === this.selectionState.pageIndex) {
          this.selectionState.strokeIds.add(hitId);
        }
      }
      // Update bbox and re-render
      this.selectionState.boundingBox = computeSelectionBBox(
        this.selectionState.strokeIds, this.document.strokes,
      );
      if (this.renderer) {
        this.renderer.excludeStrokeIds = this.selectionState.strokeIds;
        this.renderer.invalidateCache();
      }
      this.renderStaticWithIcons();
      this.renderSelectionUI();
      return;
    }

    // No existing selection → select the single tapped stroke
    const strokeIds = new Set([hitId]);
    const stroke = this.document.strokes.find(s => s.id === hitId);
    if (!stroke) return;

    const boundingBox = computeSelectionBBox(strokeIds, this.document.strokes);
    this.selectionState = { strokeIds, boundingBox, pageIndex: stroke.pageIndex };

    if (this.renderer) {
      this.renderer.excludeStrokeIds = strokeIds;
      for (const id of strokeIds) {
        this.renderer.invalidateCache(id);
      }
    }
    this.renderStaticWithIcons();
    this.renderSelectionUI();
    this.selectionActionBar?.show();
  }

  private finalizeLassoSelection(): void {
    this.renderer?.clearActiveLayer();

    if (this.lassoPoints.length < 3) {
      this.lassoPoints = [];
      this.lassoPageIndex = -1;
      return;
    }

    const selectedIds = selectStrokesInLasso(
      this.lassoPoints,
      this.document.strokes,
      this.spatialIndex,
      0.75,
      this.lassoPageIndex,
    );

    const pageIndex = this.lassoPageIndex;
    this.lassoPoints = [];
    this.lassoStartScreen = null;
    this.lassoHighlights = [];
    this.lassoPreviewAt = 0;
    this.lassoPageIndex = -1;

    if (selectedIds.length === 0) return;

    const strokeIds = new Set(selectedIds);
    const boundingBox = computeSelectionBBox(strokeIds, this.document.strokes);

    this.selectionState = { strokeIds, boundingBox, pageIndex };

    // Exclude selected strokes from the static layer and re-render
    if (this.renderer) {
      this.renderer.excludeStrokeIds = strokeIds;
      for (const id of strokeIds) {
        this.renderer.invalidateCache(id);
      }
    }
    this.renderStaticWithIcons();
    this.renderSelectionUI();
    this.selectionActionBar?.show();
  }

  private clearSelection(): void {
    if (!this.selectionState) return;
    const oldIds = this.selectionState.strokeIds;
    this.selectionState = null;
    this.selectionOverlay?.clear();
    this.selectionActionBar?.hide();

    // Re-include strokes in the static layer
    if (this.renderer) {
      this.renderer.excludeStrokeIds = null;
      for (const id of oldIds) {
        this.renderer.invalidateCache(id);
      }
    }
    this.renderStaticWithIcons();
  }

  private renderSelectionUI(): void {
    if (!this.selectionState || !this.selectionOverlay) return;

    // Get the selected strokes for rendering on the overlay
    const selectedStrokes = this.document.strokes.filter(
      s => this.selectionState!.strokeIds.has(s.id)
    );

    this.selectionOverlay.render(
      this.selectionState.boundingBox,
      this.camera,
      (ctx) => {
        this.renderer?.renderStrokesToExternalCanvas(
          ctx, selectedStrokes, this.document, this.pageLayout,
        );
      },
    );
  }

  /**
   * During a move/resize drag, apply a CSS transform to the selection overlay
   * for GPU-accelerated preview. The actual stroke data is modified on commit.
   */
  private handleSelectionDrag(screenX: number, screenY: number): void {
    if (!this.selectionDragStart || !this.selectionState) return;

    const dx = screenX - this.selectionDragStart.x;
    const dy = screenY - this.selectionDragStart.y;

    if (this.selectionDragType === "move") {
      this.selectionOverlay?.setTransform(dx, dy, 1);
    } else if (this.selectionDragType === "resize" && this.selectionDragHandle) {
      // Compute scale from the anchor corner (opposite of the dragged handle)
      const bbox = this.selectionState.boundingBox;
      const anchorWorld = this.getResizeAnchor(this.selectionDragHandle, bbox);
      const anchorScreen = this.camera.worldToScreen(anchorWorld.x, anchorWorld.y);
      const handleWorld = this.getDraggedHandlePos(this.selectionDragHandle, bbox);
      const handleScreen = this.camera.worldToScreen(handleWorld.x, handleWorld.y);

      // Original distance from anchor to handle
      const origDx = handleScreen.x - anchorScreen.x;
      const origDy = handleScreen.y - anchorScreen.y;
      const origDist = Math.sqrt(origDx * origDx + origDy * origDy);

      if (origDist < 1) return;

      // New distance (handle moved by dx, dy)
      const newDx = handleScreen.x + dx - anchorScreen.x;
      const newDy = handleScreen.y + dy - anchorScreen.y;
      const newDist = Math.sqrt(newDx * newDx + newDy * newDy);

      const scale = Math.max(0.1, newDist / origDist);

      // CSS transform: translate(tx,ty) scale(s) maps point (px,py) → (s*px+tx, s*py+ty).
      // To keep the anchor at (ax,ay) fixed: s*ax+tx = ax → tx = ax*(1-s).
      const tx = anchorScreen.x * (1 - scale);
      const ty = anchorScreen.y * (1 - scale);

      this.selectionOverlay?.setTransform(tx, ty, scale);
    } else if (this.selectionDragType === "stretch" && this.selectionDragMidpoint) {
      const bbox = this.selectionState.boundingBox;
      const edge = this.selectionDragMidpoint;

      const tl = this.camera.worldToScreen(bbox.x, bbox.y);
      const br = this.camera.worldToScreen(bbox.x + bbox.width, bbox.y + bbox.height);

      let sx = 1;
      let sy = 1;
      let anchorScreenX: number;
      let anchorScreenY: number;

      if (edge === "left" || edge === "right") {
        const origW = br.x - tl.x;
        if (origW < 1) return;
        anchorScreenX = edge === "right" ? tl.x : br.x;
        anchorScreenY = tl.y;
        const edgeScreenX = edge === "right" ? br.x : tl.x;
        sx = Math.max(0.1, (edgeScreenX + dx - anchorScreenX) / (edgeScreenX - anchorScreenX));
      } else {
        const origH = br.y - tl.y;
        if (origH < 1) return;
        anchorScreenX = tl.x;
        anchorScreenY = edge === "bottom" ? tl.y : br.y;
        const edgeScreenY = edge === "bottom" ? br.y : tl.y;
        sy = Math.max(0.1, (edgeScreenY + dy - anchorScreenY) / (edgeScreenY - anchorScreenY));
      }

      const tx = anchorScreenX * (1 - sx);
      const ty = anchorScreenY * (1 - sy);
      this.selectionOverlay?.setStretchTransform(tx, ty, sx, sy);
    } else if (this.selectionDragType === "rotate") {
      const bbox = this.selectionState.boundingBox;
      const center = this.camera.worldToScreen(
        bbox.x + bbox.width / 2,
        bbox.y + bbox.height / 2,
      );
      const currentAngle = Math.atan2(screenY - center.y, screenX - center.x);
      const angle = snapAngle(currentAngle - this.selectionRotateBaseAngle);

      // CSS rotate around the bbox center
      this.selectionOverlay?.setRotateTransform(center.x, center.y, angle);
    }
  }

  private commitSelectionDrag(screenX: number, screenY: number): void {
    if (!this.selectionState || !this.selectionDragStart) {
      this.cancelSelectionDrag();
      return;
    }

    const dx = screenX - this.selectionDragStart.x;
    const dy = screenY - this.selectionDragStart.y;
    const undoEntries: { strokeId: string; before: Stroke; after: Stroke }[] = [];

    if (this.selectionDragType === "move") {
      // Convert screen delta to world delta
      const worldDx = dx / this.camera.zoom;
      const worldDy = dy / this.camera.zoom;

      // Detect cross-page move: check what page the new center lands on
      const oldBBox = this.selectionState.boundingBox;
      const newCenterX = oldBBox.x + oldBBox.width / 2 + worldDx;
      const newCenterY = oldBBox.y + oldBBox.height / 2 + worldDy;
      const targetPageIndex = findPageAtPoint(newCenterX, newCenterY, this.pageLayout);
      const crossPage = targetPageIndex >= 0 && targetPageIndex !== this.selectionState.pageIndex;

      for (const stroke of this.document.strokes) {
        if (!this.selectionState.strokeIds.has(stroke.id)) continue;

        const before = cloneStroke(stroke);
        const after = translateStroke(stroke, worldDx, worldDy);
        if (crossPage) {
          after.pageIndex = targetPageIndex;
        }

        // Apply in-place
        Object.assign(stroke, after);
        clearCompressedCache(stroke);
        this.spatialIndex.remove(stroke.id);
        this.spatialIndex.insert(stroke, this.document.strokes.indexOf(stroke));

        undoEntries.push({ strokeId: stroke.id, before, after: cloneStroke(stroke) });
      }

      if (crossPage) {
        this.selectionState.pageIndex = targetPageIndex;
      }
    } else if (this.selectionDragType === "resize" && this.selectionDragHandle) {
      const bbox = this.selectionState.boundingBox;
      const anchorWorld = this.getResizeAnchor(this.selectionDragHandle, bbox);
      const anchorScreen = this.camera.worldToScreen(anchorWorld.x, anchorWorld.y);
      const handleWorld = this.getDraggedHandlePos(this.selectionDragHandle, bbox);
      const handleScreen = this.camera.worldToScreen(handleWorld.x, handleWorld.y);

      const origDx = handleScreen.x - anchorScreen.x;
      const origDy = handleScreen.y - anchorScreen.y;
      const origDist = Math.sqrt(origDx * origDx + origDy * origDy);

      if (origDist >= 1) {
        const newDx = handleScreen.x + dx - anchorScreen.x;
        const newDy = handleScreen.y + dy - anchorScreen.y;
        const newDist = Math.sqrt(newDx * newDx + newDy * newDy);
        const scale = Math.max(0.1, newDist / origDist);

        for (const stroke of this.document.strokes) {
          if (!this.selectionState.strokeIds.has(stroke.id)) continue;

          const before = cloneStroke(stroke);
          const after = scaleStroke(stroke, anchorWorld.x, anchorWorld.y, scale, true, this.document.styles);

          Object.assign(stroke, after);
          clearCompressedCache(stroke);
          this.spatialIndex.remove(stroke.id);
          this.spatialIndex.insert(stroke, this.document.strokes.indexOf(stroke));

          undoEntries.push({ strokeId: stroke.id, before, after: cloneStroke(stroke) });
        }
      }
    } else if (this.selectionDragType === "stretch" && this.selectionDragMidpoint) {
      const bbox = this.selectionState.boundingBox;
      const edge = this.selectionDragMidpoint;

      // Compute anchor and scale in world space
      let anchorWorldX: number;
      let anchorWorldY: number;
      let sx = 1;
      let sy = 1;

      if (edge === "left" || edge === "right") {
        anchorWorldX = edge === "right" ? bbox.x : bbox.x + bbox.width;
        anchorWorldY = bbox.y;
        const edgeWorldX = edge === "right" ? bbox.x + bbox.width : bbox.x;
        const anchorScreen = this.camera.worldToScreen(anchorWorldX, anchorWorldY);
        const edgeScreen = this.camera.worldToScreen(edgeWorldX, anchorWorldY);
        const origW = edgeScreen.x - anchorScreen.x;
        if (Math.abs(origW) >= 1) {
          sx = (edgeScreen.x + dx - anchorScreen.x) / origW;
          sx = Math.max(0.1, sx);
        }
      } else {
        anchorWorldX = bbox.x;
        anchorWorldY = edge === "bottom" ? bbox.y : bbox.y + bbox.height;
        const edgeWorldY = edge === "bottom" ? bbox.y + bbox.height : bbox.y;
        const anchorScreen = this.camera.worldToScreen(anchorWorldX, anchorWorldY);
        const edgeScreen = this.camera.worldToScreen(anchorWorldX, edgeWorldY);
        const origH = edgeScreen.y - anchorScreen.y;
        if (Math.abs(origH) >= 1) {
          sy = (edgeScreen.y + dy - anchorScreen.y) / origH;
          sy = Math.max(0.1, sy);
        }
      }

      if (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
        for (const stroke of this.document.strokes) {
          if (!this.selectionState.strokeIds.has(stroke.id)) continue;

          const before = cloneStroke(stroke);
          const after = stretchStroke(stroke, anchorWorldX, anchorWorldY, sx, sy, this.document.styles);

          Object.assign(stroke, after);
          clearCompressedCache(stroke);
          this.spatialIndex.remove(stroke.id);
          this.spatialIndex.insert(stroke, this.document.strokes.indexOf(stroke));

          undoEntries.push({ strokeId: stroke.id, before, after: cloneStroke(stroke) });
        }
      }
    } else if (this.selectionDragType === "rotate") {
      const bbox = this.selectionState.boundingBox;
      const centerScreen = this.camera.worldToScreen(
        bbox.x + bbox.width / 2,
        bbox.y + bbox.height / 2,
      );
      const currentAngle = Math.atan2(
        screenY - centerScreen.y,
        screenX - centerScreen.x,
      );
      const angle = snapAngle(currentAngle - this.selectionRotateBaseAngle);

      if (Math.abs(angle) > 0.001) {
        const centerWorldX = bbox.x + bbox.width / 2;
        const centerWorldY = bbox.y + bbox.height / 2;

        for (const stroke of this.document.strokes) {
          if (!this.selectionState.strokeIds.has(stroke.id)) continue;

          const before = cloneStroke(stroke);
          const after = rotateStroke(stroke, centerWorldX, centerWorldY, angle, this.document.styles);

          Object.assign(stroke, after);
          clearCompressedCache(stroke);
          this.spatialIndex.remove(stroke.id);
          this.spatialIndex.insert(stroke, this.document.strokes.indexOf(stroke));

          undoEntries.push({ strokeId: stroke.id, before, after: cloneStroke(stroke) });
        }
      }
    }

    if (undoEntries.length > 0) {
      // Invalidate all tiles — strokes moved, so both old and new position tiles need re-render
      this.renderer?.invalidateCache();
      this.undoManager.pushTransformStrokes(undoEntries);
      this.toolbar?.refreshUndoRedo();
      this.requestSave();
    }

    // Update selection bounding box to reflect new positions
    this.selectionState.boundingBox = computeSelectionBBox(
      this.selectionState.strokeIds,
      this.document.strokes,
    );

    this.selectionOverlay?.clearTransform();
    this.selectionDragType = null;
    this.selectionDragHandle = null;
    this.selectionDragMidpoint = null;
    this.selectionDragStart = null;
    this.renderStaticWithIcons();
    this.renderSelectionUI();
  }

  private cancelSelectionDrag(): void {
    this.selectionOverlay?.clearTransform();
    this.selectionDragType = null;
    this.selectionDragHandle = null;
    this.selectionDragMidpoint = null;
    this.selectionDragStart = null;
    this.renderSelectionUI();
  }

  private getResizeAnchor(handle: HandleCorner, bbox: SelectionBBox): { x: number; y: number } {
    switch (handle) {
      case "top-left": return { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
      case "top-right": return { x: bbox.x, y: bbox.y + bbox.height };
      case "bottom-left": return { x: bbox.x + bbox.width, y: bbox.y };
      case "bottom-right": return { x: bbox.x, y: bbox.y };
    }
  }

  private getDraggedHandlePos(handle: HandleCorner, bbox: SelectionBBox): { x: number; y: number } {
    switch (handle) {
      case "top-left": return { x: bbox.x, y: bbox.y };
      case "top-right": return { x: bbox.x + bbox.width, y: bbox.y };
      case "bottom-left": return { x: bbox.x, y: bbox.y + bbox.height };
      case "bottom-right": return { x: bbox.x + bbox.width, y: bbox.y + bbox.height };
    }
  }

  // ─── Selection Property Changes ────────────────────────────────

  private applySelectionColor(colorId: string): void {
    if (!this.selectionState) return;
    this.applySelectionModification((stroke) => {
      const modified = cloneStroke(stroke);
      modified.styleOverrides = { ...modified.styleOverrides, color: colorId };
      return modified;
    });
  }

  private applySelectionPenType(penType: PenType): void {
    if (!this.selectionState) return;
    this.applySelectionModification((stroke) => {
      const modified = cloneStroke(stroke);
      modified.styleOverrides = { ...modified.styleOverrides, pen: penType };
      return modified;
    });
  }

  private applySelectionWidth(width: number): void {
    if (!this.selectionState) return;
    this.applySelectionModification((stroke) => {
      const modified = cloneStroke(stroke);
      modified.styleOverrides = { ...modified.styleOverrides, width };
      return modified;
    });
  }

  /**
   * Apply a modification function to all selected strokes.
   * Records undo entries and re-renders.
   */
  private applySelectionModification(modify: (stroke: Stroke) => Stroke): void {
    if (!this.selectionState) return;

    const undoEntries: { strokeId: string; before: Stroke; after: Stroke }[] = [];

    for (const stroke of this.document.strokes) {
      if (!this.selectionState.strokeIds.has(stroke.id)) continue;

      const before = cloneStroke(stroke);
      const after = modify(stroke);

      Object.assign(stroke, after);
      this.renderer?.invalidateCache(stroke.id);

      undoEntries.push({ strokeId: stroke.id, before, after: cloneStroke(stroke) });
    }

    if (undoEntries.length > 0) {
      this.undoManager.pushModifyStrokes(undoEntries);
      this.toolbar?.refreshUndoRedo();
      this.renderStaticWithIcons();
      this.renderSelectionUI();
      this.requestSave();
    }
  }

  private deleteSelection(): void {
    if (!this.selectionState) return;

    const removedEntries: { stroke: Stroke; index: number }[] = [];
    const sortedIndices: number[] = [];

    for (let i = 0; i < this.document.strokes.length; i++) {
      if (this.selectionState.strokeIds.has(this.document.strokes[i].id)) {
        sortedIndices.push(i);
      }
    }

    // Remove in reverse order to maintain indices
    for (let i = sortedIndices.length - 1; i >= 0; i--) {
      const idx = sortedIndices[i];
      const removed = this.document.strokes.splice(idx, 1)[0];
      this.spatialIndex.remove(removed.id);
      this.renderer?.invalidateCache(removed.id);
      removedEntries.push({ stroke: removed, index: idx });
    }

    if (removedEntries.length > 0) {
      this.undoManager.pushRemoveStrokes(removedEntries);
      this.toolbar?.refreshUndoRedo();
      this.requestSave();
    }

    this.clearSelection();
    this.renderStaticWithIcons();
  }

  // ─── Clipboard Operations ───────────────────────────────────────

  copySelection(): void {
    if (!this.selectionState || !this.clipboard) return;
    this.clipboard.push(
      this.selectionState.strokeIds,
      this.document.strokes,
      this.document.styles,
      this.selectionState.pageIndex,
    );
    this.toolbar?.showPasteButton(true, this.clipboard?.size ?? 0);
  }

  cutSelection(): void {
    if (!this.selectionState) return;
    this.copySelection();
    this.deleteSelection();
  }

  pasteClipboard(): void {
    if (!this.clipboard || this.clipboard.isEmpty) return;

    const result = this.clipboard.paste(
      this.camera,
      this.cssWidth,
      this.cssHeight,
      this.pageLayout,
      this.document.styles,
    );
    if (!result) return;

    // Add pasted strokes to document
    for (const stroke of result.strokes) {
      this.document.strokes.push(stroke);
      this.spatialIndex.insert(stroke, this.document.strokes.length - 1);
    }

    this.undoManager.pushAddStrokes(result.strokes);
    this.toolbar?.refreshUndoRedo();
    this.renderer?.invalidateCache();
    this.renderStaticWithIcons();
    this.requestSave();

    // Select the pasted strokes
    this.clearSelection();
    const strokeIds = new Set(result.strokes.map(s => s.id));
    const boundingBox = computeSelectionBBox(strokeIds, this.document.strokes);
    this.selectionState = { strokeIds, boundingBox, pageIndex: result.pageIndex };

    if (this.renderer) {
      this.renderer.excludeStrokeIds = strokeIds;
      for (const id of strokeIds) {
        this.renderer.invalidateCache(id);
      }
    }
    this.renderStaticWithIcons();
    this.renderSelectionUI();
    this.selectionActionBar?.show();

    // Update paste button badge (queue shrunk by 1)
    if (this.clipboard?.isEmpty) {
      this.toolbar?.showPasteButton(false);
    } else {
      this.toolbar?.showPasteButton(true, this.clipboard?.size ?? 0);
    }

    // Switch to lasso tool if not already
    if (this.activeTool !== "lasso") {
      this.activeTool = "lasso";
      this.toolbar?.setState({ activeTool: "lasso" });
    }
  }

  duplicateSelection(): void {
    if (!this.selectionState) return;

    // Deep clone selected strokes with new IDs and offset
    const newStrokes: Stroke[] = [];
    for (const stroke of this.document.strokes) {
      if (!this.selectionState.strokeIds.has(stroke.id)) continue;
      const moved = translateStroke(stroke, 20, 20);
      newStrokes.push({
        ...moved,
        id: generateStrokeId(),
      });
    }

    if (newStrokes.length === 0) return;

    // Add to document
    for (const stroke of newStrokes) {
      this.document.strokes.push(stroke);
      this.spatialIndex.insert(stroke, this.document.strokes.length - 1);
    }

    this.undoManager.pushAddStrokes(newStrokes);
    this.toolbar?.refreshUndoRedo();
    this.renderer?.invalidateCache();
    this.renderStaticWithIcons();
    this.requestSave();

    // Select the duplicates (not the originals)
    this.clearSelection();
    const strokeIds = new Set(newStrokes.map(s => s.id));
    const boundingBox = computeSelectionBBox(strokeIds, this.document.strokes);
    this.selectionState = {
      strokeIds,
      boundingBox,
      pageIndex: newStrokes[0].pageIndex,
    };

    if (this.renderer) {
      this.renderer.excludeStrokeIds = strokeIds;
      for (const id of strokeIds) {
        this.renderer.invalidateCache(id);
      }
    }
    this.renderStaticWithIcons();
    this.renderSelectionUI();
    this.selectionActionBar?.show();
  }

  /** Whether there is an active selection (for command checks) */
  hasSelection(): boolean {
    return this.selectionState !== null && this.selectionState.strokeIds.size > 0;
  }

  /** Whether the clipboard has content (for paste command check) */
  hasClipboardContent(): boolean {
    return this.clipboard !== null && !this.clipboard.isEmpty;
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
  if (current.inkDepletion !== base.inkDepletion) { overrides.inkDepletion = current.inkDepletion; has = true; }
  if (current.useBarrelRotation !== base.useBarrelRotation) { overrides.useBarrelRotation = current.useBarrelRotation; has = true; }

  return has ? overrides : undefined;
}
