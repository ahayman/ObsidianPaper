/**
 * Shared multisampled render target for tile rendering.
 *
 * Tiles render their content through one MSAA scratch buffer and resolve into a
 * caller-supplied single-sample texture, rather than each cached tile owning its
 * own multisampled renderbuffers. This collapses MSAA storage from O(tile count)
 * to one fixed allocation sized to the largest possible tile.
 *
 * Two modes, chosen once at construction:
 *  - "explicit": render into a multisampled FBO, then blitFramebuffer-resolve
 *    into the tile texture. Works on any WebGL2 context.
 *  - "implicit": with WEBGL_multisampled_render_to_texture, the tile texture is
 *    attached directly as an implicit-multisample colour attachment and the
 *    driver performs the resolve. On tile-based GPUs (e.g. iPad) the multisample
 *    samples stay in on-chip tile memory and never reach VRAM.
 */

interface MultisampledRenderToTextureExt {
  framebufferTexture2DMultisampleEXT(
    target: GLenum,
    attachment: GLenum,
    textarget: GLenum,
    texture: WebGLTexture | null,
    level: GLint,
    samples: GLsizei,
  ): void;
  renderbufferStorageMultisampleEXT(
    target: GLenum,
    samples: GLsizei,
    internalformat: GLenum,
    width: GLsizei,
    height: GLsizei,
  ): void;
}

export class MSAAResolver {
  /** "implicit" when WEBGL_multisampled_render_to_texture is usable. */
  readonly mode: "explicit" | "implicit";
  readonly samples: number;

  private gl: WebGL2RenderingContext;
  private size: number;

  // Shared by both modes — multisampled stencil for the stencil-cover fill.
  private stencilRB: WebGLRenderbuffer | null = null;

  // Explicit mode: render into msaaFBO, blit-resolve via resolveFBO.
  private msaaFBO: WebGLFramebuffer | null = null;
  private msaaColorRB: WebGLRenderbuffer | null = null;
  private resolveFBO: WebGLFramebuffer | null = null;

  // Implicit mode: render straight into scratchFBO (tile texture attached per call).
  private scratchFBO: WebGLFramebuffer | null = null;
  private ext: MultisampledRenderToTextureExt | null = null;

  /**
   * @param maxTileSize physical pixel size of the largest tile that will be
   *        rendered — the scratch is sized to this so any tile fits.
   */
  constructor(gl: WebGL2RenderingContext, maxTileSize: number, requestedSamples = 4) {
    this.gl = gl;
    this.size = maxTileSize;

    const maxSamples = (gl.getParameter(gl.MAX_SAMPLES) as number) || 4;
    this.samples = Math.max(1, Math.min(requestedSamples, maxSamples));

    const ext = gl.getExtension(
      "WEBGL_multisampled_render_to_texture",
    ) as MultisampledRenderToTextureExt | null;

    if (
      ext &&
      typeof ext.framebufferTexture2DMultisampleEXT === "function" &&
      typeof ext.renderbufferStorageMultisampleEXT === "function" &&
      this.tryInitImplicit(ext)
    ) {
      this.mode = "implicit";
    } else {
      this.initExplicit();
      this.mode = "explicit";
    }
  }

  /**
   * Bind the render target for a tile and set the viewport. The caller then
   * clears and draws tile content as usual.
   */
  beginTile(texture: WebGLTexture, width: number, height: number): void {
    const gl = this.gl;
    if (this.mode === "implicit") {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scratchFBO);
      this.ext!.framebufferTexture2DMultisampleEXT(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0, this.samples,
      );
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaaFBO);
    }
    gl.viewport(0, 0, width, height);
  }

  /**
   * Resolve the rendered tile into `texture`. Explicit mode blits the
   * multisampled buffer into the texture; implicit mode is a no-op (the driver
   * resolves when the texture is next sampled or re-attached).
   */
  endTile(texture: WebGLTexture, width: number, height: number): void {
    if (this.mode === "implicit") return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFBO);
    gl.framebufferTexture2D(
      gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
    );
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFBO);
    gl.blitFramebuffer(
      0, 0, width, height,
      0, 0, width, height,
      gl.COLOR_BUFFER_BIT, gl.NEAREST,
    );
  }

  destroy(): void {
    const gl = this.gl;
    if (this.msaaFBO) gl.deleteFramebuffer(this.msaaFBO);
    if (this.msaaColorRB) gl.deleteRenderbuffer(this.msaaColorRB);
    if (this.resolveFBO) gl.deleteFramebuffer(this.resolveFBO);
    if (this.scratchFBO) gl.deleteFramebuffer(this.scratchFBO);
    if (this.stencilRB) gl.deleteRenderbuffer(this.stencilRB);
    this.msaaFBO = null;
    this.msaaColorRB = null;
    this.resolveFBO = null;
    this.scratchFBO = null;
    this.stencilRB = null;
  }

  private initExplicit(): void {
    const gl = this.gl;
    const size = this.size;

    const msaaFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFBO);

    const msaaColorRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msaaColorRB);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, size, size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaColorRB);

    const stencilRB = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, stencilRB);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.STENCIL_INDEX8, size, size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencilRB);

    // Resolve FBO has no permanent attachment — the tile texture is pointed at
    // its COLOR_ATTACHMENT0 per blit in endTile().
    const resolveFBO = gl.createFramebuffer();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.msaaFBO = msaaFBO;
    this.msaaColorRB = msaaColorRB;
    this.stencilRB = stencilRB;
    this.resolveFBO = resolveFBO;
  }

  /**
   * Build the implicit-resolve scratch and verify the driver accepts the
   * combination (some drivers expose the extension but reject it). Returns false
   * — and frees anything it allocated — when the configuration is not complete,
   * so the caller can fall back to explicit mode.
   */
  private tryInitImplicit(ext: MultisampledRenderToTextureExt): boolean {
    const gl = this.gl;
    const scratchFBO = gl.createFramebuffer();
    const stencilRB = gl.createRenderbuffer();
    if (!scratchFBO || !stencilRB) {
      if (scratchFBO) gl.deleteFramebuffer(scratchFBO);
      if (stencilRB) gl.deleteRenderbuffer(stencilRB);
      return false;
    }

    gl.bindRenderbuffer(gl.RENDERBUFFER, stencilRB);
    ext.renderbufferStorageMultisampleEXT(
      gl.RENDERBUFFER, this.samples, gl.STENCIL_INDEX8, this.size, this.size,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFBO);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencilRB);

    // Probe completeness with a throwaway colour texture.
    let complete = false;
    const probe = gl.createTexture();
    if (probe) {
      gl.bindTexture(gl.TEXTURE_2D, probe);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      ext.framebufferTexture2DMultisampleEXT(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, probe, 0, this.samples,
      );
      complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      ext.framebufferTexture2DMultisampleEXT(
        gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0, this.samples,
      );
      gl.deleteTexture(probe);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!complete) {
      gl.deleteFramebuffer(scratchFBO);
      gl.deleteRenderbuffer(stencilRB);
      return false;
    }

    this.scratchFBO = scratchFBO;
    this.stencilRB = stencilRB;
    this.ext = ext;
    return true;
  }
}
