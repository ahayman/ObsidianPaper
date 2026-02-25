/**
 * Renders tile content (background + strokes) into FBO textures via WebGL2Engine.
 *
 * Shares the WebGL2 context on webglStaticCanvas with the compositor.
 * The FBO's color attachment IS the tile texture — zero-copy.
 *
 * Grain/stamp textures are persistent across tile renders, a key
 * WebGL advantage over the Canvas 2D path (not recreated per tile).
 */

import type { PaperDocument, RenderPipeline } from "../../types";
import type { PenType } from "../../types";
import type { SpatialIndex } from "../../spatial/SpatialIndex";
import type { PageRect } from "../../document/PageLayout";
import type { TileGridConfig } from "./TileTypes";
import { zoomBandBaseZoom } from "./TileTypes";
import type { GLTileEntry } from "./WebGLTileCache";
import { StrokePathCache } from "../../stroke/OutlineGenerator";
import { GrainTextureGenerator } from "../GrainTextureGenerator";
import { selectLodLevel } from "../../stroke/StrokeSimplifier";
import { resolvePageBackground } from "../../color/ColorUtils";
import { renderStrokeToEngine } from "../StrokeRenderCore";
import type { EngineGrainContext, EngineStampContext } from "../StrokeRenderCore";
import type { StampTextureManager } from "../../stamp/StampTextureManager";
import { InkStampTextureManager } from "../../stamp/InkStampTextureManager";
import { renderDeskFillEngine, renderPageBackgroundEngine } from "../BackgroundRenderer";
import type { TextureHandle } from "../engine/RenderEngine";
import { resolveMSAA } from "../engine/GLTextures";
import { WebGL2Engine } from "../engine/WebGL2Engine";

function bboxOverlaps(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];
}

export class WebGLTileEngine {
  private engine: WebGL2Engine;
  private gl: WebGL2RenderingContext;
  private config: TileGridConfig;
  private pathCache: StrokePathCache;
  private valid = true;

  // Grain
  private grainGenerator: GrainTextureGenerator | null = null;
  private grainStrengthOverrides = new Map<PenType, number>();
  private engineGrainTexture: TextureHandle | null = null;
  private pipeline: RenderPipeline = "basic";

  // Stamps — persistent across tile renders (key WebGL advantage)
  private stampManager: StampTextureManager | null = null;
  private inkStampManager: InkStampTextureManager | null = null;
  private stampTextureCache = new Map<string, TextureHandle>();

  constructor(canvas: HTMLCanvasElement, config: TileGridConfig, pathCache: StrokePathCache) {
    this.config = config;
    this.pathCache = pathCache;
    this.engine = new WebGL2Engine(canvas, { preserveDrawingBuffer: true });
    // Cache the GL context — browsers return the same object for the same canvas
    this.gl = canvas.getContext("webgl2")!;
    this.setupContextLoss(canvas);
  }

  getGL(): WebGL2RenderingContext {
    return this.gl;
  }

  isValid(): boolean {
    return this.valid && this.engine.isValid();
  }

  /** Invalidate GLState caches after external GL modifications (e.g. compositor). */
  resetState(): void {
    this.engine.resetState();
  }

  /**
   * Render tile content into the FBO associated with the given GLTileEntry.
   * The FBO's color texture IS the tile's cached texture — zero-copy.
   */
  renderTile(
    entry: GLTileEntry,
    doc: PaperDocument,
    pageLayout: PageRect[],
    spatialIndex: SpatialIndex,
    isDarkMode: boolean,
  ): void {
    if (!this.valid || !this.engine.isValid()) return;
    if (!entry.fbo && !entry.msaa) return; // Bitmap-uploaded tiles can't be FBO-rendered

    // Reset GLState caches — createOffscreenTarget (called by WebGLTileCache.allocate)
    // binds textures/FBOs via raw gl.* calls that bypass GLState tracking.
    // Without this, drawStamps() may skip its texture bind (stale cache hit)
    // and sample the tile's own color attachment instead of the stamp texture.
    this.engine.resetState();

    const engine = this.engine;
    const gl = this.gl;
    const tilePhysical = entry.textureWidth;
    const baseZoom = zoomBandBaseZoom(entry.renderedAtBand);
    const lod = selectLodLevel(baseZoom);

    // Bind the render FBO (MSAA if available, else regular) and set viewport.
    // We bypass engine.beginOffscreen() because we're using the tile entry's
    // own FBO (not one managed by the engine's offscreen map).
    const renderFBO = entry.msaa ? entry.msaa.msaaFBO : entry.fbo!.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, renderFBO);
    gl.viewport(0, 0, tilePhysical, tilePhysical);
    engine.setViewport(tilePhysical, tilePhysical);

    engine.setTransform(1, 0, 0, 1, 0, 0);
    engine.clear();

    // Transform: world coords → tile pixel coords
    const scale = tilePhysical / this.config.tileWorldSize;
    const tx = -entry.worldBounds[0] * scale;
    const ty = -entry.worldBounds[1] * scale;
    engine.setTransform(scale, 0, 0, scale, tx, ty);

    const lineScale = this.config.tileWorldSize / tilePhysical;

    // Phase 1: Background
    renderDeskFillEngine(engine, entry.worldBounds, isDarkMode);

    for (const pageRect of pageLayout) {
      const pageBbox: [number, number, number, number] = [
        pageRect.x, pageRect.y,
        pageRect.x + pageRect.width, pageRect.y + pageRect.height,
      ];
      if (!bboxOverlaps(pageBbox, entry.worldBounds)) continue;

      const page = doc.pages[pageRect.pageIndex];
      if (!page) continue;

      renderPageBackgroundEngine(engine, page, pageRect, isDarkMode, lineScale);
    }

    // Phase 2: Strokes
    const strokeIds = spatialIndex.queryRect(
      entry.worldBounds[0], entry.worldBounds[1],
      entry.worldBounds[2], entry.worldBounds[3],
    );

    entry.strokeIds.clear();
    const strokeIdSet = new Set(strokeIds);
    const engineGrainCtx = this.getEngineGrainContext(tilePhysical, tilePhysical);
    const engineStampCtx = this.getEngineStampContext();

    for (const pageRect of pageLayout) {
      const pageBbox: [number, number, number, number] = [
        pageRect.x, pageRect.y,
        pageRect.x + pageRect.width, pageRect.y + pageRect.height,
      ];
      if (!bboxOverlaps(pageBbox, entry.worldBounds)) continue;

      const page = doc.pages[pageRect.pageIndex];
      let pageDark = isDarkMode;
      if (page) {
        const { patternTheme } = resolvePageBackground(
          page.backgroundColor, page.backgroundColorTheme, isDarkMode,
        );
        pageDark = patternTheme === "dark";
      }

      engine.save();
      engine.clipRect(pageRect.x, pageRect.y, pageRect.width, pageRect.height);

      for (const stroke of doc.strokes) {
        if (stroke.pageIndex !== pageRect.pageIndex) continue;
        if (!strokeIdSet.has(stroke.id)) continue;

        renderStrokeToEngine(
          engine, stroke, doc.styles, lod, pageDark,
          this.pathCache, engineGrainCtx, engineStampCtx,
        );
        entry.strokeIds.add(stroke.id);
      }

      engine.restore();
    }

    // iPad TBDR optimization: discard stencil to avoid store-back to VRAM
    engine.invalidateFramebuffer();

    // Resolve MSAA → texture (blit multisampled renderbuffer to resolve FBO)
    if (entry.msaa) {
      resolveMSAA(gl, entry.msaa);
    }

    // Restore default framebuffer and canvas viewport
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const canvas = engine.getCanvas();
    gl.viewport(0, 0, canvas.width, canvas.height);
    engine.setViewport(canvas.width, canvas.height);
  }

  // ─── Config forwarding ─────────────────────────────────────

  setGrainGenerator(generator: GrainTextureGenerator | null): void {
    this.grainGenerator = generator;
    if (this.engineGrainTexture) {
      this.engine.deleteTexture(this.engineGrainTexture);
      this.engineGrainTexture = null;
    }
    if (generator && this.engine.isValid()) {
      const canvas = generator.getCanvas();
      if (canvas) {
        this.engineGrainTexture = this.engine.createGrainTexture(canvas);
      }
    }
  }

  setGrainStrength(penType: PenType, strength: number): void {
    this.grainStrengthOverrides.set(penType, strength);
  }

  setPipeline(pipeline: RenderPipeline): void {
    this.pipeline = pipeline;
  }

  setStampManager(manager: StampTextureManager | null): void {
    this.stampManager = manager;
    this.clearStampTextureCache();
  }

  setInkStampManager(manager: InkStampTextureManager | null): void {
    this.inkStampManager = manager;
    this.clearStampTextureCache();
  }

  // ─── Internal ──────────────────────────────────────────────

  private getEngineGrainContext(canvasWidth: number, canvasHeight: number): EngineGrainContext {
    return {
      grainTexture: this.engineGrainTexture,
      strengthOverrides: this.grainStrengthOverrides,
      pipeline: this.pipeline,
      canvasWidth,
      canvasHeight,
    };
  }

  private getEngineStampContext(): EngineStampContext | null {
    if (!this.stampManager || !this.engine.isValid()) return null;
    const engine = this.engine;
    const stampManager = this.stampManager;
    const textureCache = this.stampTextureCache;
    const inkStampManager = this.inkStampManager;

    return {
      getStampTexture: (grainValue: number, color: string): TextureHandle => {
        const key = `stamp-${grainValue}-${color}`;
        let tex = textureCache.get(key);
        if (!tex) {
          const cache = stampManager.getCache(grainValue);
          const colored = cache.getColored(color);
          tex = engine.createTexture(colored);
          textureCache.set(key, tex);
        }
        return tex;
      },
      getInkStampTexture: (presetId: string | undefined, color: string): TextureHandle => {
        let mgr = inkStampManager;
        if (!mgr) {
          mgr = new InkStampTextureManager();
        }
        const key = `ink-${presetId ?? "default"}-${color}`;
        let tex = textureCache.get(key);
        if (!tex) {
          const cache = mgr.getCache(presetId);
          const colored = cache.getColored(color);
          tex = engine.createTexture(colored);
          textureCache.set(key, tex);
        }
        return tex;
      },
    };
  }

  private clearStampTextureCache(): void {
    if (!this.engine.isValid()) return;
    for (const tex of this.stampTextureCache.values()) {
      this.engine.deleteTexture(tex);
    }
    this.stampTextureCache.clear();
  }

  private setupContextLoss(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.valid = false;
      this.engineGrainTexture = null;
      this.stampTextureCache.clear();
    });

    canvas.addEventListener("webglcontextrestored", () => {
      this.valid = true;
      if (this.grainGenerator) {
        const grainCanvas = this.grainGenerator.getCanvas();
        if (grainCanvas) {
          this.engineGrainTexture = this.engine.createGrainTexture(grainCanvas);
        }
      }
    });
  }

  destroy(): void {
    this.clearStampTextureCache();
    if (this.engineGrainTexture && this.engine.isValid()) {
      this.engine.deleteTexture(this.engineGrainTexture);
      this.engineGrainTexture = null;
    }
    this.engine.destroy();
  }
}
