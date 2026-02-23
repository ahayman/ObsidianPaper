/**
 * Shader compilation, program linking, and uniform/attribute location caching.
 */

export interface ShaderProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  attributes: Map<string, number>;
}

/**
 * Compile a vertex + fragment shader pair and link into a program.
 * Throws on compilation/link errors.
 */
export function createShaderProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): ShaderProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);

  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    throw new Error(`Shader link failed: ${log}`);
  }

  // Shader objects can be detached/deleted after linking
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  // Cache all active uniform locations
  const uniforms = new Map<string, WebGLUniformLocation>();
  const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < numUniforms; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info) {
      const loc = gl.getUniformLocation(program, info.name);
      if (loc) uniforms.set(info.name, loc);
    }
  }

  // Cache all active attribute locations
  const attributes = new Map<string, number>();
  const numAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < numAttribs; i++) {
    const info = gl.getActiveAttrib(program, i);
    if (info) {
      attributes.set(info.name, gl.getAttribLocation(program, info.name));
    }
  }

  return { program, uniforms, attributes };
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const typeName = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
    throw new Error(`${typeName} shader compile failed: ${log}`);
  }

  return shader;
}

/**
 * Delete a shader program and free GPU resources.
 */
export function deleteShaderProgram(gl: WebGL2RenderingContext, sp: ShaderProgram): void {
  gl.deleteProgram(sp.program);
  sp.uniforms.clear();
  sp.attributes.clear();
}
