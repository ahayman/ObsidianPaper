/**
 * Material Resources
 *
 * Provides a unified resource interface for the MaterialExecutor.
 * Abstracts away the differences between Canvas2D and RenderEngine
 * resource contexts (GrainRenderContext/EngineGrainContext,
 * StampRenderContext/EngineStampContext) behind keyed lookups.
 *
 * MaterialResourceManager is the concrete implementation that wraps
 * the existing grain generators, stamp managers, and strength overrides.
 */

import type { TextureRef } from "./DrawingBackend";
import type { PenType } from "../types";

// ─── Interface ──────────────────────────────────────────────

/**
 * Keyed resource access for the material executor.
 *
 * Implementations bridge to either Canvas2D or RenderEngine resources.
 * This decouples rendering logic from resource plumbing — new pen types
 * register their resources here instead of threading through 7+ setters.
 */
export interface MaterialResources {
  /**
   * Get a grain texture by key.
   * Returns null if the texture is not registered or not initialized.
   */
  getGrainTexture(textureId: string): TextureRef | null;

  /**
   * Get a stamp texture for a given manager and color.
   * @param managerId - Which stamp manager (e.g. "pencil-scatter")
   * @param color - Hex color to colorize the stamp
   * @param grainValue - Grain slider value (0-1) for stamp variation
   * Returns null if the manager is not registered.
   */
  getStampTexture(managerId: string, color: string, grainValue: number): TextureRef | null;

  /**
   * Get an ink stamp texture for a given manager, preset, and color.
   * @param managerId - Which ink stamp manager (e.g. "ink-shading")
   * @param presetId - Ink preset ID (e.g. "standard", "iron-gall")
   * @param color - Hex color to colorize the stamp
   * Returns null if the manager is not registered.
   */
  getInkStampTexture(managerId: string, presetId: string | undefined, color: string): TextureRef | null;

  /**
   * Get the computed grain strength for a pen type.
   * Combines base strength (from config), grain slider value, and per-pen overrides.
   * @param penType - Pen type for strength override lookup
   * @param configStrength - Base grain strength from PenConfig
   * @param grainValue - Grain slider value from style (0-1)
   */
  getGrainStrength(penType: PenType, configStrength: number, grainValue: number): number;
}

// ─── Provider Interfaces ────────────────────────────────────

/**
 * Provider for grain textures. Wraps GrainTextureGenerator or
 * RenderEngine TextureHandle depending on the backend.
 */
export interface GrainTextureProvider {
  /** Get the texture ref. Returns null if not initialized. */
  getTexture(): TextureRef | null;
}

/**
 * Provider for stamp textures (pencil scatter).
 * Wraps StampTextureManager or EngineStampContext.
 */
export interface StampTextureProvider {
  /** Get a colored stamp texture for a grain slider value. */
  getTexture(color: string, grainValue: number): TextureRef | null;
}

/**
 * Provider for ink stamp textures (fountain pen shading).
 * Wraps InkStampTextureManager or EngineStampContext.
 */
export interface InkStampTextureProvider {
  /** Get a colored ink stamp texture for a preset. */
  getTexture(presetId: string | undefined, color: string): TextureRef | null;
}

// ─── Manager Implementation ─────────────────────────────────

/**
 * Concrete resource manager that stores providers in keyed maps.
 *
 * Usage:
 *   const resources = new MaterialResourceManager();
 *   resources.registerGrainTexture("pencil-graphite", grainProvider);
 *   resources.registerStampManager("pencil-scatter", stampProvider);
 *   resources.registerInkStampManager("ink-shading", inkProvider);
 *   resources.setStrengthOverride("pencil", 0.7);
 *
 *   // Later, in executeMaterial():
 *   const tex = resources.getGrainTexture("pencil-graphite");
 */
export class MaterialResourceManager implements MaterialResources {
  private grainTextures = new Map<string, GrainTextureProvider>();
  private stampManagers = new Map<string, StampTextureProvider>();
  private inkStampManagers = new Map<string, InkStampTextureProvider>();
  private strengthOverrides = new Map<PenType, number>();

  // ── Registration ──────────────────────────────────────────

  registerGrainTexture(id: string, provider: GrainTextureProvider): void {
    this.grainTextures.set(id, provider);
  }

  registerStampManager(id: string, provider: StampTextureProvider): void {
    this.stampManagers.set(id, provider);
  }

  registerInkStampManager(id: string, provider: InkStampTextureProvider): void {
    this.inkStampManagers.set(id, provider);
  }

  unregisterGrainTexture(id: string): void {
    this.grainTextures.delete(id);
  }

  unregisterStampManager(id: string): void {
    this.stampManagers.delete(id);
  }

  unregisterInkStampManager(id: string): void {
    this.inkStampManagers.delete(id);
  }

  // ── Strength Overrides ────────────────────────────────────

  setStrengthOverride(penType: PenType, strength: number): void {
    this.strengthOverrides.set(penType, strength);
  }

  clearStrengthOverride(penType: PenType): void {
    this.strengthOverrides.delete(penType);
  }

  getStrengthOverrides(): ReadonlyMap<PenType, number> {
    return this.strengthOverrides;
  }

  // ── MaterialResources Interface ───────────────────────────

  getGrainTexture(textureId: string): TextureRef | null {
    const provider = this.grainTextures.get(textureId);
    return provider?.getTexture() ?? null;
  }

  getStampTexture(managerId: string, color: string, grainValue: number): TextureRef | null {
    const provider = this.stampManagers.get(managerId);
    return provider?.getTexture(color, grainValue) ?? null;
  }

  getInkStampTexture(managerId: string, presetId: string | undefined, color: string): TextureRef | null {
    const provider = this.inkStampManagers.get(managerId);
    return provider?.getTexture(presetId, color) ?? null;
  }

  getGrainStrength(penType: PenType, configStrength: number, grainValue: number): number {
    const base = this.strengthOverrides.get(penType) ?? configStrength;
    return grainToTextureStrengthLocal(base, grainValue);
  }
}

// ─── Internal Helpers ───────────────────────────────────────

/**
 * Local copy of grainToTextureStrength to avoid circular dependencies.
 * Maps grain slider (0-1) to strength multiplier:
 *   grain=0 (coarse) → strength × 1.6
 *   grain=0.35 (default) → ~strength × 1.0
 *   grain=1 (fine) → strength × 0.2
 */
function grainToTextureStrengthLocal(baseStrength: number, grainValue: number): number {
  const clamped = Math.max(0, Math.min(1, grainValue));
  const multiplier = 1.6 + (0.2 - 1.6) * clamped; // lerp(1.6, 0.2, clamped)
  return Math.max(0, Math.min(1, baseStrength * multiplier));
}
