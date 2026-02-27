/**
 * Render Resources
 *
 * Bundles all rendering resource references needed by tile renderers
 * and the WebGL tile engine into a single object. Replaces the 5+
 * per-type setter methods previously forwarded through Renderer →
 * TiledStaticLayer → TileRenderer / WebGLTileEngine.
 *
 * This is a simple data container — not an abstraction layer.
 * TileRenderer and WebGLTileEngine read from it directly.
 */

import type { PenType, RenderPipeline } from "../types";
import type { GrainTextureGenerator } from "../canvas/GrainTextureGenerator";
import type { StampTextureManager } from "../stamp/StampTextureManager";
import type { InkStampTextureManager } from "../stamp/InkStampTextureManager";

/**
 * All rendering resources shared between the Renderer, TileRenderer,
 * and WebGLTileEngine. Passed as a single reference instead of 5+ setters.
 */
export interface RenderResources {
  grainGenerator: GrainTextureGenerator | null;
  grainStrengthOverrides: Map<PenType, number>;
  stampManager: StampTextureManager | null;
  inkStampManager: InkStampTextureManager | null;
  pipeline: RenderPipeline;
}
