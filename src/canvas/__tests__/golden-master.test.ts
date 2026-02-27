/**
 * Golden Master Characterization Tests for the Rendering Pipeline.
 *
 * Records the exact method call sequences produced by renderStrokeToEngine()
 * and renderStrokeToContext() for comprehensive pen/pipeline/LOD/shape combinations.
 * Snapshots are committed to git and serve as the regression safety net when
 * the rendering architecture is migrated to the material system.
 *
 * Test matrix:
 * - 10 style variants (all pen types + fountain variants + grain variants)
 * - 2 pipelines (basic, advanced)
 * - 4 LOD levels (0-3, with smart filtering)
 * - 5-9 stroke shapes per combination
 * - 1-3 pressure profiles per combination
 * - 2 rendering paths (RenderEngine, Canvas2D context)
 */

import { RecordingEngine } from "./RecordingEngine";
import { RecordingContext2D } from "./RecordingContext2D";
import {
  TEST_STYLES,
  getMeaningfulCombinations,
  generateStrokePoints,
  getPressureProfile,
  buildStroke,
  resetStrokeIds,
} from "./stroke-fixtures";
import {
  renderStrokeToEngine,
  renderStrokeToContext,
} from "../StrokeRenderCore";
import type {
  GrainRenderContext,
  StampRenderContext,
  EngineGrainContext,
  EngineStampContext,
} from "../StrokeRenderCore";
import { StrokePathCache } from "../../stroke/OutlineGenerator";
import type { RenderPipeline } from "../../types";
import type { TextureHandle } from "../engine/RenderEngine";
import type { LodLevel } from "../../stroke/StrokeSimplifier";

// ─── Mock Contexts ──────────────────────────────────────────

function makeEngineGrainContext(pipeline: RenderPipeline): EngineGrainContext {
  return {
    grainTexture:
      pipeline === "advanced"
        ? ({ width: 256, height: 256 } as TextureHandle)
        : null,
    strengthOverrides: new Map(),
    pipeline,
    canvasWidth: 2048,
    canvasHeight: 2048,
  };
}

function makeEngineStampContext(): EngineStampContext {
  return {
    getStampTexture: (_grainValue: number, _color: string) =>
      ({ width: 48, height: 48 }) as TextureHandle,
    getInkStampTexture: (_presetId: string | undefined, _color: string) =>
      ({ width: 64, height: 64 }) as TextureHandle,
  };
}

function makeGrainRenderContext(
  pipeline: RenderPipeline,
): GrainRenderContext {
  const mockPattern = {
    setTransform: () => {},
  } as unknown as CanvasPattern;

  const mockGenerator = {
    getPattern: () => mockPattern,
    getCanvas: () => null,
    initialize: () => {},
    destroy: () => {},
  };

  return {
    generator: pipeline === "advanced" ? (mockGenerator as any) : null,
    strengthOverrides: new Map(),
    pipeline,
    getOffscreen: (minW: number, minH: number) => {
      const ctx = new RecordingContext2D({ width: minW, height: minH });
      return {
        canvas: { width: minW, height: minH } as unknown as OffscreenCanvas,
        ctx: ctx as unknown as OffscreenCanvasRenderingContext2D,
      };
    },
    canvasWidth: 2048,
    canvasHeight: 2048,
  };
}

function makeStampRenderContext(): StampRenderContext {
  const mockStampTexture = {
    width: 48,
    height: 48,
  } as unknown as HTMLCanvasElement;

  const mockCache = {
    getColored: (_color: string) => mockStampTexture,
  };

  return {
    getCache: (_grainValue: number) => mockCache as any,
    getInkCache: (_presetId?: string) => mockCache as any,
  };
}

// ─── Test Suite: RenderEngine Path ──────────────────────────

describe("Golden Master: renderStrokeToEngine", () => {
  beforeEach(() => {
    resetStrokeIds();
  });

  const styleEntries = Object.entries(TEST_STYLES);

  for (const [styleName, style] of styleEntries) {
    for (const pipeline of ["basic", "advanced"] as const) {
      for (const lod of [0, 1, 2, 3] as const) {
        const combos = getMeaningfulCombinations(styleName, pipeline, lod);
        if (combos.length === 0) continue;

        describe(`${styleName} / ${pipeline} / LOD ${lod}`, () => {
          for (const { shape, pressure } of combos) {
            it(`${shape} / ${pressure}`, () => {
              const pressureProfile = getPressureProfile(pressure);
              const points = generateStrokePoints(shape, pressureProfile);
              const stroke = buildStroke(points, styleName);

              const engine = new RecordingEngine({
                width: 2048,
                height: 2048,
              });
              // Set a typical tile transform (2x zoom, offset)
              engine.setTransform(2, 0, 0, 2, -100, -100);
              engine.calls.length = 0; // Clear the setup call

              const pathCache = new StrokePathCache();
              const grainCtx = makeEngineGrainContext(pipeline);
              const stampCtx = makeEngineStampContext();

              renderStrokeToEngine(
                engine,
                stroke,
                { [styleName]: style },
                lod as LodLevel,
                false,
                pathCache,
                grainCtx,
                stampCtx,
              );

              expect(engine.snapshot()).toMatchSnapshot();
            });
          }
        });
      }
    }
  }
});

// ─── Test Suite: Canvas2D Context Path ──────────────────────

describe("Golden Master: renderStrokeToContext", () => {
  beforeEach(() => {
    resetStrokeIds();
  });

  const styleEntries = Object.entries(TEST_STYLES);

  for (const [styleName, style] of styleEntries) {
    for (const pipeline of ["basic", "advanced"] as const) {
      for (const lod of [0, 1, 2, 3] as const) {
        const combos = getMeaningfulCombinations(styleName, pipeline, lod);
        if (combos.length === 0) continue;

        describe(`${styleName} / ${pipeline} / LOD ${lod}`, () => {
          for (const { shape, pressure } of combos) {
            it(`${shape} / ${pressure}`, () => {
              const pressureProfile = getPressureProfile(pressure);
              const points = generateStrokePoints(shape, pressureProfile);
              const stroke = buildStroke(points, styleName);

              const ctx = new RecordingContext2D({
                width: 2048,
                height: 2048,
              });
              // Set a typical tile transform (2x zoom, offset)
              ctx.setTransform(2, 0, 0, 2, -100, -100);
              ctx.calls.length = 0; // Clear the setup call

              const pathCache = new StrokePathCache();
              const grainCtx = makeGrainRenderContext(pipeline);
              const stampCtx = makeStampRenderContext();

              renderStrokeToContext(
                ctx as unknown as CanvasRenderingContext2D,
                stroke,
                { [styleName]: style },
                lod as LodLevel,
                false,
                pathCache,
                grainCtx,
                stampCtx,
              );

              expect(ctx.snapshot()).toMatchSnapshot();
            });
          }
        });
      }
    }
  }
});
