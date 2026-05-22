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

// Hard-circle stamp for pencil particles (matches Canvas2D arc() rendering).
export const STAMP_DISC_FRAG = `#version 300 es
precision highp float;
uniform float u_alpha;
uniform vec3 u_color;
in vec2 v_texcoord;
in float v_opacity;
out vec4 fragColor;
void main() {
  vec2 d = v_texcoord * 2.0 - 1.0;
  float dist = dot(d, d);
  if (dist > 1.0) discard;
  fragColor = vec4(u_color * v_opacity * u_alpha, v_opacity * u_alpha);
}
`;

// ─── Streak Program (Instanced) ─────────────────────────────────────
// Curved capsules (thick circular arcs, round ends) for felt-tip fibres.
// Per-instance data: a_streak0 [cx, cy, halfLen, radius],
//                    a_streak1 [cos, sin, opacity, curvature].
// curvature is signed (1/world-units); 0 = a straight capsule.

export const STAMP_STREAK_VERT = `#version 300 es
precision highp float;
uniform mat3 u_transform;
in vec2 a_position;      // unit quad [-0.5, 0.5]
in vec4 a_streak0;       // [cx, cy, halfLen, radius] per instance
in vec4 a_streak1;       // [cos, sin, opacity, curvature] per instance
out vec2 v_local;        // fibre-local, axis-aligned, world units
flat out vec3 v_dims;    // [halfLen, radius, curvature]
flat out float v_opacity;
void main() {
  float halfLen = a_streak0.z;
  float radius = a_streak0.w;
  float curv = a_streak1.w;
  float ac = abs(curv);
  // Expand the quad's cross-axis by the arc sagitta so a curved fibre fits.
  float sagitta = (ac > 1e-4) ? (1.0 / ac) * (1.0 - cos(halfLen * ac)) : 0.0;
  vec2 local = a_position * vec2(2.0 * (halfLen + radius), 2.0 * (radius + sagitta));
  float c = a_streak1.x;
  float s = a_streak1.y;
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec3 pos = u_transform * vec3(a_streak0.xy + rotated, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_local = local;
  v_dims = vec3(halfLen, radius, curv);
  v_opacity = a_streak1.z;
}
`;

// Thick-arc SDF (round ends), straight-capsule branch for curv ~ 0.
// Hard edge — mirrors the disc's discard (tile MSAA resolves it crisp).
export const STAMP_STREAK_FRAG = `#version 300 es
precision highp float;
uniform float u_alpha;
uniform vec3 u_color;
in vec2 v_local;
flat in vec3 v_dims;
flat in float v_opacity;
out vec4 fragColor;
void main() {
  float halfLen = v_dims.x;
  float radius = v_dims.y;
  float curv = v_dims.z;
  float ac = abs(curv);
  float d;
  if (ac < 1e-4) {
    // Straight capsule.
    float dx = max(abs(v_local.x) - halfLen, 0.0);
    d = length(vec2(dx, v_local.y)) - radius;
  } else {
    // Thick circular arc. Fold the curvature sign, then iq's arc SDF:
    // circle centre at (0,R), arc symmetric about +y, midpoint (0,R).
    float R = 1.0 / ac;
    vec2 p = vec2(v_local.x, v_local.y * sign(curv));
    vec2 q = vec2(abs(p.x), R - p.y);
    float ap = halfLen * ac;
    vec2 sc = vec2(sin(ap), cos(ap));
    float da = (sc.y * q.x > sc.x * q.y) ? length(q - sc * R) : abs(length(q) - R);
    d = da - radius;
  }
  if (d > 0.0) discard;
  fragColor = vec4(u_color * v_opacity * u_alpha, v_opacity * u_alpha);
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
  float grain = texture(u_texture, uv).a;
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
