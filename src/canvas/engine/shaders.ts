/**
 * GLSL shader source strings for WebGL2Engine.
 *
 * All shaders expect premultiplied alpha throughout.
 * Vertex shaders receive a mat3 u_transform (column-major) for combined
 * model-view-projection in 2D.
 */

// ─── Solid Program ──────────────────────────────────────────────────
// Used for fillRect, fillPath (stencil fill pass), clipPath.

export const SOLID_VERT = `#version 300 es
precision highp float;
uniform mat3 u_transform;
in vec2 a_position;
void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
}
`;

export const SOLID_FRAG = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}
`;

// ─── Texture Program ────────────────────────────────────────────────
// Used for drawImage, drawOffscreen. Samples a texture with UV coords.

export const TEXTURE_VERT = `#version 300 es
precision highp float;
uniform mat3 u_transform;
in vec2 a_position;
in vec2 a_texcoord;
out vec2 v_texcoord;
void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_texcoord = a_texcoord;
}
`;

export const TEXTURE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_alpha;
in vec2 v_texcoord;
out vec4 fragColor;
void main() {
  vec4 tex = texture(u_texture, v_texcoord);
  fragColor = tex * u_alpha;
}
`;

// ─── Stamp Program (Instanced) ─────────────────────────────────────
// Draws many textured quads in one drawElementsInstanced call.
// Per-instance data: [x, y, size, opacity] via attribute divisor.

export const STAMP_VERT = `#version 300 es
precision highp float;
uniform mat3 u_transform;
in vec2 a_position;      // unit quad [-0.5, 0.5]
in vec2 a_texcoord;      // [0, 1] UVs
in vec4 a_instance;      // [x, y, size, opacity] per instance
out vec2 v_texcoord;
out float v_opacity;
void main() {
  vec2 worldPos = a_instance.xy + a_position * a_instance.z;
  vec3 pos = u_transform * vec3(worldPos, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_texcoord = a_texcoord;
  v_opacity = a_instance.w;
}
`;

export const STAMP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_alpha;
in vec2 v_texcoord;
in float v_opacity;
out vec4 fragColor;
void main() {
  vec4 tex = texture(u_texture, v_texcoord);
  fragColor = tex * v_opacity * u_alpha;
}
`;

// ─── Grain Program ──────────────────────────────────────────────────
// Fullscreen quad with tiled grain texture. Used with destination-out blend.

export const GRAIN_VERT = `#version 300 es
precision highp float;
in vec2 a_position;
in vec2 a_texcoord;
out vec2 v_texcoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texcoord = a_texcoord;
}
`;

export const GRAIN_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_strength;
uniform vec2 u_offset;
uniform vec2 u_scale;
in vec2 v_texcoord;
out vec4 fragColor;
void main() {
  vec2 uv = (v_texcoord + u_offset) * u_scale;
  float grain = texture(u_texture, uv).r;
  fragColor = vec4(grain * u_strength);
}
`;

// ─── Circle Program (Instanced) ────────────────────────────────────
// SDF circles for dot-grid backgrounds. Anti-aliased via smoothstep.

export const CIRCLE_VERT = `#version 300 es
precision highp float;
uniform mat3 u_transform;
in vec2 a_position;      // unit quad [-0.5, 0.5]
in vec3 a_instance;      // [cx, cy, radius] per instance
out vec2 v_localPos;
out float v_radius;
void main() {
  float size = a_instance.z * 2.0;
  vec2 worldPos = a_instance.xy + a_position * size;
  vec3 pos = u_transform * vec3(worldPos, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_localPos = a_position * size;
  v_radius = a_instance.z;
}
`;

export const CIRCLE_FRAG = `#version 300 es
precision highp float;
uniform vec4 u_color;
in vec2 v_localPos;
in float v_radius;
out vec4 fragColor;
void main() {
  float dist = length(v_localPos);
  float edge = fwidth(dist);
  float alpha = 1.0 - smoothstep(v_radius - edge, v_radius + edge, dist);
  fragColor = u_color * alpha;
}
`;

// ─── Line Program ───────────────────────────────────────────────────
// Thin quads with edge anti-aliasing for background lines.

export const LINE_VERT = `#version 300 es
precision highp float;
uniform mat3 u_transform;
in vec2 a_position;
in float a_edge;     // 0 at center, 1 at edge (for AA)
out float v_edge;
void main() {
  vec3 pos = u_transform * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_edge = a_edge;
}
`;

export const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 u_color;
in float v_edge;
out vec4 fragColor;
void main() {
  float alpha = 1.0 - smoothstep(0.5, 1.0, abs(v_edge));
  fragColor = u_color * alpha;
}
`;
