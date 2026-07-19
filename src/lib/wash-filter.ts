import { Color, Filter, GlProgram, UniformGroup, defaultFilterVert, type Texture } from 'pixi.js'

/**
 * The watercolor "wash" pass: takes the stamped stroke silhouette (white dabs, shaped alpha) and
 * turns it into pigment. Everything that makes the wet brushes read as watercolor happens here:
 *
 * - **Wet edge** — silhouette alpha ramps from 0 to ~1 across each tip's soft rim, so partial
 *   alpha identifies the boundary zone; pigment density is boosted there, producing the darker
 *   ring where real washes deposit pigment as they dry.
 * - **Granulation** — the *selected paper texture* is sampled in canvas space; its valleys
 *   (darker paper) collect extra pigment, tying the stroke's mottling to the visible sheet.
 * - **Flat opacity** — density is computed once from the final silhouette, so overlapping dabs
 *   within a stroke never double-darken; separate strokes still multiply over each other.
 *
 * Output is premultiplied `(color * density, density)`, designed to sit under a 'multiply' blend:
 * `dst * (1 - density) + dst * color * density` — i.e. each pixel is pulled toward `color * dst`
 * by its pigment density, and density-0 pixels leave the canvas untouched.
 *
 * WebGL-only (GlProgram): the app initializes Pixi with its default WebGL renderer.
 */

const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform sampler2D uPaperTexture;

uniform vec3 uColor;
uniform float uOpacity;
uniform float uEdgeGain;
uniform float uGranulation;
uniform float uPaperScale;
uniform float uTime;
uniform float uWiggle;
uniform vec2 uPaperOffset;

// highp to match the default filter vertex shader's declarations — differing precisions on the
// same uniform across stages is a link error on some GL drivers.
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;

void main()
{
    // Frame-local coords plus uPaperOffset give true canvas coords even when the filter runs
    // over a stroke-sized offscreen texture whose frame origin isn't the stroke's canvas
    // position (the live-wiggle path); the full-canvas paths pass offset (0,0).
    vec2 canvasCoord = vTextureCoord * uInputSize.xy + uOutputFrame.xy + uPaperOffset;

    vec2 uv = vTextureCoord;
    if (uWiggle > 0.0) {
        // "Wet" edges: displace the silhouette lookup along a small circle. Deep inside the
        // stroke alpha is ~1 everywhere nearby so nothing changes; at the boundary the alpha
        // ramp shifts, so every edge point orbits its rest position. The phase varies smoothly
        // across the canvas, so neighboring points circle out of step — the edge crawls and
        // boils instead of sliding rigidly.
        float phase = sin(canvasCoord.x * 0.045) + sin(canvasCoord.y * 0.052)
            + sin((canvasCoord.x + canvasCoord.y) * 0.021);
        // Orbit speed is exactly 2*PI rad/s: one full circle per second, so the animation has
        // a precise 1s period — GIF export renders t in [0,1) and loops seamlessly.
        float angle = uTime * 6.2831853 + phase * 2.4;
        uv += vec2(cos(angle), sin(angle)) * uWiggle * uInputSize.zw;
    }

    float a = texture(uTexture, uv).a;
    if (a < 0.004) {
        finalColor = vec4(0.0);
        return;
    }

    float paper = texture(uPaperTexture, canvasCoord * uPaperScale).r;
    // Paper luminance recentered around a typical sheet tone and contrast-boosted into a
    // -1..1 grain signal; positive where the sheet dips (valleys hold more pigment).
    float grain = clamp((0.972 - paper) * 16.0, -1.0, 1.0);

    // Full coverage once the silhouette is solid; the smoothstep floor also eats stray
    // near-zero alpha from texture filtering.
    float body = smoothstep(0.04, 0.6, a);
    // The boundary zone: high at partial silhouette alpha, zero deep inside the stroke.
    float edge = smoothstep(0.05, 0.4, a) * (1.0 - smoothstep(0.5, 0.92, a));

    float density = uOpacity * body * (1.0 + uEdgeGain * edge);
    density *= 1.0 + uGranulation * grain;
    density = clamp(density, 0.0, 0.97);

    finalColor = vec4(uColor * density, density);
}
`

export interface WashSettings {
  color: string
  /** Base pigment density of the wash body (0..1). */
  opacity: number
  /** How much darker the boundary ring gets, as a fraction of body density. */
  edgeGain: number
  /** Depth of paper-driven mottling (0 = flat wash). */
  granulation: number
  /** Edge-orbit radius in px; 0 disables the animated wet edge. */
  wiggle?: number
  /** Animation clock in seconds — only meaningful when wiggle > 0. */
  time?: number
  /** Canvas-space origin of the filtered frame, for stroke-local offscreen textures. */
  paperOffset?: { x: number; y: number }
}

export class WashFilter extends Filter {
  private washUniforms: UniformGroup

  constructor(paper: Texture, paperTileSize: number) {
    const washUniforms = new UniformGroup({
      uColor: { value: new Float32Array([0, 0, 0]), type: 'vec3<f32>' },
      uOpacity: { value: 0.5, type: 'f32' },
      uEdgeGain: { value: 0, type: 'f32' },
      uGranulation: { value: 0, type: 'f32' },
      uPaperScale: { value: 1 / paperTileSize, type: 'f32' },
      uTime: { value: 0, type: 'f32' },
      uWiggle: { value: 0, type: 'f32' },
      uPaperOffset: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
    })

    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'watercolor-wash' }),
      // Filters default to resolution 1, which would run the wash at half res on hiDPI
      // displays and blur every wet stroke relative to the rest of the picture.
      resolution: 'inherit',
      antialias: 'inherit',
      resources: {
        washUniforms,
        uPaperTexture: paper.source,
        uPaperSampler: paper.source.style,
      },
    })

    this.washUniforms = washUniforms
  }

  /** Uniforms are per-stroke state — call before every render that uses this filter. */
  update(settings: WashSettings) {
    const uniforms = this.washUniforms.uniforms as {
      uColor: Float32Array
      uOpacity: number
      uEdgeGain: number
      uGranulation: number
      uTime: number
      uWiggle: number
      uPaperOffset: Float32Array
    }
    const [r, g, b] = new Color(settings.color).toArray()
    uniforms.uColor[0] = r
    uniforms.uColor[1] = g
    uniforms.uColor[2] = b
    uniforms.uOpacity = settings.opacity
    uniforms.uEdgeGain = settings.edgeGain
    uniforms.uGranulation = settings.granulation
    uniforms.uTime = settings.time ?? 0
    uniforms.uWiggle = settings.wiggle ?? 0
    uniforms.uPaperOffset[0] = settings.paperOffset?.x ?? 0
    uniforms.uPaperOffset[1] = settings.paperOffset?.y ?? 0
    this.washUniforms.update()
  }

  setPaper(paper: Texture) {
    this.resources.uPaperTexture = paper.source
    this.resources.uPaperSampler = paper.source.style
  }
}
