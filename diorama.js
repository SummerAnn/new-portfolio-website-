import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
// [perf] removed: import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
import { prefersReducedMotion } from "./ui-motion.js";

/* ═══════════════════════════════════════════════════════════
   Research Township Diorama — Dense Edition
   Single landmass, four districts around a central plaza.
   Literature fully realized as reference cluster.
   ═══════════════════════════════════════════════════════════ */

const ROLES = [
  { name: "Literature",  body: 0x5b8fa8, accent: 0x467a92, roof: 0x3d6878,
    home: [-7, 0, -7], angle: Math.PI * 1.25 },
  { name: "Hypothesis",  body: 0xc49a5c, accent: 0xb08845, roof: 0x9a7638,
    home: [7, 0, -7],  angle: Math.PI * 1.75 },
  { name: "Design",      body: 0x8b7baa, accent: 0x766896, roof: 0x635882,
    home: [7, 0, 7],   angle: Math.PI * 0.25 },
  { name: "Analysis",    body: 0xc27c6e, accent: 0xad6a5d, roof: 0x955a4e,
    home: [-7, 0, 7],  angle: Math.PI * 0.75 },
];

const PLAZA_R = 1.2, WALK_SPEED = 0.016, BOB_SPEED = 1.6, BOB_AMP = 0.04;
const EXCHANGE_F = 240, WAITS = [150, 230, 190, 270];
const PLATFORM_R = 13;
const ANALYSIS_HILL_Y = 0.45;
const DEFAULT_CAM = { pos: [18, 13, 18], target: [0, 0, 0] };     // full-island overview (default)
const CLOSE_CAM   = { pos: [5, 4.5, 5], target: [0, 0.2, 0] };   // close miniature framing
const OVERVIEW_CAM = { pos: [30, 22, 30], target: [0, 0, 0] };    // far aerial

const canvas    = document.getElementById("dioramaCanvas");
const container = document.getElementById("dioramaContainer");
const loading   = document.getElementById("dioramaLoading");
const bubbleOverlay = document.getElementById("bubbleOverlay");
if (!canvas || !container) throw new Error("Diorama elements missing");

let renderer, scene, camera, controls, clock, composer;
let agents = [], buildings = [], tablePapers = [];
let animatedObjects = [];
let towerBlocks = [], towerHeight = 0;
let oceanUniforms = null;
let skyUniforms = null;
let bloomPassRef = null, colorGradeRef = null;
let reflectionRT = null, reflectionCamera = null, oceanMesh = null;
let _reflFrame = 0;
const _reflLook = new THREE.Vector3();
const _reflClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _reflClipArr = [_reflClip];
const _emptyClip = [];
let isReducedMotion = prefersReducedMotion();
let isVisible = false;
let bridgeMainEnd = null, bridgeIslandEnd = null; // set by createAdjacentIsland
let bridge2MainEnd = null, bridge2IslandEnd = null; // set by createGreekIsland
let bridge3MainEnd = null, bridge3IslandEnd = null; // set by createDesertIsland
let bridge4MainEnd = null, bridge4IslandEnd = null; // set by createHawaiiIsland
let bridge5DesertEnd = null, bridge5TreasureEnd = null; // set by createTreasureIsland
let selectedAgent = null;
let selectedObject = null;
let agentPopup = null;
let hoverLabel = null;
let hoveredObj = null;
let interactiveObjects = []; // { hitbox, type, label, group, data, reaction }
let cameraTarget = null; // { pos, look, progress }
let fireworks = []; // night-mode fireworks
let sunLight = null, hemiLightRef = null, rimLightRef = null, fillLightRef = null, sunGlowRef = null;
let isSunsetMode = false;
let isDawnMode = false;
let trainGroup = null, trainPath = null;
let snowSystem = null, santaSleigh = null, christmasGroup = null;
let agentsMuted = true;
let lighthouseBeams = []; // beam meshes + lights to dim during sunset
const obstacles = []; // {x, z, r} — collision circles for agent avoidance
const raycaster = new THREE.Raycaster();

// Utility: GLSL-style smoothstep for JS terrain generation
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
const pointerNDC = new THREE.Vector2();

/* ── Vignette Shader ───────────────────────────────────── */

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    darkness: { value: 0.30 },
    offset: { value: 1.1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * 2.0;
      float vig = clamp(1.0 - dot(uv, uv) * darkness, 0.0, 1.0);
      vig = mix(1.0 - darkness * 0.3, 1.0, vig);
      gl_FragColor = vec4(texel.rgb * vig, texel.a);
    }
  `,
};


/* ── Tilt-Shift Shader (miniature DOF) ───────────────── */

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    focusY: { value: 0.45 },     // screen-space Y of focus band (0=top, 1=bottom)
    bandWidth: { value: 0.18 },  // half-width of sharp band (15-20% of frame)
    blurMax: { value: 0.0018 },  // max blur per sample step (miniature DOF)
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float focusY;
    uniform float bandWidth;
    uniform float blurMax;
    varying vec2 vUv;
    void main() {
      float dist = abs(vUv.y - focusY);
      float blur = smoothstep(bandWidth, bandWidth + 0.28, dist) * blurMax;
      vec4 col = vec4(0.0);
      float total = 0.0;
      for (int i = -6; i <= 6; i++) {
        float w = 1.0 - abs(float(i)) / 7.0;
        col += texture2D(tDiffuse, vUv + vec2(0.0, float(i) * blur)) * w;
        total += w;
      }
      // Second axis (horizontal) for rounder bokeh
      vec4 col2 = vec4(0.0);
      float total2 = 0.0;
      for (int i = -4; i <= 4; i++) {
        float w = 1.0 - abs(float(i)) / 5.0;
        col2 += texture2D(tDiffuse, vUv + vec2(float(i) * blur * 0.6, 0.0)) * w;
        total2 += w;
      }
      gl_FragColor = mix(col / total, col2 / total2, 0.35);
    }
  `,
};

/* ── Color Grade Shader (warm, saturated, toylike) ───── */

const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.45 },    // vivid but not oversaturated
    brightness: { value: 0.03 },    // subtle lift only
    contrast: { value: 1.08 },      // gentle depth
    warmth: { value: new THREE.Vector3(0.02, 0.015, -0.01) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float brightness;
    uniform float contrast;
    uniform vec3 warmth;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 col = texel.rgb;
      col += brightness;
      col = (col - 0.5) * contrast + 0.5;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, saturation);
      float midMask = 1.0 - abs(lum - 0.5) * 2.0;
      col += warmth * midMask;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), texel.a);
    }
  `,
};

/* ── Toon Gradient Map ─────────────────────────────────── */

const gradientCanvas = document.createElement("canvas");
gradientCanvas.width = 2;
gradientCanvas.height = 1;
const gCtx = gradientCanvas.getContext("2d");
gCtx.fillStyle = "#d8d8d8"; gCtx.fillRect(0, 0, 1, 1);
gCtx.fillStyle = "#ffffff"; gCtx.fillRect(1, 0, 1, 1);
const gradientMap = new THREE.CanvasTexture(gradientCanvas);
gradientMap.minFilter = THREE.NearestFilter;
gradientMap.magFilter = THREE.NearestFilter;

/* ── Material helper (toon shading) ────────────────────── */

const mt = (color, opts = {}) => {
  if (opts.emissive || opts.emissiveIntensity) {
    return new THREE.MeshStandardMaterial({
      color, roughness: opts.roughness ?? 0.82, metalness: opts.metalness ?? 0.04,
      flatShading: true, ...opts,
    });
  }
  const mat = new THREE.MeshToonMaterial({
    color, gradientMap,
    ...(opts.transparent !== undefined ? { transparent: opts.transparent } : {}),
    ...(opts.opacity !== undefined ? { opacity: opts.opacity } : {}),
    ...(opts.vertexColors !== undefined ? { vertexColors: opts.vertexColors } : {}),
    ...(opts.side !== undefined ? { side: opts.side } : {}),
  });
  return mat;
};

/* ── Global wind system (shared uniform for all vegetation) ── */
const windUniforms = {
  uWindTime: { value: 0 },
  uGustPhase: { value: 0 },
};

// Create a wind-swaying toon material.
// heightFactor: how much sway scales with vertex height (1.0 = full tree, 0.5 = grass)
// swayAmp: base sway amplitude
// swaySpeed: oscillation speed
function mtWind(color, { heightFactor = 1.0, swayAmp = 0.03, swaySpeed = 1.0 } = {}) {
  const mat = new THREE.MeshToonMaterial({ color, gradientMap });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniforms.uWindTime;
    shader.uniforms.uGustPhase = windUniforms.uGustPhase;
    shader.uniforms.uSwayAmp = { value: swayAmp };
    shader.uniforms.uSwaySpeed = { value: swaySpeed };
    shader.uniforms.uHeightFactor = { value: heightFactor };
    // Inject wind displacement after begin_vertex
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // Wind sway — amplitude scales with vertex height
       float windT = uWindTime * uSwaySpeed;
       vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
       float phaseOffset = worldPos4.x * 0.5 + worldPos4.z * 0.3;
       float heightMask = clamp(position.y * uHeightFactor, 0.0, 1.0);
       // Gust modulation — low-frequency wave traveling across island
       float gustWave = sin(worldPos4.x * 0.08 + worldPos4.z * 0.06 + uGustPhase) * 0.5 + 0.5;
       float gustMod = 1.0 + gustWave * 0.6;
       float sway = sin(windT * 1.8 + phaseOffset) * uSwayAmp * heightMask * gustMod;
       float sway2 = sin(windT * 2.3 + phaseOffset * 1.3 + 1.0) * uSwayAmp * 0.4 * heightMask * gustMod;
       transformed.x += sway;
       transformed.z += sway2;
      `
    );
    // Declare the uniforms
    shader.vertexShader = 'uniform float uWindTime;\nuniform float uGustPhase;\nuniform float uSwayAmp;\nuniform float uSwaySpeed;\nuniform float uHeightFactor;\n' + shader.vertexShader;
  };
  return mat;
}

const WOOD = 0xe0d4be, WOOD_D = 0xd0c4a8, STONE = 0xddd6c8, CREAM = 0xfaf5ec;
const GREEN_L = 0x88cc78, GREEN_D = 0x70c060, GREEN_VD = 0x6ab858, TRUNK = 0xb0a078;
const WATER = 0x70c8e8, METAL = 0xb0b0c0;
const DIRT = 0xd8c8a0, DIRT_D = 0xc8b890;

/* ── Terrain shape functions (shared by all terrain geometry) ── */

// Simple 2D noise via sine superposition (no external library)
function noise2D(x, z) {
  return (
    Math.sin(x * 1.0 + z * 0.7) * 0.5 +
    Math.sin(x * 2.3 - z * 1.8) * 0.25 +
    Math.sin(x * 0.4 + z * 3.1) * 0.15 +
    Math.sin(x * 3.7 + z * 0.3) * 0.1
  );
}

// Irregular island radius as a function of angle
// Returns distance from center to island edge at a given angle
function getIslandRadius(angle) {
  const a = angle;
  let r = PLATFORM_R;
  // Base variation — gentle wobble
  r += Math.sin(a * 2.0 + 0.5) * 0.6;
  r += Math.sin(a * 5.0 + 1.2) * 0.3;
  r += Math.cos(a * 3.0 - 0.8) * 0.4;
  // Cove 1 — south-east (indentation)
  const cove1 = Math.exp(-Math.pow((a - 0.8) * 2.5, 2)) * 2.0;
  r -= cove1;
  // Cove 2 — north-west (smaller)
  const cove2 = Math.exp(-Math.pow((a - 3.8) * 3.0, 2)) * 1.5;
  r -= cove2;
  // Cove 3 — south (shallow)
  const cove3 = Math.exp(-Math.pow((a + 1.2) * 2.0, 2)) * 1.0;
  r -= cove3;
  // Peninsula — north-east spit extending out
  const pen = Math.exp(-Math.pow((a - 1.8) * 2.0, 2)) * 2.5;
  r += pen;
  // Wider beach area on the west side (radius slightly smaller = wider beach gap to water)
  r += Math.cos(a) * 0.5; // east side extends more, west pulls in slightly
  return Math.max(r, 5.0); // minimum radius to protect buildings
}

// Terrain height at world position (x, z)
// Returns y elevation for the ground mesh
function getTerrainHeight(x, z) {
  const dist = Math.sqrt(x * x + z * z);
  const angle = Math.atan2(z, x);
  const edgeR = getIslandRadius(angle);

  // Outside island = below water
  if (dist > edgeR + 0.5) return -0.3;

  let h = 0;

  // Low ridge running NE to SW
  const ridgeDist = Math.abs(x * 0.6 + z * 0.8 - 1.0);
  h += Math.max(0, 0.35 - ridgeDist * 0.12);

  // Gentle hollows/dips
  const h1Dist = Math.sqrt((x - 3) * (x - 3) + (z + 2) * (z + 2));
  h -= Math.max(0, 0.15 - h1Dist * 0.04);
  const h2Dist = Math.sqrt((x + 4) * (x + 4) + (z - 1) * (z - 1));
  h -= Math.max(0, 0.12 - h2Dist * 0.03);
  const h3Dist = Math.sqrt((x + 1) * (x + 1) + (z + 5) * (z + 5));
  h -= Math.max(0, 0.1 - h3Dist * 0.03);

  // Rock outcrop (small elevated bump)
  const rockDist = Math.sqrt((x - 7) * (x - 7) + (z + 4) * (z + 4));
  h += Math.max(0, 0.4 - rockDist * 0.2) * Math.max(0, 0.4 - rockDist * 0.2);

  // Gradual slope — high side NE, low toward SW/beach
  h += (x + z) * 0.012;

  // Analysis hill (keep existing)
  const aHillDist = Math.sqrt((x + 7) * (x + 7) + (z - 7) * (z - 7));
  if (aHillDist < 2.5) {
    h += Math.max(0, ANALYSIS_HILL_Y * (1 - (aHillDist / 2.5) * (aHillDist / 2.5)));
  }

  // Noise variation for natural feel
  h += noise2D(x * 0.5, z * 0.5) * 0.04;
  h += noise2D(x * 1.2, z * 1.2) * 0.02;

  // Taper to zero at island edge (smooth blend to beach)
  const edgeFade = Math.min(1, Math.max(0, (edgeR - dist) / 1.5));
  h *= edgeFade;

  return h;
}

// Check if a point is on the island (for placement logic)
function isOnIsland(x, z) {
  const dist = Math.sqrt(x * x + z * z);
  const angle = Math.atan2(z, x);
  return dist < getIslandRadius(angle) - 0.3;
}

/* ── Contact shadow (dark circle at object base) ──────── */
const contactShadowMat = new THREE.MeshBasicMaterial({
  color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false,
});
function makeContactShadow(radius) {
  const geo = new THREE.CircleGeometry(radius, 12);
  const shadow = new THREE.Mesh(geo, contactShadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.005;
  return shadow;
}

/* ═══════════════════════════════════════════════════════════
   Sprite Labels
   ═══════════════════════════════════════════════════════════ */

function makeLabel(text, color) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  roundRect(ctx, 128 - 58, 6, 116, 40, 10); ctx.fill();
  ctx.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 2.5;
  roundRect(ctx, 128 - 58, 6, 116, 40, 10); ctx.stroke();
  ctx.font = "bold 17px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillText(text, 128, 27);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  sprite.scale.set(0.5, 0.125, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function makeSpeechBubble() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.arc(32, 26, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#666";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(22 + i * 10, 26, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.arc(24, 42, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(20, 50, 3, 0, Math.PI * 2); ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  sprite.scale.set(0.28, 0.28, 1);
  sprite.renderOrder = 999;
  sprite.visible = false;
  return sprite;
}

/* ── Text speech bubble for dialogue ──────────────────── */
function makeDialogueBubble(text) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 160;
  const ctx = c.getContext("2d");

  // Rounded rect bubble
  const pad = 16, w = c.width - pad * 2, h = c.height - 40, r = 20;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.moveTo(pad + r, 12);
  ctx.lineTo(pad + w - r, 12);
  ctx.quadraticCurveTo(pad + w, 12, pad + w, 12 + r);
  ctx.lineTo(pad + w, 12 + h - r);
  ctx.quadraticCurveTo(pad + w, 12 + h, pad + w - r, 12 + h);
  ctx.lineTo(pad + r, 12 + h);
  ctx.quadraticCurveTo(pad, 12 + h, pad, 12 + h - r);
  ctx.lineTo(pad, 12 + r);
  ctx.quadraticCurveTo(pad, 12, pad + r, 12);
  ctx.fill();

  // Tail
  ctx.beginPath();
  ctx.moveTo(80, 12 + h);
  ctx.lineTo(64, 12 + h + 24);
  ctx.lineTo(104, 12 + h);
  ctx.fill();

  // Text
  ctx.fillStyle = "#333";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Word-wrap into lines
  const maxW = w - 32;
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const lineH = 34;
  const startY = 12 + h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => {
    ctx.fillText(l, c.width / 2, startY + i * lineH);
  });

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  sprite.scale.set(0.8, 0.25, 1);
  sprite.renderOrder = 999;
  sprite.visible = false;
  return sprite;
}

/* ── Casual exchange lines (shown during normal gatherings) ── */
const CASUAL_LINES = [
  "Have you seen the latest results?",
  "The variance is way too high.",
  "We should try a different baseline.",
  "I think the data is noisy here.",
  "What if we ablate that component?",
  "The reviewers will ask about this.",
  "Nice — that's a clean improvement.",
  "Let me check the confidence interval.",
  "Can we get more compute for this?",
  "This contradicts the prior work.",
  "I have an idea for the next run.",
  "The gradient is exploding again.",
  "Did you read the new preprint?",
  "We need a better evaluation metric.",
  "That hyperparameter matters a lot.",
  "I'll write up the methods section.",
];

/* ── Symposium dialogue lines ─────────────────────────── */
const DIALOGUE_LINES = [
  { agent: 0, text: "More agents doesn't mean better answers." },
  { agent: 1, text: "Unless you match the compute budget?" },
  { agent: 2, text: "That's the interaction tax — gains vanish under fair comparison." },
  { agent: 3, text: "So independent sampling beats debate at fixed cost?" },
  { agent: 0, text: "On most benchmarks, yes. Collaboration has to earn its overhead." },
  { agent: 1, text: "What about long-horizon tasks with verification?" },
  { agent: 2, text: "Verifier-scored proposals scale better there." },
  { agent: 3, text: "Marginal epistemic gain — each added agent must justify its cost." },
];

let dialogueStep = -1;
let dialogueTimer = 0;
const DIALOGUE_SHOW_FRAMES = 240; // ~4s per line — readable pace
const DIALOGUE_GAP_FRAMES = 36;  // ~0.6s pause between lines
const dialogueBubbles = [];       // created on first use

/* ── HTML overlay bubbles (bypass post-processing) ────── */
const htmlBubbles = new Map(); // agentIndex → { el, visible, text }

function getOrCreateHtmlBubble(agentIdx) {
  if (htmlBubbles.has(agentIdx)) return htmlBubbles.get(agentIdx);
  const el = document.createElement("div");
  el.style.cssText = `
    position:absolute; padding:6px 12px; border-radius:10px;
    background:rgba(255,255,255,0.93); color:#333;
    font:bold 12px 'IBM Plex Mono',monospace; white-space:nowrap;
    pointer-events:none; transform:translate(-50%,-100%);
    box-shadow:0 2px 8px rgba(0,0,0,0.12); max-width:220px;
    white-space:normal; text-align:center; line-height:1.35;
    opacity:0; transition:opacity 0.2s;
  `;
  if (bubbleOverlay) bubbleOverlay.appendChild(el);
  const entry = { el, visible: false, text: "" };
  htmlBubbles.set(agentIdx, entry);
  return entry;
}

function showHtmlBubble(agentIdx, text) {
  if (agentsMuted) return;
  const b = getOrCreateHtmlBubble(agentIdx);
  b.text = text;
  b.visible = true;
  b.el.textContent = text;
  b.el.style.opacity = "1";
}

function hideHtmlBubble(agentIdx) {
  if (!htmlBubbles.has(agentIdx)) return;
  const b = htmlBubbles.get(agentIdx);
  b.visible = false;
  b.el.style.opacity = "0";
}

function hideAllHtmlBubbles() {
  htmlBubbles.forEach((b) => { b.visible = false; b.el.style.opacity = "0"; });
}

// Project world position to overlay pixel coords
const _projVec = new THREE.Vector3();
function updateHtmlBubblePositions() {
  if (!camera || !bubbleOverlay) return;
  const rect = canvas.getBoundingClientRect();
  htmlBubbles.forEach((b, idx) => {
    if (!b.visible || idx >= agents.length) return;
    const agent = agents[idx];
    _projVec.setFromMatrixPosition(agent.group.matrixWorld);
    _projVec.y += agent.topY + 0.35;
    _projVec.project(camera);
    const x = ((_projVec.x + 1) / 2) * rect.width;
    const y = ((1 - _projVec.y) / 2) * rect.height;
    // Behind camera check
    if (_projVec.z > 1) { b.el.style.opacity = "0"; return; }
    b.el.style.left = x + "px";
    b.el.style.top = y + "px";
    b.el.style.opacity = "1";
  });
}

/* ═══════════════════════════════════════════════════════════
   District ground patch — dirt/cleared area around each building
   ═══════════════════════════════════════════════════════════ */

function makeGroundPatch(radius, color) {
  const geo = new THREE.CircleGeometry(radius, 12);
  const patch = new THREE.Mesh(geo, mt(color, { roughness: 0.95 }));
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = 0.006;
  patch.receiveShadow = true;
  return patch;
}

/* ═══════════════════════════════════════════════════════════
   Literature District — fully realized dense cluster
   Anchor library + reading nook + book crates + outdoor shelf
   + chalkboard + garden beds, all within tight ~2x footprint
   ═══════════════════════════════════════════════════════════ */

function buildLiteratureDistrict(r) {
  const district = new THREE.Group();
  district.scale.setScalar(1.25); // Scale up buildings relative to (now smaller) agents
  const BOOK_COLORS = [0xc45454, 0x4a7ab0, 0x6aa05a, 0xc4a040, 0x8a5ab0, 0xd4804a, 0x5a8a7a];

  // ── Ground clearing (dirt patch so it reads as a "home base") ──
  const ground = makeGroundPatch(1.8, DIRT);
  district.add(ground);
  // Slightly different inner patch for texture
  const inner = makeGroundPatch(1.1, DIRT_D);
  inner.position.y = 0.007;
  district.add(inner);

  // ── Anchor: Library (centered in district) ──
  const lib = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.7), mt(r.body));
  body.position.y = 0.4; body.castShadow = true; lib.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.45, 4), mt(r.roof));
  roof.position.y = 1.02; roof.rotation.y = Math.PI / 4; roof.castShadow = true; lib.add(roof);
  // Chimney
  const chim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), mt(STONE));
  chim.position.set(0.25, 1.15, -0.12); lib.add(chim);
  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.02), mt(CREAM, { roughness: 0.5 }));
  door.position.set(0, 0.15, 0.36); lib.add(door);
  // Arched window
  const archWin = new THREE.Mesh(new THREE.CircleGeometry(0.08, 8), mt(CREAM, { roughness: 0.4 }));
  archWin.position.set(0, 0.58, 0.36); lib.add(archWin);
  // Side windows
  for (const [wx, wz] of [[0.46, -0.1], [0.46, 0.1], [-0.46, 0]]) {
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.07), mt(CREAM, { roughness: 0.3 }));
    sw.position.set(wx, 0.45, wz); lib.add(sw);
  }
  // Door lantern
  const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4),
    mt(0xffe8a0, { emissive: 0xffe8a0, emissiveIntensity: 0.4 }));
  lantern.position.set(0.22, 0.5, 0.37); lib.add(lantern);
  district.add(lib);

  // ── Book stacks outside library (left wall, tight to building) ──
  for (let i = 0; i < 6; i++) {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.13), mt(BOOK_COLORS[i]));
    book.position.set(-0.55, 0.023 + i * 0.045, 0.1 - i * 0.012);
    book.rotation.y = (i - 3) * 0.06; district.add(book);
  }
  // Short stack right side
  for (let i = 0; i < 3; i++) {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.1), mt(BOOK_COLORS[i + 3]));
    book.position.set(0.55, 0.02 + i * 0.04, 0.25);
    book.rotation.y = (i - 1) * 0.1; district.add(book);
  }

  // ── Crate of books (near door, right side, within 1m of building) ──
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.16), mt(WOOD_D));
  crate.position.set(0.5, 0.065, 0.45); crate.castShadow = true; district.add(crate);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.03), mt(BOOK_COLORS[i + 1]));
    b.position.set(0.46 + i * 0.05, 0.15, 0.45);
    b.rotation.z = -0.12 + i * 0.1; district.add(b);
  }

  // ── Reading bench under a shade tree (close to building) ──
  const benchGroup = new THREE.Group();
  benchGroup.position.set(-0.9, 0, 0.8);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.025, 0.12), mt(WOOD_D));
  seat.position.y = 0.12; seat.castShadow = true; benchGroup.add(seat);
  const bBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.015), mt(WOOD_D));
  bBack.position.set(0, 0.2, -0.055); benchGroup.add(bBack);
  for (const lx of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.12, 0.025), mt(0x606060));
    leg.position.set(lx, 0.06, 0); benchGroup.add(leg);
  }
  // Open book on bench
  const openBook = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.005, 0.06), mt(CREAM));
  openBook.position.set(0.08, 0.14, 0); openBook.rotation.y = 0.2; benchGroup.add(openBook);
  district.add(benchGroup);

  // Shade tree over bench (double crown)
  const trunkB = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.55, 5), mt(TRUNK));
  trunkB.position.set(-0.9, 0.275, 0.8); district.add(trunkB);
  const crownB = new THREE.Mesh(new THREE.DodecahedronGeometry(0.34, 0), mtWind(GREEN_D));
  crownB.position.set(-0.9, 0.72, 0.8); crownB.castShadow = true; district.add(crownB);
  const crownB2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26, 0), mtWind(GREEN_L));
  crownB2.position.set(-0.75, 0.62, 0.88); crownB2.castShadow = true; district.add(crownB2);

  // ── Outdoor covered bookshelf (behind building) ──
  const shelfG = new THREE.Group();
  shelfG.position.set(0.6, 0, -0.7);
  for (const [sx, sz] of [[-0.13, -0.09], [0.13, -0.09], [-0.13, 0.09], [0.13, 0.09]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.38, 4), mt(WOOD_D));
    post.position.set(sx, 0.19, sz); shelfG.add(post);
  }
  const sRoof = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), mt(r.roof));
  sRoof.position.y = 0.39; sRoof.castShadow = true; shelfG.add(sRoof);
  for (const sy of [0.1, 0.24]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.015, 0.18), mt(WOOD));
    shelf.position.y = sy; shelfG.add(shelf);
  }
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.065, 0.055), mt(BOOK_COLORS[i]));
    b.position.set(-0.1 + i * 0.045, 0.145, 0); shelfG.add(b);
  }
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.055, 0.05), mt(BOOK_COLORS[i + 2]));
    b.position.set(-0.07 + i * 0.045, 0.28, 0); shelfG.add(b);
  }
  district.add(shelfG);

  // ── Chalkboard-on-easel (next to shelf) ──
  const easelG = new THREE.Group();
  easelG.position.set(-0.6, 0, -0.7);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.015), mt(0x4a6a4a));
  board.position.y = 0.36; easelG.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.005, 0.02), mt(WOOD_D));
  frame.position.y = 0.44; easelG.add(frame);
  const frame2 = frame.clone(); frame2.position.y = 0.28; easelG.add(frame2);
  for (const lx of [-0.08, 0.08]) {
    const eLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.42, 4), mt(WOOD_D));
    eLeg.position.set(lx, 0.17, 0.015); eLeg.rotation.x = 0.06; easelG.add(eLeg);
  }
  const backLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.38, 4), mt(WOOD_D));
  backLeg.position.set(0, 0.15, -0.08); backLeg.rotation.x = -0.25; easelG.add(backLeg);
  for (let i = 0; i < 6; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 3, 3), mt(CREAM));
    dot.position.set((Math.random() - 0.5) * 0.16, 0.3 + Math.random() * 0.1, 0.009);
    easelG.add(dot);
  }
  district.add(easelG);

  // ── Reading lamp post (within cluster) ──
  const lamp = new THREE.Group();
  lamp.position.set(1.0, 0, 0.1);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.45, 5), mt(0x606060));
  pole.position.y = 0.225; lamp.add(pole);
  const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), mt(0x505050));
  lampHead.position.y = 0.46; lamp.add(lampHead);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.022, 5, 4),
    mt(0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 0.35 }));
  glow.position.y = 0.44; lamp.add(glow);
  district.add(lamp);

  // ── Garden bed with small plants (edge of clearing) ──
  const gardenBed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.18), mt(0x8a6a4a));
  gardenBed.position.set(-0.2, 0.03, 1.2); district.add(gardenBed);
  for (let i = 0; i < 5; i++) {
    const plant = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 4), mt(i % 2 === 0 ? GREEN_L : GREEN_D));
    plant.position.set(-0.32 + i * 0.13, 0.1, 1.2); district.add(plant);
  }

  // ── Stepping stones radiating from building to edge of clearing ──
  const stoneSpots = [
    [0, 0.55], [-0.3, 0.9], [0.3, 0.9], [-0.6, 1.2], [0.6, 1.2],
    [0.9, 0.6], [-0.9, 0.3], [0, -0.6], [-0.4, -0.9],
  ];
  stoneSpots.forEach(([sx, sz]) => {
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05 + Math.random() * 0.03, 0.06 + Math.random() * 0.03, 0.015, 5),
      mt(STONE));
    stone.position.set(sx, 0.008, sz); stone.rotation.y = Math.random() * Math.PI; district.add(stone);
  });

  // ── Dense bushes ringing the clearing ──
  const bushSpots = [
    [-1.3, -0.3, 0.1], [1.3, -0.3, 0.09], [-1.4, 0.5, 0.08],
    [1.2, 0.6, 0.08], [-1.1, 1.0, 0.09], [0.9, 1.1, 0.07],
    [-0.5, -1.1, 0.08], [0.5, -1.0, 0.07], [1.4, 0.0, 0.06],
    [-1.5, -0.8, 0.06], [0.0, 1.4, 0.08], [-1.3, 1.2, 0.07],
  ];
  bushSpots.forEach(([bx, bz, br]) => {
    const baseC = new THREE.Color(Math.random() > 0.5 ? GREEN_D : GREEN_VD);
    const hsl = {}; baseC.getHSL(hsl);
    hsl.h += (Math.random() - 0.5) * 0.03;
    hsl.l += (Math.random() - 0.5) * 0.06;
    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(br, 5, 4),
      mt(new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0.15, Math.min(0.85, hsl.l))).getHex()));
    bush.position.set(bx, br * 0.5, bz); bush.castShadow = true; district.add(bush);
  });

  // ── Outdoor reading area: 2 chairs + small table under shade tree ──
  const readArea = new THREE.Group();
  readArea.position.set(0.85, 0, -0.5);
  // Small round table
  const rTable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 6), mt(WOOD_D));
  rTable.position.y = 0.14; readArea.add(rTable);
  const rTableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.14, 4), mt(WOOD_D));
  rTableLeg.position.y = 0.07; readArea.add(rTableLeg);
  // Two small chairs facing table
  for (const [cx, cz, cry] of [[-0.15, 0, Math.PI / 4], [0.15, 0, -Math.PI / 4]]) {
    const chair = new THREE.Group();
    const cSeat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.07), mt(WOOD));
    cSeat.position.y = 0.08; chair.add(cSeat);
    const cBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.01), mt(WOOD));
    cBack.position.set(0, 0.12, -0.03); chair.add(cBack);
    for (const lx of [-0.03, 0.03]) {
      const cLeg = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.08, 0.012), mt(0x606060));
      cLeg.position.set(lx, 0.04, 0); chair.add(cLeg);
    }
    chair.position.set(cx, 0, cz); chair.rotation.y = cry; readArea.add(chair);
  }
  // Open book on table
  const tBook = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.005, 0.045), mt(CREAM));
  tBook.position.set(0, 0.16, 0); tBook.rotation.y = 0.3; readArea.add(tBook);
  district.add(readArea);

  // ── Entrance plaque ──
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.01), mt(WOOD_D));
  plaque.position.set(0.3, 0.22, 0.37); district.add(plaque);

  // ── Flowers throughout clearing ──
  const fColors = [0xe8a0a0, 0xa0c0e8, 0xe8d8a0, 0xc0a0e0, 0xa0e8c0];
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 0.5 + Math.random() * 1.3;
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.015 + Math.random() * 0.008, 4, 4),
      mt(fColors[i % 5]));
    fl.position.set(Math.cos(a) * d, 0.012, Math.sin(a) * d); district.add(fl);
  }

  // Position the district
  district.position.set(r.home[0], getTerrainHeight(r.home[0], r.home[2]), r.home[2]);
  district.rotation.y = Math.atan2(-r.home[0], -r.home[2]);
  return district;
}

/* ═══════════════════════════════════════════════════════════
   Hypothesis District — Greenhouse + experiment garden
   ═══════════════════════════════════════════════════════════ */

function buildHypothesisDistrict(r) {
  const g = new THREE.Group();
  g.scale.setScalar(1.25); // Scale up buildings

  // Ground clearing
  const ground = makeGroundPatch(1.6, DIRT);
  g.add(ground);
  const inner = makeGroundPatch(0.9, DIRT_D);
  inner.position.y = 0.007; g.add(inner);

  // Anchor: Greenhouse
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.6), mt(r.body));
  base.position.y = 0.12; base.castShadow = true; g.add(base);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    mt(0xe8dcc8, { transparent: true, opacity: 0.3, roughness: 0.12 }));
  dome.position.y = 0.24; dome.castShadow = true; g.add(dome);
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.008, 3, 12, Math.PI), mt(r.accent));
    rib.rotation.y = (i * Math.PI) / 4; rib.position.y = 0.24; g.add(rib);
  }
  // Interior plants
  const addPlant = (x, z, h, lr, color) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, h, 4), mt(0x5a9a5a));
    s.position.set(x, 0.24 + h / 2, z); g.add(s);
    const l = new THREE.Mesh(new THREE.DodecahedronGeometry(lr, 0), mt(color));
    l.position.set(x, 0.24 + h + lr * 0.4, z); g.add(l);
  };
  addPlant(0, 0, 0.24, 0.11, 0x6abf6a);
  addPlant(0.13, 0.07, 0.18, 0.08, 0x80d080);
  addPlant(-0.11, 0.05, 0.2, 0.09, 0x5aaa5a);
  addPlant(-0.06, -0.09, 0.14, 0.06, 0x7aba7a);
  addPlant(0.08, -0.06, 0.1, 0.05, 0x90d090);
  for (const [x, z, c] of [[0.13, 0.07, 0xe8a060], [-0.09, 0.05, 0xe06080], [0.05, -0.06, 0xd0a0e0]]) {
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), mt(c));
    fl.position.set(x, 0.5, z); g.add(fl);
  }

  // ── Experiment garden beds (3 raised beds in L-shape) ──
  for (let i = 0; i < 3; i++) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.15), mt(WOOD_D));
    bed.position.set(-0.2 + i * 0.4, 0.03, 0.55); g.add(bed);
    for (let j = 0; j < 3; j++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07 + Math.random() * 0.04, 4),
        mt(j % 2 === 0 ? 0x6aaa6a : 0x80c080));
      sp.position.set(-0.28 + i * 0.4 + j * 0.08, 0.1, 0.55); g.add(sp);
    }
  }

  // ── Test tube rack (small prop) ──
  const rack = new THREE.Group();
  rack.position.set(0.7, 0, -0.3);
  const rackBase = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.06), mt(WOOD));
  rackBase.position.y = 0.06; rack.add(rackBase);
  for (let i = 0; i < 3; i++) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4),
      mt([0xa0d0e0, 0xe0a0c0, 0xc0e0a0][i], { transparent: true, opacity: 0.6 }));
    tube.position.set(-0.04 + i * 0.04, 0.13, 0); rack.add(tube);
  }
  g.add(rack);

  // ── Potting table ──
  const potTable = new THREE.Group();
  potTable.position.set(-0.7, 0, -0.4);
  const tTop = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.15), mt(WOOD_D));
  tTop.position.y = 0.2; potTable.add(tTop);
  for (const lx of [-0.12, 0.12]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.2, 0.025), mt(WOOD_D));
    leg.position.set(lx, 0.1, 0); potTable.add(leg);
  }
  // Pots on table
  for (let i = 0; i < 3; i++) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.04, 5), mt(0xc08060));
    pot.position.set(-0.08 + i * 0.08, 0.23, 0); potTable.add(pot);
    const dirt = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.01, 5), mt(0x6a5040));
    dirt.position.set(-0.08 + i * 0.08, 0.25, 0); potTable.add(dirt);
  }
  g.add(potTable);

  // ── Watering can ──
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.06, 5), mt(METAL));
  can.position.set(0.4, 0.03, 0.35); can.rotation.z = 0.15; g.add(can);

  // ── Chalkboard easel (outside greenhouse) ──
  const hEasel = new THREE.Group();
  hEasel.position.set(-0.55, 0, 0.45);
  const hBoard = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.012), mt(0x4a6a4a));
  hBoard.position.y = 0.34; hEasel.add(hBoard);
  for (const lx of [-0.07, 0.07]) {
    const hLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.38, 4), mt(WOOD_D));
    hLeg.position.set(lx, 0.15, 0.01); hLeg.rotation.x = 0.06; hEasel.add(hLeg);
  }
  // Chalk marks
  for (let i = 0; i < 4; i++) {
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.003, 0.01), mt(CREAM));
    mark.position.set(0, 0.29 + i * 0.03, 0.008); hEasel.add(mark);
  }
  g.add(hEasel);

  // ── Garden tools leaning against greenhouse ──
  // Rake
  const rakeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.25, 4), mt(WOOD_D));
  rakeHandle.position.set(0.38, 0.14, -0.32); rakeHandle.rotation.z = -0.2; g.add(rakeHandle);
  // Shovel
  const shovelHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.22, 4), mt(WOOD_D));
  shovelHandle.position.set(0.42, 0.12, -0.32); shovelHandle.rotation.z = -0.25; g.add(shovelHandle);
  const shovelHead = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 0.005), mt(METAL));
  shovelHead.position.set(0.42, 0.02, -0.32); g.add(shovelHead);

  // ── Seed crate ──
  const seedCrate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.1), mt(WOOD_D));
  seedCrate.position.set(-0.55, 0.04, -0.2); g.add(seedCrate);

  // ── Bushes around clearing ──
  const bushSpots = [
    [-1.2, 0.3, 0.09], [1.2, 0.3, 0.08], [-1.0, -0.6, 0.07],
    [1.0, -0.6, 0.08], [0, 1.0, 0.09], [-0.7, 0.9, 0.06],
    [0.8, 0.8, 0.07], [-1.3, -0.1, 0.06], [1.3, 0.0, 0.07],
  ];
  bushSpots.forEach(([bx, bz, br]) => {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(br, 5, 4),
      mt(Math.random() > 0.5 ? GREEN_D : GREEN_VD));
    bush.position.set(bx, br * 0.5, bz); bush.castShadow = true; g.add(bush);
  });

  // Flowers
  const fColors = [0xe8a0a0, 0xe8d8a0, 0xc0a0e0, 0xa0e8c0];
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 0.5 + Math.random() * 1.0;
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4), mt(fColors[i % 4]));
    fl.position.set(Math.cos(a) * d, 0.012, Math.sin(a) * d); g.add(fl);
  }

  g.position.set(r.home[0], getTerrainHeight(r.home[0], r.home[2]), r.home[2]);
  g.rotation.y = Math.atan2(-r.home[0], -r.home[2]);
  return g;
}

/* ═══════════════════════════════════════════════════════════
   Design District — Workshop + tools + workbench cluster
   ═══════════════════════════════════════════════════════════ */

function buildDesignDistrict(r) {
  const g = new THREE.Group();
  g.scale.setScalar(1.25); // Scale up buildings

  // Ground clearing
  const ground = makeGroundPatch(1.6, DIRT);
  g.add(ground);
  const inner = makeGroundPatch(0.9, DIRT_D);
  inner.position.y = 0.007; g.add(inner);

  // Anchor: Workshop
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.45, 0.65), mt(r.body));
  body.position.y = 0.225; body.castShadow = true; g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.75), mt(r.roof));
  roof.position.y = 0.48; roof.castShadow = true; g.add(roof);
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.1), mt(STONE));
  chimney.position.set(0.32, 0.6, -0.24); chimney.castShadow = true; g.add(chimney);
  for (let i = 0; i < 4; i++) {
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(0.025 + i * 0.01, 5, 4),
      mt(0xd8d8d8, { transparent: true, opacity: 0.25 - i * 0.05 }));
    smoke.position.set(0.32, 0.76 + i * 0.07, -0.24);
    smoke.userData.smokeBase = { x: 0.32, y: 0.76 + i * 0.07, z: -0.24, i };
    g.add(smoke);
    animatedObjects.push({ type: "smoke", mesh: smoke, parent: g });
  }
  const wDoor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.02), mt(CREAM, { roughness: 0.5 }));
  wDoor.position.set(-0.16, 0.13, 0.33); g.add(wDoor);
  for (const x of [0.08, 0.28]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.02), mt(CREAM, { roughness: 0.3 }));
    w.position.set(x, 0.32, 0.33); g.add(w);
  }

  // ── Outdoor workbench with tools (right of building) ──
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 0.16), mt(WOOD_D));
  bench.position.set(0.7, 0.17, 0.2); g.add(bench);
  for (const x of [0.57, 0.83]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.03), mt(WOOD_D));
    leg.position.set(x, 0.08, 0.2); g.add(leg);
  }
  const gear = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 4, 8), mt(METAL, { metalness: 0.3 }));
  gear.position.set(0.72, 0.2, 0.2); gear.rotation.x = -Math.PI / 2; g.add(gear);
  animatedObjects.push({ type: "spin", mesh: gear, speed: 0.8 });
  const hamHead = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.06), mt(METAL));
  hamHead.position.set(0.64, 0.2, 0.2); g.add(hamHead);
  const hamHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4), mt(WOOD_D));
  hamHandle.position.set(0.64, 0.2, 0.24); hamHandle.rotation.x = Math.PI / 2; g.add(hamHandle);

  // ── Lumber pile (left of building) ──
  for (let i = 0; i < 4; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.06), mt(i % 2 === 0 ? WOOD : WOOD_D));
    plank.position.set(-0.7, 0.015 + i * 0.03, -0.1 + i * 0.02);
    plank.rotation.y = (Math.random() - 0.5) * 0.1; g.add(plank);
  }

  // ── Blueprint stand (behind building) ──
  const bpStand = new THREE.Group();
  bpStand.position.set(0, 0, -0.65);
  const bpBoard = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.015), mt(0x5a8090));
  bpBoard.position.y = 0.38; bpStand.add(bpBoard);
  for (const lx of [-0.1, 0.1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.44, 4), mt(WOOD_D));
    leg.position.set(lx, 0.18, 0.015); leg.rotation.x = 0.05; bpStand.add(leg);
  }
  // Blueprint lines
  for (let i = 0; i < 4; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.003, 0.012), mt(CREAM));
    line.position.set(0, 0.31 + i * 0.04, 0.009); bpStand.add(line);
  }
  g.add(bpStand);

  // ── Sawhorses ──
  const sawhorse = new THREE.Group();
  sawhorse.position.set(-0.6, 0, 0.6);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.04), mt(WOOD_D));
  bar.position.y = 0.18; sawhorse.add(bar);
  for (const [lx, lz] of [[-0.12, 0.04], [-0.12, -0.04], [0.12, 0.04], [0.12, -0.04]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.2, 4), mt(WOOD_D));
    leg.position.set(lx, 0.09, lz); leg.rotation.z = lx > 0 ? -0.15 : 0.15; sawhorse.add(leg);
  }
  g.add(sawhorse);

  // ── Toolbox ──
  const toolbox = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), mt(METAL));
  toolbox.position.set(0.55, 0.04, -0.4); g.add(toolbox);

  // ── Small scaffold/crane ──
  const scaffold = new THREE.Group();
  scaffold.position.set(-0.45, 0, -0.6);
  for (const [sx, sz] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) {
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), mt(METAL));
    sp.position.set(sx, 0.25, sz); scaffold.add(sp);
  }
  const sBeam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.015, 0.14), mt(WOOD));
  sBeam.position.y = 0.5; scaffold.add(sBeam);
  const sBeam2 = sBeam.clone(); sBeam2.position.y = 0.25; scaffold.add(sBeam2);
  const pulley = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 4, 8), mt(METAL));
  pulley.position.set(0, 0.53, 0.06); pulley.rotation.x = Math.PI / 2; scaffold.add(pulley);
  g.add(scaffold);

  // ── Stacked building blocks ──
  for (let i = 0; i < 5; i++) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.1),
      mt([WOOD, WOOD_D, STONE][i % 3]));
    bl.position.set(0.9, 0.03 + i * 0.06, -0.2);
    bl.rotation.y = i * 0.15; g.add(bl);
  }

  // ── Measuring ruler on ground ──
  const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.005, 0.02), mt(0xd0c040));
  ruler.position.set(-0.3, 0.003, 0.85); ruler.rotation.y = 0.4; g.add(ruler);

  // Bushes
  const bushSpots = [
    [-1.2, 0.3, 0.08], [1.2, 0.3, 0.07], [-1.0, -0.5, 0.09],
    [1.0, -0.5, 0.06], [0.5, 1.0, 0.08], [-0.5, 1.0, 0.07],
    [-1.3, -0.2, 0.06], [1.3, 0.0, 0.07], [0.0, -1.1, 0.08],
  ];
  bushSpots.forEach(([bx, bz, br]) => {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(br, 5, 4),
      mt(Math.random() > 0.5 ? GREEN_D : GREEN_VD));
    bush.position.set(bx, br * 0.5, bz); bush.castShadow = true; g.add(bush);
  });

  g.position.set(r.home[0], getTerrainHeight(r.home[0], r.home[2]), r.home[2]);
  g.rotation.y = Math.atan2(-r.home[0], -r.home[2]);
  return g;
}

/* ═══════════════════════════════════════════════════════════
   Analysis District — Observatory on raised hill + instruments
   ═══════════════════════════════════════════════════════════ */

function buildAnalysisDistrict(r) {
  const g = new THREE.Group();
  g.scale.setScalar(1.25); // Scale up buildings

  // Ground clearing (on top of the hill)
  const ground = makeGroundPatch(1.5, DIRT);
  g.add(ground);

  // Anchor: Observatory
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.85, 8), mt(r.body));
  tower.position.y = 0.425; tower.castShadow = true; g.add(tower);
  tower.userData.isRoof = true; // tag for cutaway
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mt(r.roof));
  dome.position.y = 0.85; dome.castShadow = true; g.add(dome);
  dome.userData.isRoof = true; // tag for cutaway
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.014, 4, 12), mt(CREAM));
  rail.rotation.x = -Math.PI / 2; rail.position.y = 0.87; g.add(rail);
  rail.userData.isRoof = true;
  const scopeGroup = new THREE.Group();
  scopeGroup.position.set(0, 0.9, 0);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.32, 6), mt(METAL, { metalness: 0.3 }));
  scope.position.set(0.18, 0, 0); scope.rotation.z = -Math.PI / 5; scopeGroup.add(scope);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.026, 5, 4), mt(0xd0e8f0, { roughness: 0.1 }));
  lens.position.set(0.3, 0.08, 0); scopeGroup.add(lens);
  scopeGroup.userData.isRoof = true;
  g.add(scopeGroup);
  animatedObjects.push({ type: "spin", mesh: scopeGroup, speed: 0.15 });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.02), mt(CREAM, { roughness: 0.3 }));
    w.position.set(Math.sin(a) * 0.3, 0.45, Math.cos(a) * 0.3); w.rotation.y = a; g.add(w);
  }
  const oDoor = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.22, 0.02), mt(CREAM, { roughness: 0.5 }));
  oDoor.position.set(0, 0.11, 0.35); g.add(oDoor);

  // ── Star chart on stand ──
  const chart = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.015), mt(0x3a5068));
  chart.position.set(-0.55, 0.35, 0.15); chart.rotation.y = Math.PI / 6; g.add(chart);
  for (let i = 0; i < 5; i++) {
    const star = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4),
      mt(0xffe8c0, { emissive: 0xffe8c0, emissiveIntensity: 0.5 }));
    star.position.set(-0.55 + (Math.random() - 0.5) * 0.12, 0.35 + (Math.random() - 0.5) * 0.08,
      0.16 + Math.random() * 0.01);
    g.add(star);
  }
  // Chart legs
  for (const lx of [-0.62, -0.48]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.32, 4), mt(WOOD_D));
    leg.position.set(lx, 0.16, 0.15); g.add(leg);
  }

  // ── Compass rose on ground ──
  const compassBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.01, 8), mt(STONE));
  compassBase.position.set(0.5, 0.006, -0.4); g.add(compassBase);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.005, 0.12), mt(i === 0 ? 0xc04040 : CREAM));
    needle.position.set(0.5, 0.014, -0.4);
    needle.rotation.y = a; g.add(needle);
  }

  // ── Weather instruments cluster ──
  // Barometer post
  const baroPost = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.35, 5), mt(WOOD_D));
  baroPost.position.set(0.6, 0.175, 0.3); g.add(baroPost);
  const baroDial = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 8), mt(CREAM));
  baroDial.position.set(0.6, 0.36, 0.3); baroDial.rotation.x = Math.PI / 2; g.add(baroDial);

  // ── Sundial ──
  const sundialBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 6), mt(STONE));
  sundialBase.position.set(-0.5, 0.03, -0.5); g.add(sundialBase);
  const gnomon = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.06, 0.04), mt(METAL));
  gnomon.position.set(-0.5, 0.09, -0.5); gnomon.rotation.z = -0.3; g.add(gnomon);

  // ── Rocky terrain details ──
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 0.6 + Math.random() * 0.8;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.04 + Math.random() * 0.04, 0),
      mt(STONE, { roughness: 0.95 }));
    rock.position.set(Math.cos(a) * d, 0.02, Math.sin(a) * d);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(rock);
  }

  // ── Small antenna array ──
  const antennaArr = new THREE.Group();
  antennaArr.position.set(-0.65, 0, -0.35);
  for (let i = 0; i < 3; i++) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.3 + i * 0.08, 4), mt(METAL));
    mast.position.set(i * 0.08, (0.3 + i * 0.08) / 2, 0); antennaArr.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.02, 5, 4, 0, Math.PI), mt(CREAM));
    dish.position.set(i * 0.08, 0.3 + i * 0.08, 0); dish.rotation.x = -0.5; antennaArr.add(dish);
  }
  g.add(antennaArr);

  // ── Instrument marker posts ──
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + 0.5;
    const d = 0.8;
    const mPost = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.18, 4), mt(METAL));
    mPost.position.set(Math.cos(a) * d, 0.09, Math.sin(a) * d); g.add(mPost);
    const dial = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.005), mt(CREAM));
    dial.position.set(Math.cos(a) * d, 0.19, Math.sin(a) * d);
    dial.rotation.y = a; g.add(dial);
  }

  // ── Steps leading up to the observatory ──
  for (let i = 0; i < 4; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.08), mt(STONE));
    step.position.set(0, -0.02 + i * 0.03, 0.5 + i * 0.08); g.add(step);
  }
  // Railing
  const railP1 = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), mt(METAL));
  railP1.position.set(0.12, 0.06, 0.5); g.add(railP1);
  const railP2 = railP1.clone(); railP2.position.set(0.12, 0.12, 0.8); g.add(railP2);
  const railBar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.35, 4), mt(METAL));
  railBar.position.set(0.12, 0.14, 0.65); railBar.rotation.x = Math.PI / 2 - 0.2; g.add(railBar);

  // Sparse bushes (hilltop is windswept)
  const bushSpots = [
    [-0.9, 0.5, 0.07], [0.9, -0.3, 0.06], [-0.7, -0.7, 0.05],
    [0.5, 0.8, 0.06], [-1.0, -0.1, 0.05],
  ];
  bushSpots.forEach(([bx, bz, br]) => {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(br, 5, 4), mt(GREEN_VD));
    bush.position.set(bx, br * 0.5, bz); bush.castShadow = true; g.add(bush);
  });

  g.position.set(r.home[0], getTerrainHeight(r.home[0], r.home[2]), r.home[2]);
  g.position.y = ANALYSIS_HILL_Y;
  g.rotation.y = Math.atan2(-r.home[0], -r.home[2]);
  return g;
}

/* ═══════════════════════════════════════════════════════════
   Terrain — single landmass with integrated hill
   ═══════════════════════════════════════════════════════════ */

function createTerrain() {
  // ── Main island ground mesh — displaced PlaneGeometry ──
  const RES = 200; // grid resolution (higher = smoother edges)
  const SIZE = (PLATFORM_R + 2) * 2; // world extent
  const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, RES, RES);
  groundGeo.rotateX(-Math.PI / 2);
  const gPos = groundGeo.attributes.position;

  // Displace each vertex: shape outline + height
  for (let i = 0; i < gPos.count; i++) {
    const x = gPos.getX(i);
    const z = gPos.getZ(i);
    const dist = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);
    const edgeR = getIslandRadius(angle);

    if (dist > edgeR + 0.8) {
      // Far outside island — drop below water
      gPos.setY(i, -0.4);
    } else if (dist > edgeR - 1.5) {
      // Wide edge transition — smoothstep blend from full terrain to beach level
      // Uses smoothstep for a curve that's flat at both ends (no visible seam)
      const t01 = Math.max(0, Math.min(1, (dist - (edgeR - 1.5)) / 2.3));
      const ss = t01 * t01 * (3 - 2 * t01); // smoothstep
      const terrainH = getTerrainHeight(x, z);
      const beachH = -0.06; // beach level where sand ring starts
      const h = terrainH * (1 - ss) + beachH * ss;
      gPos.setY(i, h);
    } else {
      // Interior — full terrain height
      gPos.setY(i, getTerrainHeight(x, z));
    }
  }
  groundGeo.computeVertexNormals();

  // ── Vertex-colored ground — blend grass/dirt/sand/rock by height, slope, edge ──
  const colors = new Float32Array(gPos.count * 3);
  const gNorm = groundGeo.attributes.normal;
  const grass  = new THREE.Color(0x7ec868);
  const grass2 = new THREE.Color(0x6db85a);
  const sand   = new THREE.Color(0xe8dca8);
  const tmpC   = new THREE.Color();
  for (let i = 0; i < gPos.count; i++) {
    const x = gPos.getX(i), y = gPos.getY(i), z = gPos.getZ(i);
    const dist = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);
    const edgeR = getIslandRadius(angle);
    const edgeFrac = Math.max(0, Math.min(1, (edgeR - dist) / 1.0));
    // subtle noise variation between two greens
    const n1 = noise2D(x * 1.5, z * 1.5) * 0.5 + 0.5;
    tmpC.copy(grass).lerp(grass2, n1);
    // very subtle tint in low areas (not darker, just slightly warmer)
    if (y < 0.05) tmpC.lerp(new THREE.Color(0x70b050), Math.max(0, (0.05 - y) * 1));
    // thin sand ring at very edge only
    if (edgeFrac < 0.1) tmpC.lerp(sand, 1 - edgeFrac / 0.1);
    // below water
    if (y < -0.1) tmpC.set(0x7a7060);
    colors[i * 3] = tmpC.r; colors[i * 3 + 1] = tmpC.g; colors[i * 3 + 2] = tmpC.b;
  }
  groundGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const groundMat = mt(0xffffff, { vertexColors: true });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ── Cliff/underside — rounded rocky wall with color bands + beach rocks ──
  const cliffSegments = 180;
  const cliffBands = 6; // vertical subdivisions for rounding
  const cliffGeo = new THREE.BufferGeometry();
  const cliffVerts = [];
  const cliffNorms = [];
  const cliffColors = [];
  const cliffIdxs = [];
  const sandC  = new THREE.Color(0xe8dcc0);
  const earthC = new THREE.Color(0xb09878);
  const rockC  = new THREE.Color(0x8a8070);
  const darkC  = new THREE.Color(0x6a6258);
  const cTmp   = new THREE.Color();
  for (let i = 0; i <= cliffSegments; i++) {
    const a = (i / cliffSegments) * Math.PI * 2;
    const r = getIslandRadius(a);
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const h = getTerrainHeight(cx * 0.95, cz * 0.95);
    const topY = Math.max(h * 0.5, -0.05);
    const botY = -0.38;
    const nx = Math.cos(a), nz = Math.sin(a);
    const rockNoise = noise2D(a * 8, 0) * 0.12; // per-segment roughness
    for (let b = 0; b <= cliffBands; b++) {
      const t = b / cliffBands; // 0 = top, 1 = bottom
      const y = topY + (botY - topY) * t;
      // Bulge outward in the middle for a rounded profile
      const bulge = Math.sin(t * Math.PI) * 0.15 + rockNoise * Math.sin(t * Math.PI * 2);
      const px = cx + nx * bulge;
      const pz = cz + nz * bulge;
      cliffVerts.push(px, y, pz);
      cliffNorms.push(nx, 0.15 * (1 - 2 * t), nz); // slight upward lean at top
      // Color bands: sand at top → earth → dark rock at bottom
      if (t < 0.2) cTmp.copy(sandC).lerp(earthC, t / 0.2);
      else if (t < 0.6) cTmp.copy(earthC).lerp(rockC, (t - 0.2) / 0.4);
      else cTmp.copy(rockC).lerp(darkC, (t - 0.6) / 0.4);
      // Add noise variation
      const cv = noise2D(a * 12 + t * 5, t * 10) * 0.08;
      cTmp.r = Math.max(0, Math.min(1, cTmp.r + cv));
      cTmp.g = Math.max(0, Math.min(1, cTmp.g + cv));
      cTmp.b = Math.max(0, Math.min(1, cTmp.b + cv));
      cliffColors.push(cTmp.r, cTmp.g, cTmp.b);
    }
    if (i < cliffSegments) {
      const stride = cliffBands + 1;
      for (let b = 0; b < cliffBands; b++) {
        const vi = i * stride + b;
        cliffIdxs.push(vi, vi + 1, vi + stride, vi + stride, vi + 1, vi + stride + 1);
      }
    }
  }
  cliffGeo.setAttribute("position", new THREE.Float32BufferAttribute(cliffVerts, 3));
  cliffGeo.setAttribute("normal", new THREE.Float32BufferAttribute(cliffNorms, 3));
  cliffGeo.setAttribute("color", new THREE.Float32BufferAttribute(cliffColors, 3));
  cliffGeo.setIndex(cliffIdxs);
  const cliff = new THREE.Mesh(cliffGeo, mt(0xffffff, { vertexColors: true, roughness: 0.95, emissive: 0x403828, emissiveIntensity: 0.12 }));
  scene.add(cliff);

  // ── Beach rocks at shoreline ──
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = getIslandRadius(a) + (Math.random() - 0.3) * 0.5;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const sz = 0.04 + Math.random() * 0.08;
    const brock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(sz, 0),
      mt(Math.random() > 0.5 ? 0x9a9080 : 0x7a7060, { roughness: 0.95 }));
    brock.position.set(bx, -0.12 + Math.random() * 0.06, bz);
    brock.rotation.set(Math.random() * 2, Math.random() * 2, Math.random() * 2);
    scene.add(brock);
  }

  // ── Steps leading up to Analysis district ──
  for (let i = 0; i < 6; i++) {
    const t = (i + 1) / 7;
    const sx = -6 + t * 3, sz = 6 - t * 3;
    const sy = getTerrainHeight(sx, sz);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.12), mt(STONE));
    step.position.set(sx, sy + 0.025, sz);
    step.rotation.y = -Math.PI / 4;
    scene.add(step);
  }

  // ── Rock outcrops (clusters at interesting terrain spots) ──
  const rockColors = [0x9a9588, 0x8a8378, 0xa0988a];
  const rockCluster = (cx, cz, count) => {
    for (let i = 0; i < count; i++) {
      const size = 0.08 + Math.random() * 0.12;
      const rx = cx + (Math.random() - 0.5) * 0.5;
      const rz = cz + (Math.random() - 0.5) * 0.5;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(size, 0),
        mt(rockColors[i % 3], { roughness: 0.95 }));
      rock.position.set(rx, getTerrainHeight(rx, rz) + size * 0.3, rz);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      scene.add(rock);
    }
  };
  // Rock outcrop area (NE where terrain is higher)
  rockCluster(7, -4, 6);
  rockCluster(3, 2, 4);
  rockCluster(-2, -3, 4);
  rockCluster(-3, 8, 3);

  // ── Pond near Design district ──
  const pondY = getTerrainHeight(4, 3);
  const pondBase = new THREE.Mesh(new THREE.CircleGeometry(0.6, 14), mt(0xb8b0a0));
  pondBase.rotation.x = -Math.PI / 2; pondBase.position.set(4, pondY + 0.004, 3); scene.add(pondBase);
  const pondWater = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14),
    mt(WATER, { roughness: 0.05, transparent: true, opacity: 0.5 }));
  pondWater.rotation.x = -Math.PI / 2; pondWater.position.set(4, pondY + 0.008, 3); scene.add(pondWater);
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.15, 4), mt(GREEN_VD));
    reed.position.set(4 + Math.cos(a) * 0.45, pondY + 0.075, 3 + Math.sin(a) * 0.45); scene.add(reed);
  }

  // ── Viewpoint bench (west edge, scenic overlook) ──
  const viewG = new THREE.Group();
  viewG.position.set(-9, getTerrainHeight(-9, -2), -2);
  viewG.rotation.y = Math.PI / 3;
  const vSeat = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.1), mt(WOOD_D));
  vSeat.position.y = 0.1; vSeat.castShadow = true; viewG.add(vSeat);
  const vBack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.015), mt(WOOD_D));
  vBack.position.set(0, 0.17, -0.04); viewG.add(vBack);
  for (const lx of [-0.14, 0.14]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), mt(0x606060));
    leg.position.set(lx, 0.05, 0); viewG.add(leg);
  }
  scene.add(viewG);

  // ── Market stalls (neutral fifth zone, north of plaza) ──
  createMarket();

  // ══════════════════════════════════════════════════════════
  // Ocean — surrounding water plane
  // ══════════════════════════════════════════════════════════

  // Water shader — toon-compatible, animated waves with specular + fresnel
  const sunDir = new THREE.Vector3(8, 8, 8).normalize();
  // Reflection render target (will be created in init after renderer exists)
  reflectionRT = new THREE.WebGLRenderTarget(512, 512, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });
  reflectionCamera = new THREE.PerspectiveCamera();

  const waterUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x78c8e0) },
    uColorDeep: { value: new THREE.Color(0x58a8c8) },
    uSunDir: { value: sunDir },
    uReflection: { value: reflectionRT.texture },
    uResolution: { value: new THREE.Vector2(canvas.clientWidth, canvas.clientHeight) },
  };
  oceanUniforms = waterUniforms;

  const WATER_Y = -0.22;
  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying float vWave;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec4 vScreenPos;
      void main() {
        vUv = uv;
        vec3 pos = position;
        float w1 = sin(pos.x * 0.6 + uTime * 0.8) * 0.08;
        float w2 = sin(pos.z * 0.4 + uTime * 0.5 + 1.0) * 0.06;
        float w3 = sin((pos.x + pos.z) * 0.3 + uTime * 0.3) * 0.04;
        float w4 = sin(pos.x * 1.5 + pos.z * 0.8 + uTime * 1.2) * 0.02;
        float w5 = sin(pos.x * 2.3 - pos.z * 1.1 + uTime * 0.9) * 0.012;
        float w6 = sin(pos.z * 2.8 + pos.x * 0.5 - uTime * 0.6) * 0.008;
        pos.y += w1 + w2 + w3 + w4 + w5 + w6;
        vWave = (w1 + w2 + w3 + w4 + w5 + w6) / 0.22;
        float dx = 0.6*cos(pos.x*0.6+uTime*0.8)*0.08
                  + 0.3*cos((pos.x+pos.z)*0.3+uTime*0.3)*0.04
                  + 1.5*cos(pos.x*1.5+pos.z*0.8+uTime*1.2)*0.02
                  + 2.3*cos(pos.x*2.3-pos.z*1.1+uTime*0.9)*0.012;
        float dz = 0.4*cos(pos.z*0.4+uTime*0.5+1.0)*0.06
                  + 0.3*cos((pos.x+pos.z)*0.3+uTime*0.3)*0.04
                  + 0.8*cos(pos.x*1.5+pos.z*0.8+uTime*1.2)*0.02
                  + 2.8*cos(pos.z*2.8+pos.x*0.5-uTime*0.6)*0.008;
        vNormal = normalize(vec3(-dx, 1.0, -dz));
        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        vScreenPos = projectionMatrix * viewMatrix * worldPos;
        gl_Position = vScreenPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uColorDeep;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform sampler2D uReflection;
      uniform vec2 uResolution;
      varying vec2 vUv;
      varying float vWave;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec4 vScreenPos;

      float dither(vec2 coord) {
        float n = fract(sin(dot(coord, vec2(12.9898, 78.233))) * 43758.5453);
        return (n - 0.5) / 255.0;
      }

      // Approximate island distance for shoreline transparency
      float islandProximity(vec2 p) {
        float d = 1e6;
        d = min(d, length(p) - 13.0);                      // main island
        d = min(d, length(p - vec2(-18.0, -6.0)) - 4.0);   // catalina
        d = min(d, length(p - vec2(16.0, 9.0)) - 4.0);     // greek
        d = min(d, length(p - vec2(5.0, -14.0)) - 4.5);    // desert
        d = min(d, length(p - vec2(-22.0, 18.0)) - 4.0);   // hawaii
        d = min(d, length(p - vec2(10.0, -35.0)) - 3.5);   // treasure
        d = min(d, length(p - vec2(-36.0, 30.0)) - 6.0);   // jeju
        d = min(d, length(p - vec2(24.0, 26.0)) - 4.0);    // maldives
        d = min(d, length(p - vec2(-45.0, -5.0)) - 2.5);   // sandbar
        d = min(d, length(p - vec2(-22.0, -28.0)) - 2.0);  // volcano
        d = min(d, length(p - vec2(32.0, -18.0)) - 1.5);   // sea stack
        d = min(d, length(p - vec2(32.0, 38.0)) - 2.5);    // atoll
        d = min(d, length(p - vec2(75.0, -30.0)) - 12.0);  // hermit
        d = min(d, length(p - vec2(-65.0, -55.0)) - 11.0);  // glacier
        d = min(d, length(p - vec2(-12.0, -22.0)) - 5.5);   // cherry blossom
        d = min(d, length(p - vec2(-48.0, 38.0)) - 5.0);    // bora bora
        return d;
      }

      void main() {
        // Base water color with soft toon stepping
        float shade = smoothstep(-0.5, 0.5, vWave);
        float steps = 6.0;
        float stepped = floor(shade * steps + 0.5) / steps;
        shade = mix(shade, stepped, 0.5);
        vec3 col = mix(uColorDeep, uColor, shade);

        // ── Depth-based coloring ──
        float dist = islandProximity(vWorldPos.xz);
        // Distance from camera center for open-ocean deepening
        float worldDist = length(vWorldPos.xz);
        vec3 deepBlue = vec3(0.22, 0.35, 0.52);       // deep offshore blue
        vec3 shallowTurq = vec3(0.4, 0.72, 0.68);     // turquoise shallows
        vec3 sandbarWhite = vec3(0.65, 0.78, 0.72);    // near-white over sandbars
        // Blend by proximity: sandbar → turquoise → base → deep blue
        if (dist < -0.5) {
          col = mix(sandbarWhite, shallowTurq, smoothstep(-1.5, -0.5, dist));
        } else if (dist < 2.0) {
          col = mix(shallowTurq, col, smoothstep(-0.5, 2.0, dist));
        }
        // Open ocean gets progressively deeper blue
        float deepFactor = smoothstep(15.0, 60.0, worldDist);
        col = mix(col, deepBlue, deepFactor * 0.5);

        // Surface detail (multi-frequency) — scale by distance for wave variation
        float detailScale = mix(1.0, 0.4, deepFactor); // calmer in deep water
        float d1 = sin(vWorldPos.x * 3.0 + uTime * 0.4) * sin(vWorldPos.z * 2.5 + uTime * 0.3);
        float d2 = sin(vWorldPos.x * 7.0 + uTime * 0.7) * sin(vWorldPos.z * 5.5 - uTime * 0.5);
        float d3 = sin(vWorldPos.x * 1.3 - uTime * 0.2) * sin(vWorldPos.z * 1.8 + uTime * 0.35);
        col += (d1 * 0.015 + d2 * 0.008 + d3 * 0.01) * detailScale;

        vec3 viewDir = normalize(cameraPosition - vWorldPos);

        // ── Reflection ──
        vec2 screenUV = vScreenPos.xy / vScreenPos.w * 0.5 + 0.5;
        vec2 distortion = vNormal.xz * 0.03;
        vec2 reflUV = vec2(screenUV.x + distortion.x, 1.0 - screenUV.y + distortion.y);
        reflUV = clamp(reflUV, 0.001, 0.999);
        vec3 reflCol = texture2D(uReflection, reflUV).rgb;

        // Fresnel — more reflection at grazing angles
        float fresnel = 1.0 - max(dot(vNormal, viewDir), 0.0);
        fresnel = pow(fresnel, 3.0);
        float reflStrength = 0.15 + fresnel * 0.45;
        col = mix(col, reflCol, reflStrength);

        // Specular highlight from sun — stronger in sun direction
        vec3 halfDir = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(vNormal, halfDir), 0.0), 64.0);
        col += vec3(1.0, 0.98, 0.9) * step(0.35, spec) * 0.35;

        // ── Sun glitter — stronger toward sun, spreads with distance ──
        float sunAlign = max(dot(normalize(vWorldPos.xz), uSunDir.xz), 0.0);
        float glitterZone = pow(sunAlign, 3.0); // concentrated in sun direction
        float wx = vWorldPos.x + sin(vWorldPos.z * 1.3) * 0.4;
        float wz = vWorldPos.z + sin(vWorldPos.x * 1.7) * 0.3;
        float sp1 = sin(wx * 4.5 + uTime * 2.0) * sin(wz * 3.8 + uTime * 1.3);
        float sp2 = sin(wx * 2.7 - uTime * 1.1) * sin(wz * 3.2 - uTime * 0.8);
        float sp3 = sin(wx * 6.1 + uTime * 2.5) * sin(wz * 5.3 + uTime * 1.8);
        float glint = step(0.82, max(max(sp1, sp2), sp3));
        col += glint * (0.04 + glitterZone * 0.12);

        // ── Underwater reef hints ──
        // Scattered reef patches visible through shallow water
        float reefNoise = sin(vWorldPos.x * 2.1 + 3.0) * sin(vWorldPos.z * 1.8 + 5.0);
        float reefPatch = step(0.7, reefNoise) * smoothstep(3.0, 0.5, dist) * smoothstep(-2.0, 0.0, dist);
        vec3 reefCol = vec3(0.35, 0.55, 0.45);
        col = mix(col, reefCol, reefPatch * 0.3);

        // Alpha — transparent near shore, solid in deep
        float shoreAlpha = smoothstep(-1.5, 2.0, dist);
        float alpha = mix(0.3, 0.9, shoreAlpha);
        // Deep water is more opaque
        alpha = mix(alpha, 0.95, deepFactor);

        // Dithering
        col += vec3(dither(gl_FragCoord.xy));
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
  });

  const oceanGeo = new THREE.PlaneGeometry(500, 500, 160, 160);
  oceanMesh = new THREE.Mesh(oceanGeo, waterMat);
  oceanMesh.rotation.x = -Math.PI / 2;
  oceanMesh.position.y = WATER_Y;
  oceanMesh.receiveShadow = true;
  scene.add(oceanMesh);

  // ── Beach/sand — irregular ring following island outline ──
  const sandSegs = 96;
  const sandGeo = new THREE.BufferGeometry();
  const sandVerts = [], sandUvs = [], sandIdxs = [];
  for (let i = 0; i <= sandSegs; i++) {
    const a = (i / sandSegs) * Math.PI * 2;
    const r = getIslandRadius(a);
    const cos = Math.cos(a), sin = Math.sin(a);
    const u = i / sandSegs;
    // Inner edge — overlaps terrain by 0.8 units for seamless blend
    const innerR = r - 0.8;
    const innerY = getTerrainHeight(cos * innerR, sin * innerR) * 0.5;
    sandVerts.push(cos * innerR, Math.max(innerY, -0.04), sin * innerR);
    sandUvs.push(u, 0);
    // Outer edge (into water — varied beach width)
    const beachW = 0.4 + Math.sin(a * 3.7) * 0.2 + Math.sin(a * 7.1) * 0.1;
    sandVerts.push(cos * (r + beachW), -0.12, sin * (r + beachW));
    sandUvs.push(u, 1);
    if (i < sandSegs) {
      const vi = i * 2;
      sandIdxs.push(vi, vi + 1, vi + 2, vi + 2, vi + 1, vi + 3);
    }
  }
  sandGeo.setAttribute("position", new THREE.Float32BufferAttribute(sandVerts, 3));
  sandGeo.setAttribute("uv", new THREE.Float32BufferAttribute(sandUvs, 2));
  sandGeo.setIndex(sandIdxs);
  sandGeo.computeVertexNormals();
  const sandRing = new THREE.Mesh(sandGeo, mt(0xd8cca8, { roughness: 0.95 }));
  scene.add(sandRing);

  // ── Foam/wave line — follows irregular shoreline ──
  const foamSegs = 96;
  const foamGeo = new THREE.BufferGeometry();
  const foamVerts = [], foamUvs = [], foamIdxs = [];
  for (let i = 0; i <= foamSegs; i++) {
    const a = (i / foamSegs) * Math.PI * 2;
    const r = getIslandRadius(a);
    const cos = Math.cos(a), sin = Math.sin(a);
    const beachW = 0.4 + Math.sin(a * 3.7) * 0.2 + Math.sin(a * 7.1) * 0.1;
    const foamInner = r + beachW;
    foamVerts.push(cos * foamInner, -0.16, sin * foamInner);
    foamUvs.push(i / foamSegs, 0);
    foamVerts.push(cos * (foamInner + 0.4), -0.18, sin * (foamInner + 0.4));
    foamUvs.push(i / foamSegs, 1);
    if (i < foamSegs) {
      const vi = i * 2;
      foamIdxs.push(vi, vi + 1, vi + 2, vi + 2, vi + 1, vi + 3);
    }
  }
  foamGeo.setAttribute("position", new THREE.Float32BufferAttribute(foamVerts, 3));
  foamGeo.setAttribute("uv", new THREE.Float32BufferAttribute(foamUvs, 2));
  foamGeo.setIndex(foamIdxs);
  foamGeo.computeVertexNormals();
  const foamMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
  });
  const foam = new THREE.Mesh(foamGeo, foamMat);
  scene.add(foam);
  animatedObjects.push({ type: "foam", mesh: foam, mat: foamMat });

  // ── Coastal rocks — placed along irregular shoreline ──
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
    const r = getIslandRadius(a);
    const x = Math.cos(a) * (r - 0.2 + Math.random() * 0.5);
    const z = Math.sin(a) * (r - 0.2 + Math.random() * 0.5);
    const s = 0.08 + Math.random() * 0.1;
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(s, 1),
      mt(STONE, { roughness: 0.95 }));
    rock.position.set(x, -0.06, z);
    rock.scale.y = 0.5 + Math.random() * 0.3;
    rock.rotation.set(Math.random() * 0.5, Math.random() * 2, Math.random() * 0.3);
    rock.castShadow = true;
    scene.add(rock);
  }
}

/* ═══════════════════════════════════════════════════════════
   Market — neutral fifth zone
   ═══════════════════════════════════════════════════════════ */

function createMarket() {
  const mx = 0, mz = -8;
  const mktY = getTerrainHeight(mx, mz);
  // Ground patch
  const ground = makeGroundPatch(1.5, DIRT);
  ground.position.set(mx, mktY + 0.006, mz);
  scene.add(ground);

  // Stall 1 — open tent
  const stallG = new THREE.Group();
  stallG.position.set(mx - 0.6, mktY, mz);
  for (const [px, pz] of [[-0.2, -0.12], [0.2, -0.12], [-0.2, 0.12], [0.2, 0.12]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.4, 4), mt(WOOD_D));
    post.position.set(px, 0.2, pz); stallG.add(post);
  }
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.015, 0.3), mt(0xc49a5c));
  canopy.position.y = 0.41; canopy.castShadow = true; stallG.add(canopy);
  // Goods on counter
  const counter = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.18), mt(WOOD));
  counter.position.y = 0.2; stallG.add(counter);
  for (let i = 0; i < 4; i++) {
    const item = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4),
      mt([0xe8a060, 0xc45454, 0x6aa05a, 0xc4a040][i]));
    item.position.set(-0.12 + i * 0.08, 0.24, 0); stallG.add(item);
  }
  scene.add(stallG);

  // Stall 2 — book/scroll vendor
  const stall2 = new THREE.Group();
  stall2.position.set(mx + 0.6, mktY, mz);
  for (const [px, pz] of [[-0.18, -0.1], [0.18, -0.1], [-0.18, 0.1], [0.18, 0.1]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.4, 4), mt(WOOD_D));
    post.position.set(px, 0.2, pz); stall2.add(post);
  }
  const canopy2 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.015, 0.26), mt(0x8b7baa));
  canopy2.position.y = 0.41; canopy2.castShadow = true; stall2.add(canopy2);
  const counter2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.16), mt(WOOD));
  counter2.position.y = 0.2; stall2.add(counter2);
  // Scrolls
  for (let i = 0; i < 3; i++) {
    const scroll = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 5), mt(CREAM));
    scroll.position.set(-0.1 + i * 0.1, 0.24, 0); scroll.rotation.z = Math.PI / 2; stall2.add(scroll);
  }
  scene.add(stall2);

  // Well/fountain at market center
  const wellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 8), mt(STONE));
  wellBase.position.set(mx, 0.06, mz - 0.5); scene.add(wellBase);
  const wellWater = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 8),
    mt(WATER, { roughness: 0.05, transparent: true, opacity: 0.5 }));
  wellWater.position.set(mx, 0.13, mz - 0.5); scene.add(wellWater);

  // Crates and barrels
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.12, 6), mt(WOOD_D));
  barrel.position.set(mx + 0.3, 0.06, mz + 0.5); scene.add(barrel);
  const barrel2 = barrel.clone();
  barrel2.position.set(mx + 0.45, 0.06, mz + 0.4); scene.add(barrel2);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), mt(WOOD));
  crate.position.set(mx - 0.4, 0.05, mz + 0.45); scene.add(crate);
}

/* ═══════════════════════════════════════════════════════════
   Stream & Bridges
   ═══════════════════════════════════════════════════════════ */

function createStream() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(10, 0.015, -3),
    new THREE.Vector3(7, 0.015, -1.5),
    new THREE.Vector3(4, 0.015, -0.3),
    new THREE.Vector3(1.5, 0.015, 0.8),
    new THREE.Vector3(-1, 0.015, 1.5),
    new THREE.Vector3(-3.5, 0.015, 2.5),
    new THREE.Vector3(-6, 0.015, 3.5),
    new THREE.Vector3(-8.5, 0.015, 4.5),
    new THREE.Vector3(-10.5, 0.015, 5),
  ], false, "catmullrom", 0.5);

  const tubeGeo = new THREE.TubeGeometry(curve, 50, 0.22, 6, false);
  const tubePos = tubeGeo.attributes.position;
  for (let i = 0; i < tubePos.count; i++) {
    const y = tubePos.getY(i);
    tubePos.setY(i, 0.015 + (y - 0.015) * 0.04);
  }
  tubeGeo.computeVertexNormals();
  const water = new THREE.Mesh(tubeGeo,
    mt(WATER, { roughness: 0.05, transparent: true, opacity: 0.55 }));
  scene.add(water);

  // Banks
  const bankGeo = new THREE.TubeGeometry(curve, 50, 0.28, 6, false);
  const bankPos = bankGeo.attributes.position;
  for (let i = 0; i < bankPos.count; i++) {
    const y = bankPos.getY(i);
    bankPos.setY(i, 0.005 + (y - 0.015) * 0.02);
  }
  bankGeo.computeVertexNormals();
  const banks = new THREE.Mesh(bankGeo, mt(0xb8b0a0, { roughness: 0.95 }));
  scene.add(banks);

  createBridge(1.5, 0.8, -Math.PI / 6);
  createBridge(-3.5, 2.5, -Math.PI / 5);
  createBridge(-7, 4, -Math.PI / 5.5);
}

function buildRopeBridge(x1, z1, x2, z2, opts) {
  opts = opts || {};
  const bg = new THREE.Group();
  const col = opts.color || WOOD, colD = opts.colorD || WOOD_D;
  const ropeCol = opts.ropeColor || 0x7a6a50;
  const w = opts.width || 0.45, sagAmt = opts.sag !== undefined ? opts.sag : 0.06;
  const baseY = opts.baseY || 0, capCol = opts.capColor || null;
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dz * dz);
  const ang = Math.atan2(dz, dx);
  const perpX = -Math.sin(ang), perpZ = Math.cos(ang);
  const gap = 0.25, segs = Math.max(4, Math.floor(len / gap));
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push({ x: x1 + dx * t, z: z1 + dz * t, y: baseY - sagAmt * 4 * t * (1 - t), t });
  }
  for (let i = 0; i < segs; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const plank = new THREE.Mesh(new THREE.BoxGeometry(gap * 0.7, 0.02, w), mt(i % 2 === 0 ? col : colD));
    plank.position.set((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
    plank.rotation.y = -ang + (Math.random() - 0.5) * 0.015;
    plank.castShadow = true; bg.add(plank);
  }
  const ropeH = 0.14;
  for (const side of [-1, 1]) {
    const offX = perpX * (w / 2) * side, offZ = perpZ * (w / 2) * side;
    for (let i = 0; i < segs; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const rs0 = -sagAmt * 0.3 * 4 * p0.t * (1 - p0.t);
      const rs1 = -sagAmt * 0.3 * 4 * p1.t * (1 - p1.t);
      const rx0 = p0.x + offX, rz0 = p0.z + offZ, ry0 = p0.y + ropeH + rs0;
      const rx1 = p1.x + offX, rz1 = p1.z + offZ, ry1 = p1.y + ropeH + rs1;
      const sl = Math.sqrt((rx1 - rx0) ** 2 + (ry1 - ry0) ** 2 + (rz1 - rz0) ** 2);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, sl, 3), mt(ropeCol));
      rope.position.set((rx0 + rx1) / 2, (ry0 + ry1) / 2, (rz0 + rz1) / 2);
      rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(rx1 - rx0, ry1 - ry0, rz1 - rz0).normalize());
      bg.add(rope);
    }
    for (let i = 0; i <= segs; i += 3) {
      const p = pts[i], rs = -sagAmt * 0.3 * 4 * p.t * (1 - p.t);
      const topY = p.y + ropeH + rs, botY = p.y + 0.01, h = topY - botY;
      if (h > 0.02) {
        const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, h, 3), mt(ropeCol));
        tie.position.set(p.x + offX, botY + h / 2, p.z + offZ); bg.add(tie);
      }
    }
  }
  for (const tidx of [0, segs]) {
    const p = pts[tidx];
    for (const side of [-1, 1]) {
      const ox = perpX * (w / 2) * side, oz = perpZ * (w / 2) * side;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.25, 5), mt(colD));
      post.position.set(p.x + ox, p.y + 0.07, p.z + oz);
      bg.add(post);
      if (capCol) {
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4),
          mt(capCol, { roughness: 0.2, metalness: 0.8 }));
        cap.position.set(p.x + ox, p.y + 0.19, p.z + oz); bg.add(cap);
      }
    }
  }
  return bg;
}
function createBridge(x, z, rot) {
  const bg = new THREE.Group();
  bg.position.set(x, 0, z);
  bg.rotation.y = rot;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.035, 0.22), mt(WOOD));
  deck.position.y = 0.08; deck.castShadow = true; bg.add(deck);
  const archCenter = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.22), mt(WOOD));
  archCenter.position.y = 0.1; bg.add(archCenter);
  for (const rz of [-0.1, 0.1]) {
    for (const rx of [-0.22, -0.08, 0.08, 0.22]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), mt(WOOD_D));
      post.position.set(rx, 0.14, rz); bg.add(post);
    }
    const railBar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.012), mt(WOOD_D));
    railBar.position.set(0, 0.18, rz); bg.add(railBar);
  }
  scene.add(bg);
}

/* ═══════════════════════════════════════════════════════════
   Worn Paths — clearly visible dirt strips
   ═══════════════════════════════════════════════════════════ */

function createPaths() {
  const pathMat = mt(DIRT, { roughness: 0.95 });
  const pathEdgeMat = mt(DIRT_D, { roughness: 0.95 });

  const layPath = (curve, opts = {}) => {
    const points = curve.getPoints(28);
    const baseWidth = opts.width || 0.38;
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const dx = p2.x - p1.x, dz = p2.z - p1.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const width = baseWidth + Math.sin(i * 1.3) * 0.06;

      const midX = (p1.x + p2.x) / 2, midZ = (p1.z + p2.z) / 2;
      const midY = getTerrainHeight(midX, midZ);
      const edgeSeg = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.01, len * 1.05), pathEdgeMat);
      edgeSeg.position.set(midX, midY + 0.004, midZ);
      edgeSeg.rotation.y = angle;
      edgeSeg.receiveShadow = true;
      scene.add(edgeSeg);

      const seg = new THREE.Mesh(new THREE.BoxGeometry(width, 0.014, len * 1.05), pathMat);
      seg.position.set(midX, midY + 0.008, midZ);
      seg.rotation.y = angle;
      seg.receiveShadow = true;
      scene.add(seg);


    }
  };

  // Paths from each district to the plaza
  ROLES.forEach((role) => {
    const [hx, , hz] = role.home;
    const midX = hx * 0.4 + (Math.random() - 0.5) * 0.8;
    const midZ = hz * 0.4 + (Math.random() - 0.5) * 0.8;
    layPath(new THREE.CatmullRomCurve3([
      new THREE.Vector3(hx, 0, hz),
      new THREE.Vector3(hx * 0.65, 0, hz * 0.65),
      new THREE.Vector3(midX, 0, midZ),
      new THREE.Vector3(hx * 0.1, 0, hz * 0.1),
    ], false, "catmullrom", 0.5));
  });

  // Path from plaza to market
  layPath(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-1, 0, -3),
    new THREE.Vector3(-0.5, 0, -5.5),
    new THREE.Vector3(0, 0, -8),
  ], false, "catmullrom", 0.5));

  // Path from plaza to dock
  layPath(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(3, 0, 2),
    new THREE.Vector3(5.5, 0, 3.5),
    new THREE.Vector3(8, 0, 5),
  ], false, "catmullrom", 0.5));



}


/* ═══════════════════════════════════════════════════════════
   Working Areas — quarry, boatyard, construction scaffolding
   ═══════════════════════════════════════════════════════════ */

function createWorkingAreas() {
  // ── Quarry (NE, near rock outcrops) ──
  const qx = 6, qz = -3, qy = getTerrainHeight(qx, qz);
  for (let ring = 0; ring < 3; ring++) {
    const r = 0.6 - ring * 0.18, depth = ring * 0.04;
    const pit = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r + 0.05, 0.03, 8),
      mt(ring === 0 ? 0xc8c0b0 : 0xb8b0a0, { roughness: 0.95 }));
    pit.position.set(qx, qy - depth, qz); pit.receiveShadow = true; scene.add(pit);
  }
  for (let i = 0; i < 8; i++) {
    const bw = 0.08 + Math.random() * 0.06, bh = 0.05 + Math.random() * 0.04;
    const block = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06 + Math.random() * 0.05), mt(STONE, { roughness: 0.9 }));
    const row = Math.floor(i / 4);
    block.position.set(qx + 0.9 + (i % 4) * 0.12 - 0.2, qy + bh / 2 + row * 0.06, qz + 0.3 + row * 0.12);
    block.rotation.y = Math.random() * 0.2; block.castShadow = true; scene.add(block);
  }
  const pickHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 4), mt(WOOD));
  pickHandle.position.set(qx + 1.1, qy + 0.12, qz + 0.2); pickHandle.rotation.z = 0.3; scene.add(pickHandle);
  const pickHead = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.025), mt(0x555555));
  pickHead.position.set(qx + 1.14, qy + 0.23, qz + 0.2); pickHead.rotation.z = 0.3; scene.add(pickHead);

  // ── Boatyard (near dock, SE) ──
  const byx = 7, byz = 4, byy = getTerrainHeight(byx, byz);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.8), mt(WOOD));
  keel.position.set(byx, byy + 0.08, byz); scene.add(keel);
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.3 - Math.abs(i - 2) * 0.04, 0.02, 0.02), mt(WOOD));
    rib.position.set(byx, byy + 0.12 + i * 0.005, byz - 0.3 + i * 0.15); rib.castShadow = true; scene.add(rib);
    for (const side of [-1, 1]) {
      const ribSide = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), mt(WOOD));
      ribSide.position.set(byx + side * (0.14 - Math.abs(i - 2) * 0.02), byy + 0.16, byz - 0.3 + i * 0.15);
      ribSide.rotation.z = side * 0.3; scene.add(ribSide);
    }
  }
  for (const sx of [-0.5, 0.6]) {
    for (const [dz, rz] of [[0, 0.15], [0.08, -0.15]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.15, 0.015), mt(WOOD_D));
      leg.position.set(byx + sx + dz, byy + 0.075, byz + 0.5); leg.rotation.z = rz; scene.add(leg);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.04), mt(WOOD));
    bar.position.set(byx + sx + 0.04, byy + 0.14, byz + 0.5); scene.add(bar);
  }
  const plnk = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.015, 0.08), mt(WOOD));
  plnk.position.set(byx + 0.05, byy + 0.16, byz + 0.5); plnk.castShadow = true; scene.add(plnk);

  // ── Construction scaffolding (SW) ──
  const scx = -5, scz = 3, scy = getTerrainHeight(scx, scz);
  const scaffMat = mt(WOOD_D, { roughness: 0.9 });
  for (const [ox, oz] of [[0, 0], [0.5, 0], [0, 0.3], [0.5, 0.3]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 4), scaffMat);
    pole.position.set(scx + ox, scy + 0.35, scz + oz); scene.add(pole);
  }
  for (const h of [0.25, 0.5]) {
    for (const oz of [0, 0.3]) {
      const bm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.018, 0.018), scaffMat);
      bm.position.set(scx + 0.25, scy + h, scz + oz); scene.add(bm);
    }
    for (const ox of [0, 0.5]) {
      const bm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.3), scaffMat);
      bm.position.set(scx + ox, scy + h, scz + 0.15); scene.add(bm);
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.012, 0.28), mt(WOOD));
    plat.position.set(scx + 0.25, scy + h + 0.01, scz + 0.15); plat.receiveShadow = true; scene.add(plat);
  }
}

/* ═══════════════════════════════════════════════════════════
   Social Spaces — amphitheater, garden, picnic area, market stalls
   ═══════════════════════════════════════════════════════════ */

function createSocialSpaces() {
  // ── Amphitheater (NE area) ──
  const ax = 3, az = -5, ay = getTerrainHeight(ax, az);
  for (let row = 0; row < 3; row++) {
    const r = 0.8 + row * 0.35, h = row * 0.06;
    for (let s = 0; s < 7; s++) {
      const ang = -0.8 + (s / 6) * 1.6;
      const sx = ax + Math.cos(ang) * r, sz = az + Math.sin(ang) * r;
      const sy = getTerrainHeight(sx, sz);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.1), mt(STONE, { roughness: 0.9 }));
      seat.position.set(sx, sy + 0.02 + h, sz); seat.rotation.y = ang + Math.PI / 2;
      seat.castShadow = true; seat.receiveShadow = true; scene.add(seat);
    }
  }
  const stg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.04, 8), mt(WOOD, { roughness: 0.85 }));
  stg.position.set(ax, ay + 0.02, az); stg.receiveShadow = true; scene.add(stg);

  // ── Picnic area (central-E) ──
  const px = 2.5, pz = 1.5, py = getTerrainHeight(px, pz);
  const ptTop = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.2), mt(WOOD));
  ptTop.position.set(px, py + 0.12, pz); ptTop.castShadow = true; scene.add(ptTop);
  for (const lx of [-0.15, 0.15]) {
    const ptLeg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.18), mt(WOOD_D));
    ptLeg.position.set(px + lx, py + 0.06, pz); scene.add(ptLeg);
  }
  for (const bz of [-0.15, 0.15]) {
    const bn = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.015, 0.06), mt(WOOD));
    bn.position.set(px, py + 0.07, pz + bz); scene.add(bn);
  }


  // ── Extra market stalls (S) ──
  for (let i = 0; i < 3; i++) {
    const stx = -1.5 + i * 1.0, stz = -7 + (i % 2) * 0.3, sty = getTerrainHeight(stx, stz);
    for (const ox of [-0.15, 0.15]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.35, 4), mt(WOOD_D));
      post.position.set(stx + ox, sty + 0.175, stz); scene.add(post);
    }
    const awn = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.01, 0.25),
      mt([0xcc3333, 0x3366aa, 0xddaa22][i], { roughness: 0.8 }));
    awn.position.set(stx, sty + 0.34, stz); awn.rotation.z = 0.08; awn.castShadow = true; scene.add(awn);
    const ctr = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.15), mt(WOOD));
    ctr.position.set(stx, sty + 0.18, stz + 0.05); ctr.castShadow = true; scene.add(ctr);

  }
}

/* ═══════════════════════════════════════════════════════════
   Activity Details — laundry, smoke, tools, carts
   ═══════════════════════════════════════════════════════════ */

function createActivityDetails() {

  // ── Chimney stacks ──
  [[-5, -5], [5, -5], [-4, 3]].forEach(([cx, cz]) => {
    const cy = getTerrainHeight(cx, cz);
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), mt(0x8a6644));
    chim.position.set(cx + 0.15, cy + 0.45, cz + 0.1); scene.add(chim);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.08), mt(STONE));
    cap.position.set(cx + 0.15, cy + 0.515, cz + 0.1); scene.add(cap);
  });

  // ── Wheelbarrow near quarry ──
  const wbx = 6.8, wbz = -2.5, wby = getTerrainHeight(wbx, wbz);
  const wbTray = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.1), mt(WOOD));
  wbTray.position.set(wbx, wby + 0.06, wbz); wbTray.rotation.x = -0.2; wbTray.castShadow = true; scene.add(wbTray);
  const wbWhl = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 4, 8), mt(0x686868));
  wbWhl.position.set(wbx + 0.1, wby + 0.035, wbz); wbWhl.rotation.y = Math.PI / 2; scene.add(wbWhl);
  for (const sd of [-0.04, 0.04]) {
    const hdl = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 3), mt(WOOD_D));
    hdl.position.set(wbx - 0.12, wby + 0.08, wbz + sd); hdl.rotation.z = 0.6; scene.add(hdl);
  }

  // ── Cart near market ──
  const crtX = -0.5, crtZ = -6.5, crtY = getTerrainHeight(crtX, crtZ);
  const crtBed = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.18), mt(WOOD));
  crtBed.position.set(crtX, crtY + 0.08, crtZ); crtBed.castShadow = true; scene.add(crtBed);
  for (const sd of [-0.08, 0.08]) {
    const cSd = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 0.015), mt(WOOD_D));
    cSd.position.set(crtX, crtY + 0.12, crtZ + sd); cSd.castShadow = true; scene.add(cSd);
  }
  for (const wx of [-0.12, 0.12]) {
    const whl = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 4, 8), mt(0x555555));
    whl.position.set(crtX + wx, crtY + 0.04, crtZ + 0.1); whl.rotation.x = Math.PI / 2; scene.add(whl);
  }
  for (let i = 0; i < 3; i++) {
    const crt = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.07), mt(i % 2 === 0 ? WOOD : WOOD_D));
    crt.position.set(crtX - 0.08 + i * 0.1, crtY + 0.12, crtZ);
    crt.rotation.y = Math.random() * 0.3; scene.add(crt);
  }

  // ── Barrels near dock ──
  [[7.5, 5.5], [7.8, 5.2], [7.3, 5.8]].forEach(([bx, bz], i) => {
    const by = getTerrainHeight(bx, bz);
    const brl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.12, 8),
      mt(i === 0 ? WOOD : WOOD_D, { roughness: 0.9 }));
    brl.position.set(bx, by + 0.06, bz);
    if (i === 2) { brl.rotation.x = 0.3; brl.position.y = by + 0.04; }
    brl.castShadow = true; scene.add(brl);
    for (const bh of [-0.03, 0.03]) {
      const bnd = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.004, 4, 8), mt(0x686868));
      bnd.position.set(bx, by + 0.06 + bh, bz); scene.add(bnd);
    }
  });

  // ── Rope coils at dock ──
  for (let i = 0; i < 2; i++) {
    const rx = 8.2 + i * 0.4, rz = 5 + i * 0.3, ry = getTerrainHeight(rx, rz);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 5, 12), mt(0x9a8a60, { roughness: 0.95 }));
    coil.position.set(rx, ry + 0.015, rz); coil.rotation.x = -Math.PI / 2; scene.add(coil);
  }
}

/* ═══════════════════════════════════════════════════════════
   Plaza — town center
   ═══════════════════════════════════════════════════════════ */

function createPlaza() {
  const plazaY = getTerrainHeight(0, 0);
  const pave = new THREE.Mesh(
    new THREE.CylinderGeometry(PLAZA_R + 0.3, PLAZA_R + 0.3, 0.04, 24),
    mt(STONE, { roughness: 0.95 }));
  pave.position.y = plazaY + 0.02; pave.receiveShadow = true; scene.add(pave);

  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(PLAZA_R + 0.3, 0.025, 6, 24), mt(WOOD_D));
  outerRing.rotation.x = -Math.PI / 2; outerRing.position.y = plazaY + 0.045; scene.add(outerRing);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(PLAZA_R - 0.2, 0.012, 4, 16), mt(WOOD));
  innerRing.rotation.x = -Math.PI / 2; innerRing.position.y = plazaY + 0.045; scene.add(innerRing);

  const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.035, 12), mt(WOOD));
  tableTop.position.y = plazaY + 0.28; tableTop.castShadow = true; tableTop.receiveShadow = true; scene.add(tableTop);
  const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.25, 6), mt(WOOD_D));
  tableLeg.position.y = plazaY + 0.13; scene.add(tableLeg);
  // Contact shadow under table
  const tableShadow = makeContactShadow(0.4);
  tableShadow.position.y = plazaY + 0.025; scene.add(tableShadow);

  ROLES.forEach((role, i) => {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 6), mt(role.body));
    stool.position.set(Math.cos(angle) * 0.65, plazaY + 0.06, Math.sin(angle) * 0.65);
    scene.add(stool);
  });

  // Low decorative posts with lanterns
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.3, 4), mt(WOOD_D));
    post.position.set(Math.cos(a) * 0.55, plazaY + 0.15, Math.sin(a) * 0.55);
    scene.add(post);
    // (glow sphere removed — looked like floating dot)
  }

  const plazaLight = new THREE.PointLight(0xfff0d0, 0.5, 5);
  plazaLight.position.set(0, plazaY + 0.8, 0); scene.add(plazaLight);
}

function addPaperToTable(agent) {
  const angle = agent.config.angle + (Math.random() - 0.5) * 0.5;
  const r = 0.08 + Math.random() * 0.18;
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.004, 0.075),
    mt(agent.config.body, { roughness: 0.5 }));
  paper.position.set(Math.cos(angle) * r, getTerrainHeight(0, 0) + 0.3 + tablePapers.length * 0.005, Math.sin(angle) * r);
  paper.rotation.y = angle + Math.random() * 0.4;
  paper.scale.set(0, 0, 0); paper.userData.scaleT = 0;
  scene.add(paper); tablePapers.push(paper);
  if (tablePapers.length > 14) {
    const old = tablePapers.shift(); scene.remove(old);
    old.geometry.dispose(); old.material.dispose();
  }
  addTowerBlock(agent);
}

function addTowerBlock(agent) {
  const blockTypes = [
    () => new THREE.BoxGeometry(0.12, 0.06, 0.12),
    () => new THREE.CylinderGeometry(0.06, 0.06, 0.06, 6),
    () => new THREE.ConeGeometry(0.07, 0.08, 5),
    () => new THREE.DodecahedronGeometry(0.045, 0),
  ];
  const geoFn = blockTypes[agent.index % blockTypes.length];
  const block = new THREE.Mesh(geoFn(),
    mt(agent.config.body, { emissive: agent.config.body, emissiveIntensity: 0.1, roughness: 0.5 }));
  const layer = Math.floor(towerBlocks.length / 4);
  const slot = towerBlocks.length % 4;
  const angle = (slot * Math.PI) / 2 + layer * 0.3;
  const radius = 0.08 + (layer % 2) * 0.04;
  const yPos = getTerrainHeight(0, 0) + 0.33 + layer * 0.065;
  block.position.set(Math.cos(angle) * radius, yPos, Math.sin(angle) * radius);
  block.rotation.y = angle + Math.random() * 0.5;
  block.scale.set(0, 0, 0); block.userData.scaleT = 0; block.userData.targetY = yPos;
  block.castShadow = true;
  scene.add(block); towerBlocks.push(block);
  towerHeight = yPos + 0.06;
  if (towerBlocks.length > 28) {
    const old = towerBlocks.shift(); scene.remove(old);
    old.geometry.dispose(); old.material.dispose();
  }
}

/* ═══════════════════════════════════════════════════════════
   Vegetation — dense groves, not sparse scatter
   ═══════════════════════════════════════════════════════════ */

function createVegetation() {
  // ── Tree shape variants ──
  // 0 = deciduous (dodecahedron), 1 = round (icosahedron), 2 = conifer (cone)
  const makeTreeCrown = (cr, shape, color) => {
    const windMat = mtWind(color, { heightFactor: 2.5, swayAmp: 0.03, swaySpeed: 0.8 });
    if (shape === 1) return new THREE.Mesh(new THREE.IcosahedronGeometry(cr, 0), windMat);
    if (shape === 2) return new THREE.Mesh(new THREE.ConeGeometry(cr * 0.7, cr * 2.2, 6), windMat);
    return new THREE.Mesh(new THREE.DodecahedronGeometry(cr, 0), windMat);
  };

  // Size tiers: 0=small(0.6x) 1=medium(1x) 2=large(1.4x)
  const SIZES = [0.6, 1.0, 1.4];

  const addTree = (x, z, tier, shape, baseC) => {
    const s = SIZES[tier];
    const h = (0.22 + Math.random() * 0.1) * s;
    const cr = (0.15 + Math.random() * 0.05) * s;
    const groundY = getTerrainHeight(x, z);
    // Color jitter
    const hsl = {}; new THREE.Color(baseC).getHSL(hsl);
    hsl.h += (Math.random() - 0.5) * 0.04;
    hsl.l += (Math.random() - 0.5) * 0.06;
    const col = new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0.1, Math.min(0.9, hsl.l)));
    // Trunk variation
    const tHsl = {}; new THREE.Color(TRUNK).getHSL(tHsl);
    tHsl.l += (Math.random() - 0.5) * 0.05;
    const trunkCol = new THREE.Color().setHSL(tHsl.h, tHsl.s, Math.max(0.15, Math.min(0.7, tHsl.l)));
    // Contact shadow
    const sh = makeContactShadow(cr * 0.6);
    sh.position.set(x, groundY + 0.005, z); scene.add(sh);
    // Trunk
    const trunkR = (shape === 2 ? 0.018 : 0.025) * s;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkR * 0.7, trunkR, h, 5), mt(trunkCol.getHex()));
    trunk.position.set(x, groundY + h / 2, z); trunk.castShadow = true; scene.add(trunk);
    // Crown
    const crownY = groundY + (shape === 2 ? h + cr * 0.8 : h + cr * 0.5);
    const crown = makeTreeCrown(cr, shape, col.getHex());
    crown.position.set(x, crownY, z); crown.castShadow = true; scene.add(crown);
  };

  // Helper: scatter trees in a cluster around a center
  const addGrove = (cx, cz, count, radius, colors) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * radius;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      // Vary tier: mostly medium, some small, a few large
      const r = Math.random();
      const tier = r < 0.3 ? 0 : r < 0.8 ? 1 : 2;
      // Vary shape: 60% deciduous, 25% round, 15% conifer
      const sr = Math.random();
      const shape = sr < 0.6 ? 0 : sr < 0.85 ? 1 : 2;
      const col = colors[Math.floor(Math.random() * colors.length)];
      addTree(x, z, tier, shape, col);
    }
  };

  // ── GROVE 1: Between Literature [-6,-6] and Hypothesis [6,-6] — north edge ──
  addGrove(-1, -10.5, 10, 2.5, [GREEN_L, GREEN_D]);

  // ── GROVE 2: Between Design [6,6] and Analysis [-6,6] — south edge ──
  addGrove(1, 10.5, 9, 2.5, [GREEN_L, GREEN_D]);

  // ── GROVE 3: East of Hypothesis — island edge ──
  addGrove(10.5, -2.5, 8, 2, [GREEN_D, GREEN_VD]);

  // ── GROVE 4: West of Literature — island edge ──
  addGrove(-10.5, -2.5, 8, 2, [GREEN_L, GREEN_D]);

  // ── GROVE 5: East of Design — island edge ──
  addGrove(10.5, 3, 7, 1.8, [GREEN_D, GREEN_VD]);

  // ── GROVE 6: West of Analysis — island edge, on the hill ──
  addGrove(-10, 5.5, 6, 2, [GREEN_VD, GREEN_D]);

  // ── GROVE 7: Near-right foreground (SE corner, partially cropped by frame) ──
  addGrove(10, 7, 6, 1.5, [GREEN_D, GREEN_VD]);

  // ── GROVE 8: Near-left foreground (E, close to camera) ──
  addGrove(9, 10, 5, 1.2, [GREEN_L, GREEN_D]);

  // ── GROVE 9: Near-bottom foreground framing (S-SE) ──
  addGrove(3, 9.5, 4, 1.0, [GREEN_D, GREEN_L, GREEN_VD]);

  // ── Sparse individuals along paths (3-4 only, for rhythm) ──
  addTree(-3, -3, 1, 0, GREEN_L);   // Literature path
  addTree(3, 3, 1, 1, GREEN_D);     // Design path
  addTree(-3, 3, 0, 2, GREEN_VD);   // Analysis path side
  addTree(8, 5, 2, 0, GREEN_D);     // near foreground individual
  addTree(5.5, 9, 1, 2, GREEN_VD);  // foreground conifer

  // ── Bush clusters — near groves only, not in open grass ──
  const addBush = (x, z, r) => {
    const hsl = {}; new THREE.Color(Math.random() > 0.5 ? GREEN_D : GREEN_VD).getHSL(hsl);
    hsl.h += (Math.random() - 0.5) * 0.03;
    hsl.l += (Math.random() - 0.5) * 0.06;
    const bush = new THREE.Mesh(new THREE.SphereGeometry(r, 5, 4),
      mt(new THREE.Color().setHSL(hsl.h, hsl.s, Math.max(0.15, Math.min(0.85, hsl.l))).getHex()));
    bush.position.set(x, r * 0.6, z); bush.castShadow = true; scene.add(bush);
  };
  // Bush clusters at grove edges (not in open lawn)
  [[-2.5, -7], [0.5, -9], [9, -1], [-9, -1], [9, 4], [-9, 5],
   [2, 9], [-1, 8], [-5, -7.5], [6, -7]].forEach(([x, z]) => {
    for (let i = 0; i < 3; i++) {
      addBush(x + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6,
        0.06 + Math.random() * 0.05);
    }
  });

  // ── Ground detail: grass tufts, flowers, rocks — CLUSTERED near trees, paths, buildings ──
  const detailZones = [
    // Near plaza (highest density)
    { cx: 0, cz: 0, r: 2.5, grass: 18, flowers: 0, rocks: 0 },
    { cx: -3, cz: -3, r: 1.5, grass: 8, flowers: 0, rocks: 0 },
    { cx: 3, cz: -3, r: 1.5, grass: 8, flowers: 0, rocks: 0 },
    { cx: 3, cz: 3, r: 1.5, grass: 8, flowers: 0, rocks: 0 },
    { cx: -3, cz: 3, r: 1.5, grass: 8, flowers: 0, rocks: 0 },
    { cx: -5.5, cz: -5.5, r: 1.5, grass: 10, flowers: 0, rocks: 0 },
    { cx: 5.5, cz: -5.5, r: 1.5, grass: 10, flowers: 0, rocks: 0 },
    { cx: 5.5, cz: 5.5, r: 1.5, grass: 10, flowers: 0, rocks: 0 },
    { cx: -5.5, cz: 5.5, r: 1.5, grass: 10, flowers: 0, rocks: 0 },
    { cx: -1, cz: -8.5, r: 2, grass: 6, flowers: 0, rocks: 0 },
    { cx: 1, cz: 8.5, r: 2, grass: 6, flowers: 0, rocks: 0 },
    { cx: 8.5, cz: -2.5, r: 1.5, grass: 5, flowers: 0, rocks: 0 },
    { cx: -8.5, cz: -2.5, r: 1.5, grass: 5, flowers: 0, rocks: 0 },
  ];
  const fColors = [0xa0c0e8, 0xe8d8a0, 0xc0a0e0, 0xa0e8c0, 0xf0d0a0];
  const grassGreens = [0x6aaa5a, 0x5a9a4a, 0x7ab86a];

  detailZones.forEach(zone => {
    // Grass tufts (tiny crossed planes)
    for (let i = 0; i < zone.grass; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * zone.r;
      const gx = zone.cx + Math.cos(a) * d;
      const gz = zone.cz + Math.sin(a) * d;
      const gc = grassGreens[Math.floor(Math.random() * grassGreens.length)];
      const gh = 0.03 + Math.random() * 0.03;
      const blade = new THREE.Mesh(
        new THREE.PlaneGeometry(0.025, gh),
        mt(gc, { transparent: true, opacity: 0.85 }));
      const gy = getTerrainHeight(gx, gz);
      blade.position.set(gx, gy + gh / 2, gz);
      blade.rotation.y = Math.random() * Math.PI;
      scene.add(blade);
      // Cross blade
      const blade2 = blade.clone(); blade2.material = blade.material;
      blade2.rotation.y += Math.PI / 2;
      blade2.position.set(gx, gy + gh / 2, gz);
      scene.add(blade2);
    }
    // Flowers (small colored spheres in clustered patches)
    for (let i = 0; i < zone.flowers; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * zone.r * 0.7;
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.012 + Math.random() * 0.008, 4, 4),
        mt(fColors[Math.floor(Math.random() * fColors.length)]));
      const flx = zone.cx + Math.cos(a) * d, flz = zone.cz + Math.sin(a) * d;
      fl.position.set(flx, getTerrainHeight(flx, flz) + 0.012, flz);
      scene.add(fl);
    }
    // Rocks (small dark spheres at ground level)
    for (let i = 0; i < zone.rocks; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * zone.r;
      const rs = 0.015 + Math.random() * 0.02;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rs, 0),
        mt(STONE, { roughness: 0.95 }));
      const rkx = zone.cx + Math.cos(a) * d, rkz = zone.cz + Math.sin(a) * d;
      rock.position.set(rkx, getTerrainHeight(rkx, rkz) + rs * 0.4, rkz);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      scene.add(rock);
    }
  });

  // ── Worn dirt patches where paths meet buildings and around plaza ──
  const dirtPatches = [
    [0, 0, 1.6], // plaza center
    [-2.5, -2.5, 0.6], [2.5, -2.5, 0.6], [2.5, 2.5, 0.6], [-2.5, 2.5, 0.6], // path junctions
    [-5.5, -5.5, 0.8], [5.5, -5.5, 0.8], [5.5, 5.5, 0.8], [-5.5, 5.5, 0.8], // building bases
  ];
  dirtPatches.forEach(([x, z, r]) => {
    const patch = makeGroundPatch(r, DIRT);
    patch.position.set(x, getTerrainHeight(x, z) + 0.004, z);
    scene.add(patch);
  });

  // ── Shoreline rocks (along irregular island edge) ──
  const rockColors = [0xc0b8a0, 0xa8a090, 0xb8b0a0];
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const edgeR = getIslandRadius(a);
    const d = edgeR - 0.5 + Math.random() * 0.6;
    const rs = 0.03 + Math.random() * 0.04;
    const rx = Math.cos(a) * d, rz = Math.sin(a) * d;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rs, 1),
      mt(rockColors[i % 3], { roughness: 0.95 }));
    rock.position.set(rx, getTerrainHeight(rx, rz) + rs * 0.25, rz);
    rock.scale.y = 0.5 + Math.random() * 0.3; // flatten to look like natural rocks
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(rock);
  }
}

/* ═══════════════════════════════════════════════════════════
   Instanced Tertiary Detail — grass tufts, flowers, pebbles
   ═══════════════════════════════════════════════════════════ */

function createInstancedDetail() {
  // Removed — grass tufts looked like floating rectangles
}

/* ═══════════════════════════════════════════════════════════
   Wildlife — seabirds, cat, butterflies
   ═══════════════════════════════════════════════════════════ */

function createWildlife() {
  // ── Seabirds (circling above the island and shoreline) ──
  const birdGeo = new THREE.BufferGeometry();
  // V-shaped bird silhouette
  const bv = new Float32Array([
    -0.06, 0, 0,   0, 0.01, 0.02,   0, 0, 0,
     0.06, 0, 0,   0, 0.01, 0.02,   0, 0, 0,
  ]);
  birdGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
  birdGeo.computeVertexNormals();
  const birdMat = mt(0x666666);
  birdMat.side = THREE.DoubleSide;

  for (let i = 0; i < 8; i++) {
    const bird = new THREE.Mesh(birdGeo, birdMat);
    const orbitR = 6 + Math.random() * 10;
    const orbitY = 2.5 + Math.random() * 2.5;
    const orbitSpeed = 0.15 + Math.random() * 0.15;
    const phase = Math.random() * Math.PI * 2;
    bird.position.set(
      Math.cos(phase) * orbitR,
      orbitY,
      Math.sin(phase) * orbitR
    );
    bird.scale.setScalar(0.6 + Math.random() * 0.6);
    scene.add(bird);
    animatedObjects.push({
      type: "orbit", mesh: bird, speed: orbitSpeed,
      radius: orbitR, baseY: orbitY, phase,
    });
  }

  // ── Flock of 3 birds in formation (closer, larger) ──
  for (let i = 0; i < 3; i++) {
    const fb = new THREE.Mesh(birdGeo, birdMat);
    fb.scale.setScalar(1.0 + i * 0.1);
    const fR = 8, fY = 3.5, fSpeed = 0.12;
    const fPhase = 1.5 + i * 0.15;
    fb.position.set(Math.cos(fPhase) * fR, fY, Math.sin(fPhase) * fR);
    scene.add(fb);
    animatedObjects.push({
      type: "orbit", mesh: fb, speed: fSpeed,
      radius: fR, baseY: fY, phase: fPhase,
    });
  }

  // ── Cat (sleeping near a building) ──
  const catGroup = new THREE.Group();
  const catX = 4.5, catZ = -5;
  const catY = getTerrainHeight(catX, catZ);
  catGroup.position.set(catX, catY, catZ);
  catGroup.rotation.y = 0.8;
  // Body (elongated sphere)
  const catBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 6, 5), mt(0xd0a060));
  catBody.scale.set(1, 0.7, 1.6);
  catBody.position.y = 0.035; catGroup.add(catBody);
  // Head
  const catHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 5, 4), mt(0xd0a060));
  catHead.position.set(0, 0.05, 0.07); catGroup.add(catHead);
  // Ears
  for (const ex of [-0.015, 0.015]) {
    const ear = new THREE.Mesh(
      new THREE.ConeGeometry(0.01, 0.02, 3), mt(0xd0a060));
    ear.position.set(ex, 0.07, 0.07); catGroup.add(ear);
  }
  // Tail (curved via cylinder)
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.004, 0.08, 4), mt(0xd0a060));
  tail.position.set(0, 0.04, -0.08);
  tail.rotation.x = 0.8; catGroup.add(tail);
  scene.add(catGroup);
  // Subtle breathing animation
  animatedObjects.push({
    type: "sway", mesh: catBody, speed: 0.4, amp: 0.003, phase: 0,
  });

  // ── Butterflies (small colored sprites fluttering around flowers) ──
  const bflyGeo = new THREE.PlaneGeometry(0.025, 0.018);
  const bflyColors = [0xe090c0, 0x90c0e0, 0xe0d080, 0xc0e090];
  for (let i = 0; i < 6; i++) {
    const bflyMat = mt(bflyColors[i % bflyColors.length],
      { transparent: true, opacity: 0.85 });
    bflyMat.side = THREE.DoubleSide;
    const bfly = new THREE.Mesh(bflyGeo, bflyMat);
    const bx = -4 + Math.random() * 8, bz = -4 + Math.random() * 8;
    const by = getTerrainHeight(bx, bz) + 0.2 + Math.random() * 0.3;
    bfly.position.set(bx, by, bz);
    scene.add(bfly);
    animatedObjects.push({
      type: "butterfly", mesh: bfly,
      baseX: bx, baseY: by, baseZ: bz,
      speed: 1.5 + Math.random(), phase: Math.random() * Math.PI * 2,
      radius: 0.3 + Math.random() * 0.4,
    });
  }
}

/* ═══════════════════════════════════════════════════════════
   Extra Boats and Houses
   ═══════════════════════════════════════════════════════════ */

function createExtraBoatsAndHouses() {
  // ── Rowboat beached on shore ──
  const rbAngle = 1.2;
  const rbR = getIslandRadius(rbAngle) - 0.2;
  const rbx = Math.cos(rbAngle) * rbR, rbz = Math.sin(rbAngle) * rbR;
  const rby = getTerrainHeight(rbx, rbz);
  const rowboat = new THREE.Group();
  rowboat.position.set(rbx, rby, rbz);
  rowboat.rotation.y = rbAngle + Math.PI / 2;
  rowboat.scale.setScalar(2.0);
  // Hull
  const rbHull = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.035, 0.22), mt(WOOD));
  rbHull.position.y = 0.018; rowboat.add(rbHull);
  // Bow
  const rbBow = new THREE.Mesh(
    new THREE.ConeGeometry(0.04, 0.06, 4), mt(WOOD));
  rbBow.position.set(0, 0.018, 0.14); rbBow.rotation.x = Math.PI / 2;
  rowboat.add(rbBow);
  // Oars
  for (const side of [-1, 1]) {
    const oar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.18, 3), mt(WOOD_D));
    oar.position.set(side * 0.06, 0.04, 0.02);
    oar.rotation.z = side * 0.3; oar.rotation.x = -0.2;
    rowboat.add(oar);
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.003, 0.04), mt(WOOD_D));
    blade.position.set(side * 0.12, 0.065, 0.02);
    rowboat.add(blade);
  }
  scene.add(rowboat);

  // ── Fishing boat (anchored, medium, NE) ──
  const fbAngle = 0.5;
  const fbDist = getIslandRadius(fbAngle) + 1.8;
  const fbx = Math.cos(fbAngle) * fbDist, fbz = Math.sin(fbAngle) * fbDist;
  const fishboat = new THREE.Group();
  fishboat.position.set(fbx, -0.12, fbz);
  fishboat.rotation.y = 1.2;
  fishboat.scale.setScalar(2.2);
  const fbHull = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.07, 0.35), mt(0x6080a0));
  fbHull.position.y = 0.02; fishboat.add(fbHull);
  const fbBow = new THREE.Mesh(
    new THREE.ConeGeometry(0.075, 0.1, 4), mt(0x6080a0));
  fbBow.position.set(0, 0.02, 0.22); fbBow.rotation.x = Math.PI / 2;
  fishboat.add(fbBow);
  // Cabin
  const fbCabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.06, 0.1), mt(CREAM));
  fbCabin.position.set(0, 0.07, -0.08); fishboat.add(fbCabin);
  // Mast with net
  const fbMast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.008, 0.25, 4), mt(WOOD_D));
  fbMast.position.set(0, 0.15, 0.05); fishboat.add(fbMast);
  scene.add(fishboat);
  animatedObjects.push({
    type: "bob", mesh: fishboat, speed: 0.4,
    baseY: -0.12, amp: 0.015, phase: 2.5,
  });

  // ── Canoe (beached, west side) ──
  const cnAngle = 3.5;
  const cnR = getIslandRadius(cnAngle) - 0.15;
  const cnx = Math.cos(cnAngle) * cnR, cnz = Math.sin(cnAngle) * cnR;
  const cny = getTerrainHeight(cnx, cnz);
  const canoe = new THREE.Group();
  canoe.position.set(cnx, cny, cnz);
  canoe.rotation.y = cnAngle + 0.3;
  canoe.scale.setScalar(1.8);
  const cnHull = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.3, 6), mt(0xa08060));
  cnHull.rotation.z = Math.PI / 2;
  cnHull.position.y = 0.015; canoe.add(cnHull);
  // Paddle
  const paddle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, 0.15, 3), mt(WOOD_D));
  paddle.position.set(0.04, 0.025, 0);
  paddle.rotation.z = 0.4; canoe.add(paddle);
  scene.add(canoe);

  // ── Research cabin (small wooden house, NE area) ──
  const rcx = 7, rcz = -2;
  const rcy = getTerrainHeight(rcx, rcz);
  const cabin = new THREE.Group();
  cabin.position.set(rcx, rcy, rcz);
  cabin.rotation.y = -0.5;
  // Walls
  const cbWalls = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.4), mt(WOOD));
  cbWalls.position.y = 0.15; cbWalls.castShadow = true; cabin.add(cbWalls);
  // Roof
  const cbRoof = new THREE.Mesh(
    new THREE.ConeGeometry(0.38, 0.15, 4), mt(WOOD_D));
  cbRoof.position.y = 0.37; cbRoof.rotation.y = Math.PI / 4;
  cbRoof.castShadow = true; cabin.add(cbRoof);
  // Door
  const cbDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.15, 0.01), mt(WOOD_D));
  cbDoor.position.set(0, 0.08, 0.205); cabin.add(cbDoor);
  // Window
  const cbWin = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.05, 0.01),
    mt(0xa0c0d0, { transparent: true, opacity: 0.5 }));
  cbWin.position.set(0.12, 0.18, 0.205); cabin.add(cbWin);
  // Chimney
  const cbChim = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.12, 0.05), mt(STONE));
  cbChim.position.set(-0.15, 0.4, -0.1); cabin.add(cbChim);
  cabin.add(makeContactShadow(0.3));
  scene.add(cabin);

  // ── Storage shed (near dock area) ──
  const shx = -8.5, shz = 2;
  const shy = getTerrainHeight(shx, shz);
  const shed = new THREE.Group();
  shed.position.set(shx, shy, shz);
  shed.rotation.y = 0.6;
  const shWalls = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.22, 0.3), mt(WOOD_D));
  shWalls.position.y = 0.11; shWalls.castShadow = true; shed.add(shWalls);
  const shRoof = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.03, 0.35), mt(0x805040));
  shRoof.position.y = 0.23; shed.add(shRoof);
  const shRoofPeak = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.08, 4), mt(0x805040));
  shRoofPeak.position.y = 0.28; shRoofPeak.rotation.y = Math.PI / 4; shed.add(shRoofPeak);
  const shDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.14, 0.01), mt(CREAM));
  shDoor.position.set(0, 0.07, 0.155); shed.add(shDoor);
  shed.add(makeContactShadow(0.2));
  scene.add(shed);

  // ── Greenhouse (near Design district) ──
  const ghx = 3.5, ghz = -6.5;
  const ghy = getTerrainHeight(ghx, ghz);
  const greenhouse = new THREE.Group();
  greenhouse.position.set(ghx, ghy, ghz);
  greenhouse.rotation.y = 0.2;
  // Frame
  const ghFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.25, 0.55), mt(CREAM));
  ghFrame.position.y = 0.125; ghFrame.castShadow = true; greenhouse.add(ghFrame);
  // Glass panels (transparent overlay)
  const ghGlass = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.23, 0.53),
    mt(0xa0d8c0, { transparent: true, opacity: 0.3 }));
  ghGlass.position.y = 0.125; greenhouse.add(ghGlass);
  // Roof
  const ghRoof = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 0.1, 4), mt(CREAM, { transparent: true, opacity: 0.6 }));
  ghRoof.position.y = 0.3; ghRoof.rotation.y = Math.PI / 4; greenhouse.add(ghRoof);
  // Plants inside (visible through glass)
  for (let i = 0; i < 4; i++) {
    const plant = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 4, 4), mt(i % 2 === 0 ? GREEN_L : GREEN_D));
    plant.position.set(-0.1 + i * 0.07, 0.06, (Math.random() - 0.5) * 0.3);
    greenhouse.add(plant);
  }
  greenhouse.add(makeContactShadow(0.25));
  scene.add(greenhouse);

  // ── Additional boats at dock ──
  const dkAngle = Math.atan2(1.5, -10);
  const dkR = getIslandRadius(dkAngle);

  // Small skiff tied to other side of dock
  const skiff = new THREE.Group();
  const skDist = dkR + 0.3;
  skiff.position.set(
    Math.cos(dkAngle + 0.08) * skDist, -0.08,
    Math.sin(dkAngle + 0.08) * skDist);
  skiff.rotation.y = Math.PI * 0.7;
  skiff.scale.setScalar(1.8);
  const skHull = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.25), mt(0x8a6a4a));
  skHull.position.y = 0.02; skiff.add(skHull);
  const skBow = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 4), mt(0x8a6a4a));
  skBow.position.set(0, 0.02, 0.16); skBow.rotation.x = Math.PI / 2; skiff.add(skBow);
  scene.add(skiff);
  animatedObjects.push({ type: "bob", mesh: skiff, speed: 0.7, baseY: -0.08, amp: 0.01, phase: 3 });

  // Larger cargo boat moored near dock
  const cargo = new THREE.Group();
  const cgDist = dkR + 1.2;
  cargo.position.set(
    Math.cos(dkAngle - 0.12) * cgDist, -0.1,
    Math.sin(dkAngle - 0.12) * cgDist);
  cargo.rotation.y = Math.PI * 0.5;
  cargo.scale.setScalar(2.5);
  const cgHull = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.5), mt(0x705840));
  cgHull.position.y = 0.02; cgHull.castShadow = true; cargo.add(cgHull);
  const cgBow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 4), mt(0x705840));
  cgBow.position.set(0, 0.02, 0.32); cgBow.rotation.x = Math.PI / 2; cargo.add(cgBow);
  const cgCabin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.14), mt(CREAM));
  cgCabin.position.set(0, 0.08, -0.12); cargo.add(cgCabin);
  // Cargo crates
  for (let i = 0; i < 3; i++) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), mt(WOOD_D));
    crate.position.set(-0.04 + i * 0.04, 0.06, 0.05 + i * 0.03);
    crate.rotation.y = i * 0.3; cargo.add(crate);
  }
  scene.add(cargo);
  animatedObjects.push({ type: "bob", mesh: cargo, speed: 0.35, baseY: -0.1, amp: 0.012, phase: 5 });

  // Small dinghy (tiny, near shore)
  const dinghy = new THREE.Group();
  const dnAngle = dkAngle + 0.25;
  const dnR = dkR - 0.1;
  dinghy.position.set(Math.cos(dnAngle) * dnR, -0.06, Math.sin(dnAngle) * dnR);
  dinghy.rotation.y = dnAngle + 1.0;
  dinghy.scale.setScalar(1.5);
  const dnHull = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.14), mt(0xa05040));
  dnHull.position.y = 0.015; dinghy.add(dnHull);
  scene.add(dinghy);
  animatedObjects.push({ type: "bob", mesh: dinghy, speed: 0.9, baseY: -0.06, amp: 0.008, phase: 7 });

  // ── Second campfire (north side of island) ──
  const cf2x = -3, cf2z = -6;
  const cf2y = getTerrainHeight(cf2x, cf2z);
  const fire2 = new THREE.Group();
  fire2.position.set(cf2x, cf2y, cf2z);
  // Stone ring
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.035, 0), mt(STONE, { roughness: 0.95 }));
    st.position.set(Math.cos(a) * 0.15, 0.018, Math.sin(a) * 0.15);
    st.rotation.set(Math.random(), Math.random(), Math.random());
    st.scale.y = 0.6; fire2.add(st);
  }
  // Flame
  const f2mat = new THREE.MeshStandardMaterial({
    color: 0xff8830, emissive: 0xff6610, emissiveIntensity: 1.2,
    roughness: 1, flatShading: true, transparent: true, opacity: 0.85,
  });
  const f2flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 5), f2mat);
  f2flame.position.y = 0.07; fire2.add(f2flame);
  const f2core = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.1, 4),
    new THREE.MeshStandardMaterial({
      color: 0xffcc40, emissive: 0xffaa20, emissiveIntensity: 1.5,
      roughness: 1, flatShading: true, transparent: true, opacity: 0.9 }));
  f2core.position.y = 0.05; fire2.add(f2core);
  animatedObjects.push({ type: "flicker", mesh: f2flame, mat: f2mat, phase: 2.0, baseScaleX: 1, baseScaleY: 1 });
  // Light
  const f2light = new THREE.PointLight(0xff9940, 0.6, 3);
  f2light.position.y = 0.15; fire2.add(f2light);
  animatedObjects.push({ type: "lightFlicker", light: f2light, baseIntensity: 0.6, phase: 2.0 });
  // Logs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.22, 5), mt(WOOD_D, { roughness: 0.95 }));
    log.position.set(Math.cos(a) * 0.4, 0.03, Math.sin(a) * 0.4);
    log.rotation.z = Math.PI / 2; log.rotation.y = a + Math.PI / 2;
    fire2.add(log);
  }
  // Smoke
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.012 + i * 0.004, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xc0c0c0, transparent: true, opacity: 0.15 - i * 0.03 }));
    puff.position.set(cf2x, cf2y + 0.15 + i * 0.1, cf2z);
    puff.userData.smokeBase = { x: cf2x, y: cf2y + 0.15 + i * 0.1, z: cf2z, i };
    scene.add(puff);
    animatedObjects.push({ type: "smoke", mesh: puff });
  }
  scene.add(fire2);

  // ── Distant islands on the horizon ──
  // Island 1 — medium, SW
  const di1 = new THREE.Group();
  di1.position.set(-28, -0.3, 22);
  const di1Land = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 3.0, 0.6, 12), mt(0x8aaa70, { roughness: 0.9, emissive: 0x304020, emissiveIntensity: 0.1 }));
  di1Land.position.y = 0.1; di1.add(di1Land);
  // Hill
  const di1Hill = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), mt(0x7a9a60, { emissive: 0x304020, emissiveIntensity: 0.15 }));
  di1Hill.position.set(0.3, 0.3, 0); di1.add(di1Hill);
  // Trees (tiny silhouettes)
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * 1.5;
    const tree = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 4), mt(0x5a7a4a));
    tree.position.set(Math.cos(a) * d, 0.5 + Math.random() * 0.2, Math.sin(a) * d);
    di1.add(tree);
  }
  scene.add(di1);

  // Island 2 — small rocky, NE
  const di2 = new THREE.Group();
  di2.position.set(30, -0.3, -18);
  const di2Rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(1.5, 1), mt(0xc0b8a8, { roughness: 0.95, emissive: 0x605850, emissiveIntensity: 0.12 }));
  di2Rock.position.y = 0.5; di2Rock.scale.y = 0.4; di2.add(di2Rock);
  const di2Peak = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.0, 5), mt(0xb0a898, { emissive: 0x504030, emissiveIntensity: 0.12 }));
  di2Peak.position.set(0.3, 0.8, 0); di2.add(di2Peak);
  scene.add(di2);

  // Island 3 — flat atoll, far south
  const di3 = new THREE.Group();
  di3.position.set(5, -0.35, 35);
  const di3Land = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.2, 0.3, 10), mt(0xd0c8a0, { roughness: 0.9, emissive: 0x504030, emissiveIntensity: 0.12 }));
  di3Land.position.y = 0.05; di3.add(di3Land);
  // Palm silhouettes
  for (let i = 0; i < 3; i++) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 3), mt(0x8a7050));
    trunk.position.set(-0.5 + i * 0.5, 0.35, 0); trunk.rotation.z = (i - 1) * 0.15;
    di3.add(trunk);
    const frond = new THREE.Mesh(new THREE.SphereGeometry(0.2, 4, 3), mt(0x5a8a4a));
    frond.position.set(-0.5 + i * 0.5, 0.6, 0); frond.scale.y = 0.5;
    di3.add(frond);
  }
  scene.add(di3);
}

/* ═══════════════════════════════════════════════════════════
   Town Details — signpost, lamps, benches
   ═══════════════════════════════════════════════════════════ */

function createTownDetails() {
  // Signpost at path junction (moved to bigger map scale)
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.55, 5), mt(WOOD_D));
  const spY = getTerrainHeight(2.5, -2.5);
  post.position.set(2.5, spY + 0.275, -2.5); scene.add(post);
  ROLES.forEach((r, i) => {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.015), mt(r.body));
    sign.position.set(2.62, spY + 0.46 - i * 0.065, -2.5);
    sign.rotation.y = -0.3 + i * 0.2; scene.add(sign);
  });

  // ── Lamp posts — ONLY along paths and plaza perimeter ──
  const addLamp = (x, z) => {
    const gy = getTerrainHeight(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.42, 5), mt(0x606060));
    pole.position.set(x, gy + 0.21, z); scene.add(pole);
    const lampHead = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), mt(0x505050));
    lampHead.position.set(x, gy + 0.43, z); scene.add(lampHead);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.02, 5, 4),
      mt(0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 0.35 }));
    glow.position.set(x, gy + 0.41, z); scene.add(glow);
  };
  // Plaza perimeter (4 posts at 45° intervals)
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    addLamp(Math.cos(a) * 1.8, Math.sin(a) * 1.8);
  }
  // Path to Literature [-6,-6]: evenly spaced along diagonal
  addLamp(-2.2, -2.2); addLamp(-4, -4);
  // Path to Hypothesis [6,-6]:
  addLamp(2.2, -2.2); addLamp(4, -4);
  // Path to Design [6,6]:
  addLamp(2.2, 2.2); addLamp(4, 4);
  // Path to Analysis [-6,6]:
  addLamp(-2.2, 2.2); addLamp(-4, 4);

  // ── Benches — each faces something purposeful ──
  const addBench = (x, z, ry) => {
    const bGroup = new THREE.Group();
    bGroup.position.set(x, getTerrainHeight(x, z), z); bGroup.rotation.y = ry;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.08), mt(WOOD_D));
    seat.position.y = 0.1; bGroup.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.015), mt(WOOD_D));
    back.position.set(0, 0.16, -0.035); bGroup.add(back);
    for (const lx of [-0.11, 0.11]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), mt(0x606060));
      leg.position.set(lx, 0.05, 0); bGroup.add(leg);
    }
    scene.add(bGroup);
  };
  // Pair facing the plaza (along two paths)
  addBench(1.6, -1.6, Math.PI * 0.75);  // faces plaza from Hypothesis path
  addBench(-1.6, 1.6, -Math.PI * 0.25); // faces plaza from Analysis path
  // Near Literature entrance, facing building
  addBench(-5.2, -5.2, Math.PI * 1.25);
  // Near Design entrance, facing building
  addBench(5.2, 5.2, Math.PI * 0.25);
  // Water-view bench at island edge (facing outward toward ocean)
  addBench(0, -9, 0);
  addBench(9, 0, Math.PI / 2);
}

/* ═══════════════════════════════════════════════════════════
   Plaza Surroundings — highest-density zone
   ═══════════════════════════════════════════════════════════ */

function createPlazaSurroundings() {
  // ── Notice board near plaza entrance ──
  const board = new THREE.Group();
  board.position.set(2.0, getTerrainHeight(2.0, -0.8), -0.8);
  const boardBack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.02), mt(WOOD_D));
  boardBack.position.y = 0.35; board.add(boardBack);
  // Frame
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.005, 0.03), mt(WOOD));
  boardFrame.position.y = 0.48; board.add(boardFrame);
  const boardFrame2 = boardFrame.clone(); boardFrame2.position.y = 0.22; board.add(boardFrame2);
  // Posts
  for (const lx of [-0.13, 0.13]) {
    const bPost = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.5, 4), mt(WOOD_D));
    bPost.position.set(lx, 0.25, 0); board.add(bPost);
  }
  // Pinned papers
  const paperColors = [0xf0e8d0, 0xe0d8c8, 0xd8e8d0, 0xe8d8d8, 0xd0d8e8];
  for (let i = 0; i < 6; i++) {
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.003),
      mt(paperColors[i % 5]));
    paper.position.set(-0.09 + (i % 3) * 0.09, 0.28 + Math.floor(i / 3) * 0.1, 0.012);
    paper.rotation.z = (Math.random() - 0.5) * 0.15; board.add(paper);
  }
  scene.add(board);

  // ── Planters ringing the plaza edge ──
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
    const px = Math.cos(a) * 1.5;
    const pz = Math.sin(a) * 1.5;
    const planter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.12), mt(WOOD_D));
    planter.position.set(px, getTerrainHeight(px, pz) + 0.04, pz); planter.rotation.y = a; scene.add(planter);
    // Small greenery on top of planter
    const planterTop = getTerrainHeight(px, pz) + 0.1;
    const pGreen = new THREE.Mesh(new THREE.DodecahedronGeometry(0.04, 0), mt(GREEN_D));
    pGreen.position.set(px, planterTop, pz); scene.add(pGreen);
  }

  // ── Fountain (secondary landmark, offset from central table) ──
  const fountain = new THREE.Group();
  fountain.position.set(-1.2, getTerrainHeight(-1.2, 0.6), 0.6);
  // Wide base platform
  const fPlatform = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.06, 10), mt(STONE));
  fPlatform.position.y = 0.03; fPlatform.castShadow = true; fountain.add(fPlatform);
  // Lower bowl (wider catch basin)
  const fBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.06, 10), mt(STONE));
  fBase.position.y = 0.09; fBase.castShadow = true; fountain.add(fBase);
  // Water in lower bowl
  const fWaterLow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 10),
    mt(WATER, { transparent: true, opacity: 0.5 }));
  fWaterLow.rotation.x = -Math.PI / 2; fWaterLow.position.y = 0.11; fountain.add(fWaterLow);
  // Central column
  const fColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.2, 6), mt(STONE));
  fColumn.position.y = 0.22; fountain.add(fColumn);
  // Upper bowl (smaller)
  const fBowlUp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.04, 8), mt(STONE));
  fBowlUp.position.y = 0.34; fountain.add(fBowlUp);
  // Water in upper bowl
  const fWaterUp = new THREE.Mesh(new THREE.CircleGeometry(0.08, 8),
    mt(WATER, { transparent: true, opacity: 0.6 }));
  fWaterUp.rotation.x = -Math.PI / 2; fWaterUp.position.y = 0.35; fountain.add(fWaterUp);
  // Finial on top
  const fFinial = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), mt(STONE));
  fFinial.position.y = 0.39; fountain.add(fFinial);
  fountain.add(makeContactShadow(0.25));
  scene.add(fountain);

  // ── Crates and barrels near plaza edge ──
  const crate1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.1), mt(WOOD_D));
  crate1.position.set(1.4, 0.05, 0.8); crate1.rotation.y = 0.3; scene.add(crate1);
  const crate2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), mt(WOOD));
  crate2.position.set(1.5, 0.04, 0.7); scene.add(crate2);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.14, 6), mt(WOOD_D));
  barrel.position.set(1.35, 0.07, 0.65); scene.add(barrel);

  // ── Small trash bin at plaza entrance ──
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.1, 5), mt(0x606060));
  bin.position.set(1.8, 0.05, -0.5); scene.add(bin);

}

/* ═══════════════════════════════════════════════════════════
   Shoreline — dock, boat, rocks, seabirds
   ═══════════════════════════════════════════════════════════ */

function createShoreline() {
  // ── Dock extending from island edge toward lighthouse ──
  // Place at island rim, pointing outward (-x direction, slight +z)
  const dockAngle = Math.atan2(1.5, -10);
  const dockEdgeR = getIslandRadius(dockAngle);
  const dockDist = dockEdgeR - 0.3; // slightly inside edge
  const dock = new THREE.Group();
  dock.position.set(Math.cos(dockAngle) * dockDist, -0.02, Math.sin(dockAngle) * dockDist);
  dock.rotation.y = Math.PI * 0.55; // angled slightly to face lighthouse
  // Main planking (wider, longer pier)
  for (let i = 0; i < 8; i++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.04, 0.09),
      mt(i % 2 === 0 ? WOOD : WOOD_D));
    plank.position.set(0, 0.06, -0.28 + i * 0.09);
    plank.castShadow = true; dock.add(plank);
  }
  // Support pilings (extend below into water)
  for (const [px, pz] of [[-0.22, -0.25], [0.22, -0.25], [-0.22, 0.25], [0.22, 0.25], [0, 0.45]]) {
    const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5), mt(WOOD_D));
    pile.position.set(px, -0.15, pz); dock.add(pile);
  }
  // Mooring posts with caps
  for (const pz of [-0.3, 0.4]) {
    const mPost = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.16, 5), mt(WOOD_D));
    mPost.position.set(0.28, 0.14, pz); dock.add(mPost);
    const mCap = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 4), mt(WOOD));
    mCap.position.set(0.28, 0.22, pz); dock.add(mCap);
  }
  // Rope coil on dock
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 4, 8), mt(0xc8b888));
  coil.position.set(-0.15, 0.09, 0.3); coil.rotation.x = -Math.PI / 2; dock.add(coil);
  scene.add(dock);

  // ── Small rowboat tied alongside dock ──
  const boat = new THREE.Group();
  const boatDist = dockEdgeR + 0.5;
  boat.position.set(Math.cos(dockAngle) * boatDist, -0.08, Math.sin(dockAngle) * boatDist);
  boat.rotation.y = Math.PI * 0.6;
  boat.scale.setScalar(2.0);
  // Hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.4), mt(WOOD));
  hull.position.y = 0.02; boat.add(hull);
  // Bow taper (two angled planks for pointed front)
  const bowL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.08), mt(WOOD));
  bowL.position.set(-0.03, 0.02, 0.22); bowL.rotation.y = 0.35; boat.add(bowL);
  const bowR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.08), mt(WOOD));
  bowR.position.set(0.03, 0.02, 0.22); bowR.rotation.y = -0.35; boat.add(bowR);
  // Seat planks
  const seat1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.04), mt(WOOD_D));
  seat1.position.set(0, 0.06, -0.05); boat.add(seat1);
  const seat2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.04), mt(WOOD_D));
  seat2.position.set(0, 0.06, 0.08); boat.add(seat2);
  // Oars (resting across gunwales)
  for (const side of [-1, 1]) {
    const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 4), mt(WOOD_D));
    oar.position.set(side * 0.05, 0.07, 0);
    oar.rotation.z = side * 0.25; oar.rotation.y = 0.3; boat.add(oar);
    // Oar blade
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.005, 0.06), mt(WOOD));
    blade.position.set(side * 0.18, 0.04, 0); boat.add(blade);
  }
  scene.add(boat);
  // Gentle bob animation
  animatedObjects.push({
    type: "bob", mesh: boat, speed: 0.6,
    baseY: boat.position.y, amp: 0.012, phase: 0,
  });

  // ── Shoreline rock clusters near dock/lighthouse ──
  const dockX = Math.cos(dockAngle) * dockDist;
  const dockZ = Math.sin(dockAngle) * dockDist;
  const rockCluster1 = [
    [dockX - 0.8, dockZ - 1.0], [dockX - 0.5, dockZ + 1.0],
    [dockX - 1.2, dockZ + 0.3], [dockX + 0.4, dockZ - 1.3],
  ];
  rockCluster1.forEach(([rx, rz]) => {
    const rs = 0.06 + Math.random() * 0.08;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rs, 1),
      mt(STONE, { roughness: 0.95 }));
    rock.position.set(rx, rs * 0.2, rz);
    rock.scale.y = 0.5 + Math.random() * 0.3;
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(rock);
  });
  // Cluster 2: opposite shoreline
  const oppAngle = Math.PI * 0.3;
  const oppR = getIslandRadius(oppAngle);
  const rockCluster2 = [
    [Math.cos(oppAngle) * (oppR - 0.2), Math.sin(oppAngle) * (oppR - 0.2)],
    [Math.cos(oppAngle + 0.1) * oppR, Math.sin(oppAngle + 0.1) * oppR],
    [Math.cos(oppAngle - 0.1) * (oppR + 0.2), Math.sin(oppAngle - 0.1) * (oppR + 0.2)],
  ];
  rockCluster2.forEach(([rx, rz]) => {
    const rs = 0.05 + Math.random() * 0.07;
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rs, 1),
      mt(STONE, { roughness: 0.95 }));
    rock.position.set(rx, rs * 0.2, rz);
    rock.scale.y = 0.5 + Math.random() * 0.3;
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(rock);
  });

  // ── Seabirds ──
  const makeBird = () => {
    const bird = new THREE.Group();
    const bBody = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), mt(CREAM));
    bird.add(bBody);
    // Wings
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.018),
        mt(CREAM, { transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      wing.position.set(side * 0.035, 0.005, 0);
      wing.rotation.z = side * 0.3;
      bird.add(wing);
    }
    // Beak
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, 3), mt(0xe8a840));
    beak.position.set(0, -0.005, 0.025); beak.rotation.x = Math.PI / 2; bird.add(beak);
    return bird;
  };
  // 3 circling above water near dock/lighthouse
  for (let i = 0; i < 3; i++) {
    const bird = makeBird();
    const bx = dockX + i * 1.0, bz = dockZ + i * 0.5;
    bird.position.set(bx, 1.2 + i * 0.3, bz);
    scene.add(bird);
    animatedObjects.push({
      type: "orbit", mesh: bird, speed: 0.15 + i * 0.05,
      cx: bx, cz: bz, radius: 1.5 + i * 0.5,
      baseY: 1.2 + i * 0.3, phase: i * Math.PI * 0.7,
    });
  }
  // 2 perched: 1 on lighthouse roof, 1 on dock post
  const perchBird1 = makeBird();
  perchBird1.position.set(-9.5, 1.5, 0); perchBird1.rotation.y = 0.8;
  scene.add(perchBird1);
  const perchBird2 = makeBird();
  perchBird2.position.set(dockX + 0.2, 0.25, dockZ + 0.3); perchBird2.rotation.y = -0.5;
  scene.add(perchBird2);

  // ── Lighthouse (tall landmark visible from anywhere) ──
  const lighthouse = new THREE.Group();
  lighthouse.position.set(-9.5, getTerrainHeight(-9.5, 0), 0);
  const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8), mt(CREAM));
  lhBase.position.y = 0.6; lhBase.castShadow = true; lighthouse.add(lhBase);
  // Red stripe
  const lhStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.175, 0.2, 8), mt(0xc04040));
  lhStripe.position.y = 0.8; lighthouse.add(lhStripe);
  // Lantern room
  const lhLantern = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.15, 8),
    mt(0xe8e0d0, { transparent: true, opacity: 0.4 }));
  lhLantern.position.y = 1.28; lighthouse.add(lhLantern);
  // Light
  const lhGlow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5),
    mt(0xffe8a0, { emissive: 0xffe8a0, emissiveIntensity: 0.4 }));
  lhGlow.position.y = 1.28; lighthouse.add(lhGlow);
  animatedObjects.push({ type: "blink", mesh: lhGlow, speed: 1.5, phase: 0 });
  lighthouseBeams.push(lhGlow);
  // Roof
  const lhRoof = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.12, 8), mt(0xc04040));
  lhRoof.position.y = 1.42; lighthouse.add(lhRoof);
  scene.add(lighthouse);

  // Register lighthouse as interactive
  const lhHitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 4, 4),
    new THREE.MeshBasicMaterial({ visible: false }));
  lhHitbox.position.set(-9.5, getTerrainHeight(-9.5, 0) + 0.6, 0);
  scene.add(lhHitbox);
  interactiveObjects.push({
    hitbox: lhHitbox, type: "lighthouse", label: "Inspect",
    group: lighthouse, data: { name: "Lighthouse" },
    reaction: () => {
      // Sweep the beacon blink faster
      const blinkObj = animatedObjects.find(o => o.mesh === lhGlow);
      if (blinkObj) {
        const origSpeed = blinkObj.speed;
        blinkObj.speed = 6.0;
        setTimeout(() => { blinkObj.speed = origSpeed; }, 2000);
      }
    },
  });
}

/* ═══════════════════════════════════════════════════════════
   Ambient Life — animals, butterflies, chimney smoke
   ═══════════════════════════════════════════════════════════ */

function createAmbientLife() {
  // ── Dog near plaza (blocky corgi shape) ──
  const dog = new THREE.Group();
  dog.position.set(1.2, getTerrainHeight(1.2, -0.8), -0.8);
  // Body
  const dogBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.18), mt(0xd4a050));
  dogBody.position.y = 0.08; dog.add(dogBody);
  // Head
  const dogHead = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.065, 0.07), mt(0xd4a050));
  dogHead.position.set(0, 0.11, 0.11); dog.add(dogHead);
  // Snout
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.03), mt(0xe8c88a));
  snout.position.set(0, 0.095, 0.15); dog.add(snout);
  // Ears
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.035, 0.02), mt(0xc09040));
    ear.position.set(side * 0.03, 0.15, 0.1); dog.add(ear);
  }
  // Legs
  for (const [lx, lz] of [[-0.04, 0.06], [0.04, 0.06], [-0.04, -0.06], [0.04, -0.06]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.025), mt(0xd4a050));
    leg.position.set(lx, 0.025, lz); dog.add(leg);
  }
  // Tail (small upward nub)
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.02), mt(0xd4a050));
  tail.position.set(0, 0.12, -0.1); tail.rotation.x = -0.3; dog.add(tail);
  dog.add(makeContactShadow(0.1));
  scene.add(dog);
  // Idle tail wag via sway
  animatedObjects.push({
    type: "sway", mesh: tail, speed: 4.0,
    phase: 0, amp: 0.015, baseX: tail.position.x,
  });

  // ── Cat sitting near Literature building ──
  const cat = new THREE.Group();
  cat.position.set(-5.2, getTerrainHeight(-5.2, -5.8), -5.8);
  cat.rotation.y = 0.5;
  // Body (upright sitting pose)
  const catBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.06, 3, 6), mt(0x505060));
  catBody.position.y = 0.07; cat.add(catBody);
  // Head
  const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), mt(0x505060));
  catHead.position.y = 0.14; cat.add(catHead);
  // Ears (tiny triangles)
  for (const side of [-1, 1]) {
    const earGeo = new THREE.ConeGeometry(0.012, 0.025, 3);
    const catEar = new THREE.Mesh(earGeo, mt(0x505060));
    catEar.position.set(side * 0.022, 0.17, 0); cat.add(catEar);
  }
  // Tail (curved cylinder)
  const catTail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.005, 0.1, 4), mt(0x505060));
  catTail.position.set(0, 0.04, -0.05); catTail.rotation.x = -0.8; cat.add(catTail);
  // Eyes (two tiny light dots)
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, 3, 3), mt(0xc0d070));
    eye.position.set(side * 0.015, 0.145, 0.03); cat.add(eye);
  }
  cat.add(makeContactShadow(0.06));
  scene.add(cat);

  // ── Butterflies near flower patches ──
  const butterflyColors = [0xf0a0d0, 0xa0d0f0, 0xf0e0a0, 0xd0a0f0];
  const butterflySpots = [
    [5.8, 0.35, -5.5],   // near Hypothesis greenhouse
    [6.5, 0.4, -5.8],    // near Hypothesis garden beds
    [5.5, 0.45, -6.5],   // near Hypothesis planting
    [-5.8, 0.4, -4.8],   // near Literature flowers
  ];
  butterflySpots.forEach(([bx, by, bz], i) => {
    const bf = new THREE.Group();
    bf.position.set(bx, by, bz);
    // Tiny body
    const bfBody = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 3), mt(0x666666));
    bfBody.rotation.x = Math.PI / 2; bf.add(bfBody);
    // Wings
    for (const side of [-1, 1]) {
      const wingGeo = new THREE.CircleGeometry(0.018, 4);
      const wing = new THREE.Mesh(wingGeo, mt(butterflyColors[i], { transparent: true, opacity: 0.8 }));
      wing.position.set(side * 0.015, 0, 0);
      wing.rotation.y = side * 0.4;
      bf.add(wing);
    }
    scene.add(bf);
    // Orbit animation — circles around spawn point
    animatedObjects.push({
      type: "orbit", mesh: bf, speed: 0.3 + Math.random() * 0.3,
      cx: bx, cz: bz, radius: 0.15 + Math.random() * 0.2,
      baseY: by, phase: Math.random() * Math.PI * 2,
    });
  });

  // ── Chimney smoke (from Literature library chimney at [-6,-6]) ──
  const chimneyPositions = [
    [-6 + 0.25, getTerrainHeight(-5.75, -6.12) + 1.25, -6 - 0.12],  // Literature chimney
    [6 + 0.32, getTerrainHeight(6.32, 5.76) + 0.75, 6 - 0.24],    // Design chimney
  ];
  chimneyPositions.forEach(([sx, sy, sz]) => {
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.02 + i * 0.008, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xd0d0d0, transparent: true, opacity: 0.3 - i * 0.05 })
      );
      puff.position.set(sx, sy + i * 0.08, sz);
      puff.userData.smokeBase = { x: sx, y: sy + i * 0.08, z: sz, i };
      scene.add(puff);
      animatedObjects.push({ type: "smoke", mesh: puff });
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   Particles (fireflies / data motes)
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   New Structures — campfire, boats, hilltop, misc
   ═══════════════════════════════════════════════════════════ */

function createCampfireCluster() {
  // ── Near foreground campfire — warm focal anchor for default camera view ──
  const cx = 5.5, cz = 5;
  const cy = getTerrainHeight(cx, cz);

  // ── Stone fire ring ──
  const fireGroup = new THREE.Group();
  fireGroup.position.set(cx, cy, cz);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.04, 0), mt(STONE, { roughness: 0.95 }));
    stone.position.set(Math.cos(a) * 0.18, 0.02, Math.sin(a) * 0.18);
    stone.rotation.set(Math.random(), Math.random(), Math.random());
    stone.scale.y = 0.6;
    fireGroup.add(stone);
  }

  // ── Flame (emissive flickering geometry) ──
  const flameGeo = new THREE.ConeGeometry(0.06, 0.18, 5);
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xff8830, emissive: 0xff6610, emissiveIntensity: 1.2,
    roughness: 1, flatShading: true, transparent: true, opacity: 0.85,
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.y = 0.09; fireGroup.add(flame);
  // Inner bright core
  const coreGeo = new THREE.ConeGeometry(0.03, 0.12, 4);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffcc40, emissive: 0xffaa20, emissiveIntensity: 1.5,
    roughness: 1, flatShading: true, transparent: true, opacity: 0.9,
  });
  const flameCore = new THREE.Mesh(coreGeo, coreMat);
  flameCore.position.y = 0.06; fireGroup.add(flameCore);
  // Animated flicker
  animatedObjects.push({ type: "flicker", mesh: flame, mat: flameMat, coreMat, phase: 0, baseScaleX: 1, baseScaleY: 1 });

  // ── Embers / charred wood at base ──
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.12, 4),
      mt(0x6a5a4a, { roughness: 0.95 }));
    log.position.set(Math.cos(a) * 0.08, 0.01, Math.sin(a) * 0.08);
    log.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
    log.rotation.y = Math.random() * Math.PI;
    fireGroup.add(log);
  }

  // ── Warm point light (flickering) ──
  const fireLight = new THREE.PointLight(0xff9940, 0.8, 4);
  fireLight.position.y = 0.2; fireGroup.add(fireLight);
  animatedObjects.push({ type: "lightFlicker", light: fireLight, baseIntensity: 0.8 });

  // ── Smoke wisps ──
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.015 + i * 0.005, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xc0c0c0, transparent: true, opacity: 0.2 - i * 0.03 }));
    puff.position.set(cx, cy + 0.2 + i * 0.1, cz);
    puff.userData.smokeBase = { x: cx, y: cy + 0.2 + i * 0.1, z: cz, i };
    scene.add(puff);
    animatedObjects.push({ type: "smoke", mesh: puff });
  }

  scene.add(fireGroup);

  // ── Seating logs (3 around the fire ring) ──
  const logSeats = [
    { a: 0.3, d: 0.45, len: 0.3 },
    { a: 2.2, d: 0.5, len: 0.35 },
    { a: 4.0, d: 0.42, len: 0.25 },
  ];
  logSeats.forEach(({ a, d, len }) => {
    const lx = cx + Math.cos(a) * d, lz = cz + Math.sin(a) * d;
    const ly = getTerrainHeight(lx, lz);
    const seatLog = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.045, len, 5), mt(WOOD_D, { roughness: 0.95 }));
    seatLog.position.set(lx, ly + 0.04, lz);
    seatLog.rotation.z = Math.PI / 2;
    seatLog.rotation.y = a + Math.PI / 2;
    seatLog.castShadow = true; scene.add(seatLog);
  });

  // ── Scattered firewood near ring ──
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 0.55 + Math.random() * 0.3;
    const wx = cx + Math.cos(a) * d, wz = cz + Math.sin(a) * d;
    const wy = getTerrainHeight(wx, wz);
    const stick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.01, 0.1 + Math.random() * 0.06, 3),
      mt(WOOD_D, { roughness: 0.95 }));
    stick.position.set(wx, wy + 0.005, wz);
    stick.rotation.z = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
    stick.rotation.y = Math.random() * Math.PI;
    scene.add(stick);
  }

  // ── Cooking pot on fire ──
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.04, 6),
    mt(0x666666, { roughness: 0.95 }));
  pot.position.set(cx + 0.06, cy + 0.04, cz - 0.04); scene.add(pot);
  // Pot handle
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 4, 8),
    mt(0x505050));
  handle.position.set(cx + 0.06, cy + 0.08, cz - 0.04);
  scene.add(handle);

  // ── Small canvas tent pitched nearby ──
  const tentX = cx + 1.2, tentZ = cz + 0.6;
  const tentY = getTerrainHeight(tentX, tentZ);
  const tent = new THREE.Group();
  tent.position.set(tentX, tentY, tentZ);
  tent.rotation.y = -0.5;
  // A-frame: two triangular sides + ridge
  const tentGeo = new THREE.ConeGeometry(0.25, 0.22, 4);
  const tentMesh = new THREE.Mesh(tentGeo, mt(0xe0d8c0, { roughness: 0.9 }));
  tentMesh.position.y = 0.11; tentMesh.rotation.y = Math.PI / 4;
  tentMesh.scale.set(1, 1, 1.6); // elongate
  tent.add(tentMesh);
  // Ground cloth visible at entrance
  const groundCloth = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.35),
    mt(0xd0c8a8, { roughness: 0.95 }));
  groundCloth.rotation.x = -Math.PI / 2; groundCloth.position.set(0, 0.005, 0.12);
  tent.add(groundCloth);
  tent.add(makeContactShadow(0.2));
  scene.add(tent);

  // ── Tent props: backpack + lantern + folding stool ──
  // Backpack
  const bpX = tentX + 0.25, bpZ = tentZ - 0.1;
  const bpY = getTerrainHeight(bpX, bpZ);
  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04),
    mt(0x8a6a4a, { roughness: 0.9 }));
  backpack.position.set(bpX, bpY + 0.04, bpZ);
  backpack.rotation.y = 0.3; scene.add(backpack);
  // Flap
  const flap = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.02, 0.04),
    mt(0x7a5a3a));
  flap.position.set(bpX, bpY + 0.09, bpZ);
  flap.rotation.y = 0.3; scene.add(flap);

  // Small lantern near tent entrance
  const lantX = tentX - 0.15, lantZ = tentZ + 0.2;
  const lantY = getTerrainHeight(lantX, lantZ);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.025),
    mt(METAL));
  lantern.position.set(lantX, lantY + 0.02, lantZ); scene.add(lantern);
  const lantGlow = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 4),
    mt(0xffe8a0, { emissive: 0xffe8a0, emissiveIntensity: 0.5 }));
  lantGlow.position.set(lantX, lantY + 0.05, lantZ); scene.add(lantGlow);

  // Folding stool
  const stoolX = cx - 0.5, stoolZ = cz + 0.35;
  const stoolY = getTerrainHeight(stoolX, stoolZ);
  const stoolSeat = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.008, 0.06),
    mt(0xd0c0a0));
  stoolSeat.position.set(stoolX, stoolY + 0.1, stoolZ); scene.add(stoolSeat);
  for (const [lx, lz] of [[-0.025, -0.02], [0.025, -0.02], [-0.025, 0.02], [0.025, 0.02]]) {
    const sLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.1, 3),
      mt(WOOD_D));
    sLeg.position.set(stoolX + lx, stoolY + 0.05, stoolZ + lz); scene.add(sLeg);
  }

  // ── Second tent (smaller, offset) ──
  const t2x = cx + 0.4, t2z = cz + 1.3;
  const t2y = getTerrainHeight(t2x, t2z);
  const tent2 = new THREE.Group();
  tent2.position.set(t2x, t2y, t2z);
  tent2.rotation.y = 0.8;
  const t2mesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.18, 4),
    mt(0xc8d0b8, { roughness: 0.9 }));
  t2mesh.position.y = 0.09; t2mesh.rotation.y = Math.PI / 4;
  t2mesh.scale.set(1, 1, 1.4);
  tent2.add(t2mesh);
  tent2.add(makeContactShadow(0.15));
  scene.add(tent2);

  // ── Hanging lanterns strung between posts near campfire ──
  const postA = { x: cx - 0.6, z: cz - 0.5 };
  const postB = { x: cx + 0.3, z: cz - 0.8 };
  for (const p of [postA, postB]) {
    const py = getTerrainHeight(p.x, p.z);
    const lPost = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.35, 4), mt(WOOD_D));
    lPost.position.set(p.x, py + 0.175, p.z); scene.add(lPost);
  }
  // 3 hanging lanterns along the "string"
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    const lx = postA.x + (postB.x - postA.x) * t;
    const lz = postA.z + (postB.z - postA.z) * t;
    const ly = getTerrainHeight(lx, lz);
    const sag = Math.sin(t * Math.PI) * 0.04;
    const hLantern = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.025, 0.018),
      mt(METAL));
    hLantern.position.set(lx, ly + 0.32 - sag, lz); scene.add(hLantern);
    const hGlow = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 3),
      mt(0xffe0a0, { emissive: 0xffe0a0, emissiveIntensity: 0.4 }));
    hGlow.position.set(lx, ly + 0.3 - sag, lz); scene.add(hGlow);
  }

  // ── Drying rack / clothesline with cloth swaying in wind ──
  const rackX = cx + 1.8, rackZ = cz - 0.3;
  const rackY = getTerrainHeight(rackX, rackZ);
  // Two posts
  for (const dx of [-0.15, 0.15]) {
    const rPost = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.3, 4), mt(WOOD_D));
    rPost.position.set(rackX + dx, rackY + 0.15, rackZ); scene.add(rPost);
  }
  // Horizontal bar
  const rBar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.32, 4), mt(WOOD_D));
  rBar.position.set(rackX, rackY + 0.3, rackZ); rBar.rotation.z = Math.PI / 2; scene.add(rBar);
  // Hanging cloth pieces (sway in wind)
  const clothColors = [0xe0d8c0, 0xc8d0e0, 0xd8c0b0];
  for (let i = 0; i < 3; i++) {
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.06, 0.1),
      mtWind(clothColors[i], { heightFactor: 3.0, swayAmp: 0.01, swaySpeed: 1.5 }));
    cloth.position.set(rackX - 0.1 + i * 0.1, rackY + 0.24, rackZ + 0.01);
    scene.add(cloth);
  }

  // ── Beach fire pit with driftwood (second, smaller) ──
  const bfAngle = 2.5; // SE beach area
  const bfR = getIslandRadius(bfAngle) - 0.8;
  const bfx = Math.cos(bfAngle) * bfR, bfz = Math.sin(bfAngle) * bfR;
  const bfy = getTerrainHeight(bfx, bfz);
  // Small stone ring
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.025, 0), mt(STONE));
    st.position.set(bfx + Math.cos(a) * 0.1, bfy + 0.012, bfz + Math.sin(a) * 0.1);
    st.scale.y = 0.5; scene.add(st);
  }
  // Driftwood logs
  for (let i = 0; i < 3; i++) {
    const da = Math.random() * Math.PI * 2;
    const dd = 0.2 + Math.random() * 0.15;
    const dlx = bfx + Math.cos(da) * dd, dlz = bfz + Math.sin(da) * dd;
    const dly = getTerrainHeight(dlx, dlz);
    const dLog = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.15 + Math.random() * 0.1, 4),
      mt(0xb0a890, { roughness: 0.95 }));
    dLog.position.set(dlx, dly + 0.01, dlz);
    dLog.rotation.z = Math.PI / 2; dLog.rotation.y = Math.random() * Math.PI;
    scene.add(dLog);
  }
}

function createBoats() {
  // ── Sailboat anchored offshore ──
  const sbAngle = Math.atan2(1.5, -10) + 0.3; // offset from dock
  const dockEdge = getIslandRadius(sbAngle);
  const sbDist = dockEdge + 2.5; // 2-3 boat-lengths out
  const sbx = Math.cos(sbAngle) * sbDist, sbz = Math.sin(sbAngle) * sbDist;
  const sailboat = new THREE.Group();
  sailboat.position.set(sbx, -0.1, sbz);
  sailboat.rotation.y = 0.8;
  sailboat.scale.setScalar(2.2);
  // Hull
  const sbHull = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.4), mt(WOOD));
  sbHull.position.y = 0.02; sailboat.add(sbHull);
  // Bow
  const sbBow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4),
    mt(WOOD));
  sbBow.position.set(0, 0.02, 0.25); sbBow.rotation.x = Math.PI / 2; sailboat.add(sbBow);
  // Mast
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.4, 4), mt(WOOD_D));
  mast.position.set(0, 0.22, 0.05); sailboat.add(mast);
  // Sail
  const sailGeo = new THREE.BufferGeometry();
  const sailVerts = new Float32Array([
    0, 0.08, 0.05,   0, 0.38, 0.05,   0.15, 0.15, 0.05,
  ]);
  sailGeo.setAttribute('position', new THREE.BufferAttribute(sailVerts, 3));
  sailGeo.computeVertexNormals();
  const sail = new THREE.Mesh(sailGeo, mt(CREAM, { transparent: true, opacity: 0.85 }));
  sail.material.side = THREE.DoubleSide;
  sailboat.add(sail);
  scene.add(sailboat);
  const sbBobEntry = { type: "bob", mesh: sailboat, speed: 0.5, baseY: -0.1, amp: 0.018, phase: 1.0 };
  animatedObjects.push(sbBobEntry);

  // Register sailboat as interactive
  const sbHitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 4, 4),
    new THREE.MeshBasicMaterial({ visible: false }));
  sbHitbox.position.set(sbx, 0, sbz);
  scene.add(sbHitbox);
  interactiveObjects.push({
    hitbox: sbHitbox, type: "boat", label: "Inspect",
    group: sailboat, data: { name: "Sailboat" },
    reaction: () => {
      // Rock more aggressively
      const origAmp = sbBobEntry.amp;
      sbBobEntry.amp = 0.06;
      setTimeout(() => { sbBobEntry.amp = origAmp; }, 2000);
    },
  });

  // ── Distant sailboat silhouettes (horizon) ──
  const distBoats = [[25, -15], [-30, 20]];
  distBoats.forEach(([dx, dz]) => {
    const db = new THREE.Group();
    db.position.set(dx, -0.15, dz);
    const dHull = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.2), mt(0x907060));
    dHull.position.y = 0.01; db.add(dHull);
    const dMast = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.2, 3), mt(0x806050));
    dMast.position.y = 0.1; db.add(dMast);
    const dSail = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.14),
      mt(CREAM, { transparent: true, opacity: 0.6 }));
    dSail.position.set(0.03, 0.1, 0); db.add(dSail);
    db.scale.setScalar(2.5);
    scene.add(db);
    animatedObjects.push({ type: "bob", mesh: db, speed: 0.3, baseY: -0.15, amp: 0.01, phase: dx });
  });

  // ── Buoys between dock and horizon ──
  const dockA = Math.atan2(1.5, -10);
  for (let i = 0; i < 3; i++) {
    const ba = dockA + (i - 1) * 0.2;
    const bd = getIslandRadius(ba) + 2 + i * 2;
    const bx = Math.cos(ba) * bd, bz = Math.sin(ba) * bd;
    const buoy = new THREE.Group();
    buoy.position.set(bx, -0.15, bz);
    const buoyBody = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 5),
      mt(i === 1 ? 0xc04040 : 0xc0c040));
    buoyBody.position.y = 0.01; buoy.add(buoyBody);
    const buoyTop = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3), mt(CREAM));
    buoyTop.position.y = 0.05; buoy.add(buoyTop);
    scene.add(buoy);
    animatedObjects.push({ type: "bob", mesh: buoy, speed: 0.8, baseY: -0.15, amp: 0.015, phase: i * 2 });
  }

  // ── Crab pots / fishing crates at dock's land end ──
  const cpAngle = Math.atan2(1.5, -10);
  const cpR = getIslandRadius(cpAngle) - 0.8;
  const cpx = Math.cos(cpAngle) * cpR, cpz = Math.sin(cpAngle) * cpR;
  const cpy = getTerrainHeight(cpx, cpz);
  // Stacked crates
  const fCrate1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.1), mt(WOOD_D));
  fCrate1.position.set(cpx, cpy + 0.04, cpz); scene.add(fCrate1);
  const fCrate2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.08), mt(WOOD));
  fCrate2.position.set(cpx + 0.08, cpy + 0.035, cpz - 0.05);
  fCrate2.rotation.y = 0.4; scene.add(fCrate2);
  // Crab pot (wire cage look — torus + cylinder)
  const crabPot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 6),
    mt(0x808070, { transparent: true, opacity: 0.5 }));
  crabPot.position.set(cpx - 0.1, cpy + 0.02, cpz + 0.08); scene.add(crabPot);
  // Rope coil
  const fRope = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 3, 6), mt(0xc0b080));
  fRope.position.set(cpx + 0.15, cpy + 0.01, cpz + 0.05);
  fRope.rotation.x = -Math.PI / 2; scene.add(fRope);

  // ── Boathouse / shed at dock base ──
  const bhx = cpx + 0.3, bhz = cpz + 0.3;
  const bhy = getTerrainHeight(bhx, bhz);
  const boathouse = new THREE.Group();
  boathouse.position.set(bhx, bhy, bhz);
  boathouse.rotation.y = cpAngle + Math.PI;
  const bhBody = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.25), mt(WOOD_D));
  bhBody.position.y = 0.11; bhBody.castShadow = true; boathouse.add(bhBody);
  const bhRoof = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.28), mt(WOOD));
  bhRoof.position.y = 0.23; bhRoof.castShadow = true; boathouse.add(bhRoof);
  // Peaked top
  const bhPeak = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.08, 4),
    mt(WOOD));
  bhPeak.position.y = 0.28; bhPeak.rotation.y = Math.PI / 4; boathouse.add(bhPeak);
  // Door
  const bhDoor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.01), mt(CREAM, { roughness: 0.5 }));
  bhDoor.position.set(0, 0.08, 0.13); boathouse.add(bhDoor);
  boathouse.add(makeContactShadow(0.2));
  scene.add(boathouse);
}

function createHilltopStructures() {
  // ── Gazebo / lookout on the ridge's highest point ──
  // Ridge peaks where x*0.6 + z*0.8 ≈ 1.0 and slope is high NE
  // Best spot: approximately [4, 1] where ridge + slope converge
  const gzx = 4, gzz = 0;
  const gzy = getTerrainHeight(gzx, gzz);
  const gazebo = new THREE.Group();
  gazebo.position.set(gzx, gzy, gzz);
  // 4 posts
  for (const [px, pz] of [[-0.15, -0.12], [0.15, -0.12], [-0.15, 0.12], [0.15, 0.12]]) {
    const gPost = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.4, 4), mt(WOOD_D));
    gPost.position.set(px, 0.2, pz); gazebo.add(gPost);
  }
  // Peaked roof
  const gRoof = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.12, 4), mt(WOOD));
  gRoof.position.y = 0.46; gRoof.rotation.y = Math.PI / 4; gRoof.castShadow = true; gazebo.add(gRoof);
  // Floor
  const gFloor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.26), mt(WOOD_D));
  gFloor.position.y = 0.01; gazebo.add(gFloor);
  // Bench inside, facing the water
  const gBench = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.06), mt(WOOD));
  gBench.position.set(0, 0.08, -0.06); gazebo.add(gBench);
  // Railing on water-facing side
  const gRail = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.012, 0.012), mt(WOOD_D));
  gRail.position.set(0, 0.18, 0.12); gazebo.add(gRail);
  gazebo.add(makeContactShadow(0.2));
  scene.add(gazebo);

  // ── Stone cairn on a different rise ──
  // Rock outcrop area at [7, -4]
  const cairnX = 7.5, cairnZ = -3.5;
  const cairnY = getTerrainHeight(cairnX, cairnZ);
  for (let i = 0; i < 5; i++) {
    const cs = 0.04 - i * 0.006;
    const cairnStone = new THREE.Mesh(new THREE.DodecahedronGeometry(cs, 0), mt(STONE));
    cairnStone.position.set(cairnX + (Math.random() - 0.5) * 0.01, cairnY + i * 0.05 + 0.02, cairnZ);
    cairnStone.rotation.set(Math.random(), Math.random(), Math.random());
    scene.add(cairnStone);
  }

  // ── Weathervane on exposed hilltop ──
  // Analysis hill area — near the observatory
  const wvx = -5, wvz = 7;
  const wvy = getTerrainHeight(wvx, wvz);
  const wvGroup = new THREE.Group();
  wvGroup.position.set(wvx, wvy, wvz);
  const wvPole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.5, 4), mt(METAL));
  wvPole.position.y = 0.25; wvGroup.add(wvPole);
  // Spinning vane
  const vane = new THREE.Group();
  vane.position.y = 0.5;
  const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.005, 0.02), mt(METAL));
  vane.add(arrow);
  const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 3), mt(METAL));
  arrowHead.position.x = 0.11; arrowHead.rotation.z = -Math.PI / 2; vane.add(arrowHead);
  wvGroup.add(vane);
  scene.add(wvGroup);
  animatedObjects.push({ type: "spin", mesh: vane, speed: 0.3 });

  // ── Stone steps on the ridge's steeper slope ──
  const stepStart = [2, -1], stepEnd = [4, 0];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const sx = stepStart[0] + (stepEnd[0] - stepStart[0]) * t;
    const sz = stepStart[1] + (stepEnd[1] - stepStart[1]) * t;
    const sy = getTerrainHeight(sx, sz);
    const ridgeStep = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.08), mt(STONE));
    ridgeStep.position.set(sx, sy + 0.015, sz);
    ridgeStep.rotation.y = Math.atan2(stepEnd[0] - stepStart[0], stepEnd[1] - stepStart[1]);
    scene.add(ridgeStep);
  }
}

function createMiscStructures() {
  // ── Well near plaza ──
  const wellX = 1.8, wellZ = 1.5;
  const wellY = getTerrainHeight(wellX, wellZ);
  const well = new THREE.Group();
  well.position.set(wellX, wellY, wellZ);
  const wellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 8), mt(STONE));
  wellBase.position.y = 0.06; well.add(wellBase);
  // Posts
  for (const side of [-1, 1]) {
    const wPost = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.22, 4), mt(WOOD_D));
    wPost.position.set(side * 0.08, 0.23, 0); well.add(wPost);
  }
  // Cross bar
  const wBar = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 4), mt(WOOD_D));
  wBar.position.set(0, 0.34, 0); wBar.rotation.z = Math.PI / 2; well.add(wBar);
  // Bucket
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.018, 0.03, 5), mt(WOOD));
  bucket.position.set(0, 0.2, 0.02); well.add(bucket);
  // Rope
  const wRope = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14, 3), mt(0xc0b080));
  wRope.position.set(0, 0.27, 0.02); well.add(wRope);
  well.add(makeContactShadow(0.1));
  scene.add(well);

  // ── Herb garden with low fence near greenhouse [6, -6] ──
  const hgx = 6.8, hgz = -7.2;
  const hgy = getTerrainHeight(hgx, hgz);
  // Raised bed
  const hBed = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), mt(WOOD_D));
  hBed.position.set(hgx, hgy + 0.03, hgz); scene.add(hBed);
  // Plants
  for (let i = 0; i < 6; i++) {
    const px = hgx - 0.18 + (i % 3) * 0.16;
    const pz = hgz - 0.06 + Math.floor(i / 3) * 0.12;
    const herb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3),
      mt(i % 2 === 0 ? GREEN_L : GREEN_D));
    herb.position.set(px, hgy + 0.08, pz); scene.add(herb);
  }
  // Low fence
  for (let i = 0; i < 4; i++) {
    const fx = hgx - 0.28 + i * 0.18;
    const fPost = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.1, 3), mt(WOOD_D));
    fPost.position.set(fx, hgy + 0.05, hgz + 0.18); scene.add(fPost);
  }
  const fRail = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.008, 0.008), mt(WOOD_D));
  fRail.position.set(hgx, hgy + 0.08, hgz + 0.18); scene.add(fRail);

  // ── Woodpile and chopping block near Design building [6, 6] ──
  const wpx = 5.2, wpz = 6.5;
  const wpy = getTerrainHeight(wpx, wpz);
  // Chopping block (tree stump)
  const block = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 6), mt(WOOD_D));
  block.position.set(wpx, wpy + 0.05, wpz); scene.add(block);
  // Axe (handle + head)
  const axeH = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 3), mt(WOOD_D));
  axeH.position.set(wpx, wpy + 0.12, wpz + 0.05); axeH.rotation.z = -0.3; scene.add(axeH);
  const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.008), mt(METAL));
  axeHead.position.set(wpx - 0.02, wpy + 0.18, wpz + 0.05); scene.add(axeHead);
  // Stacked logs
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3 - row; col++) {
      const logM = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.12, 4),
        mt(row % 2 === 0 ? WOOD : WOOD_D));
      logM.position.set(wpx + 0.2, wpy + 0.02 + row * 0.04, wpz - 0.1 + col * 0.045);
      logM.rotation.x = Math.PI / 2; scene.add(logM);
    }
  }

  // ── Research crates under tarp along a path ──
  const rcx = -2, rcz = -3;
  const rcy = getTerrainHeight(rcx, rcz);
  const rc1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.1), mt(WOOD_D));
  rc1.position.set(rcx, rcy + 0.05, rcz); scene.add(rc1);
  const rc2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.12), mt(WOOD));
  rc2.position.set(rcx + 0.1, rcy + 0.04, rcz + 0.08);
  rc2.rotation.y = 0.3; scene.add(rc2);
  // Tarp draped over
  const tarp = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.22),
    mt(0xa0b890, { transparent: true, opacity: 0.85 }));
  tarp.position.set(rcx + 0.05, rcy + 0.12, rcz + 0.03);
  tarp.rotation.x = -0.4; tarp.rotation.z = 0.1;
  tarp.material.side = THREE.DoubleSide; scene.add(tarp);

  // ── Standing stones (ruins, sense of history) ──
  const ssX = 3, ssZ = -7;
  const ssY = getTerrainHeight(ssX, ssZ);
  const stones = [
    { dx: 0, dz: 0, h: 0.3, w: 0.08, d: 0.04 },
    { dx: 0.15, dz: 0.05, h: 0.22, w: 0.06, d: 0.04 },
    { dx: -0.1, dz: 0.1, h: 0.12, w: 0.07, d: 0.05 }, // fallen/tumbled
  ];
  stones.forEach((s, i) => {
    const sMesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.d), mt(STONE, { roughness: 0.95 }));
    sMesh.position.set(ssX + s.dx, ssY + s.h / 2, ssZ + s.dz);
    if (i === 2) { sMesh.rotation.z = 0.8; sMesh.position.y = ssY + 0.04; }
    else sMesh.rotation.y = (Math.random() - 0.5) * 0.3;
    sMesh.castShadow = true; scene.add(sMesh);
  });

  // ── Field-work canopy near Hypothesis greenhouse ──
  const fwx = 7, fwz = -5;
  const fwy = getTerrainHeight(fwx, fwz);
  const canopy = new THREE.Group();
  canopy.position.set(fwx, fwy, fwz);
  canopy.rotation.y = 0.3;
  for (const [px, pz] of [[-0.2, -0.12], [0.2, -0.12], [-0.2, 0.12], [0.2, 0.12]]) {
    const cPost = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.35, 4), mt(WOOD_D));
    cPost.position.set(px, 0.175, pz); canopy.add(cPost);
  }
  const awning = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.012, 0.28),
    mt(0xd8d0b8, { roughness: 0.9 }));
  awning.position.y = 0.36; awning.castShadow = true; canopy.add(awning);
  // Table underneath
  const fwTable = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 0.14), mt(WOOD));
  fwTable.position.y = 0.15; canopy.add(fwTable);
  const fwLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.14, 4), mt(WOOD_D));
  fwLeg.position.y = 0.07; canopy.add(fwLeg);
  // Instruments on table
  const flask = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.04, 5),
    mt(CREAM, { transparent: true, opacity: 0.5 }));
  flask.position.set(0.05, 0.18, 0); canopy.add(flask);
  const notebook = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.005, 0.035), mt(CREAM));
  notebook.position.set(-0.05, 0.17, 0.02); canopy.add(notebook);
  canopy.add(makeContactShadow(0.2));
  scene.add(canopy);
}

/* ═══════════════════════════════════════════════════════════
   Cloud shadows — drifting soft dark patches across island
   ═══════════════════════════════════════════════════════════ */

let cloudShadowMesh = null;
const cloudShadowUniforms = {
  uTime: { value: 0 },
};

function createCloudShadows() {
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: cloudShadowUniforms,
    vertexShader: `
      varying vec2 vWorldXZ;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldXZ = worldPos.xz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vWorldXZ;
      void main() {
        // Drifting cloud shadow pattern — slow scroll
        vec2 uv = vWorldXZ * 0.04 + vec2(uTime * 0.008, uTime * 0.005);
        // Layer multiple soft blobs
        float c = 0.0;
        c += sin(uv.x * 3.0 + uv.y * 2.0) * sin(uv.y * 4.0 - uv.x * 1.5);
        c += sin(uv.x * 1.5 - uv.y * 3.5 + 1.0) * 0.7;
        c += sin(uv.x * 5.0 + uv.y * 1.0 + 2.0) * 0.3;
        c = smoothstep(0.3, 1.2, c);
        // Soft shadow darkness
        float shadow = c * 0.12;
        gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const cloudGeo = new THREE.PlaneGeometry(30, 30);
  cloudShadowMesh = new THREE.Mesh(cloudGeo, cloudMat);
  cloudShadowMesh.rotation.x = -Math.PI / 2;
  cloudShadowMesh.position.y = 0.02; // just above ground
  cloudShadowMesh.renderOrder = 1;
  scene.add(cloudShadowMesh);
}

const particles = [];

function createParticles() {
  // ── Fairy dust / magical motes — soft glowing particles drifting above the island ──
  const moteColors = [0xffe8a0, 0xa0e0ff, 0xffc0e0, 0xc0ffb0, 0xffd0a0];
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 1 + Math.random() * 8;
    const mx = Math.cos(a) * d, mz = Math.sin(a) * d;
    if (!isOnIsland(mx, mz)) continue;
    const my = getTerrainHeight(mx, mz) + 0.3 + Math.random() * 0.8;
    const mote = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 4, 4),
      new THREE.MeshStandardMaterial({
        color: moteColors[i % moteColors.length],
        emissive: moteColors[i % moteColors.length],
        emissiveIntensity: 0.8,
        transparent: true, opacity: 0.6,
      }));
    mote.position.set(mx, my, mz);
    scene.add(mote);
    particles.push(mote);
    mote.userData = {
      base: { x: mx, y: my, z: mz },
      speed: 0.3 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      radius: 0.2 + Math.random() * 0.3,
    };
  }

  // ── Fireflies (tiny bright points that blink) ──
  for (let i = 0; i < 15; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 2 + Math.random() * 6;
    const fx = Math.cos(a) * d, fz = Math.sin(a) * d;
    if (!isOnIsland(fx, fz)) continue;
    const fy = getTerrainHeight(fx, fz) + 0.15 + Math.random() * 0.4;
    const fly = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 3, 3),
      new THREE.MeshBasicMaterial({
        color: 0xeeff88, transparent: true, opacity: 0.8,
      }));
    fly.position.set(fx, fy, fz);
    scene.add(fly);
    animatedObjects.push({
      type: "firefly", mesh: fly,
      baseX: fx, baseY: fy, baseZ: fz,
      speed: 0.5 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      radius: 0.15 + Math.random() * 0.25,
    });
  }
}

/* ═══════════════════════════════════════════════════════════
   Agent Characters
   ═══════════════════════════════════════════════════════════ */

function createAgent(config, index) {
  const group = new THREE.Group();
  const c = config.body, a = config.accent;
  let topY;

  // Contact shadow at feet
  group.add(makeContactShadow(0.14));

  switch (index % 8) {
    case 0: { // Literature — tall scholar with mortarboard & book
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 8, 16), mt(c));
      body.position.y = 0.24; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), mt(c));
      head.position.y = 0.50; group.add(head);
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.1, 6, 8), mt(c));
        arm.position.set(side * 0.115, 0.26, 0); arm.rotation.z = side * 0.2; group.add(arm);
      }
      // Legs
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.1, 8), mt(c));
        leg.position.set(side * 0.04, 0.06, 0); group.add(leg);
      }
      // Mortarboard
      const hatBoard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, 0.18), mt(a));
      hatBoard.position.y = 0.58; group.add(hatBoard);
      const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 12), mt(a));
      hatCrown.position.y = 0.555; group.add(hatCrown);
      const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 6), mt(0xc45454));
      tassel.position.set(0.09, 0.56, 0.09); tassel.rotation.z = 0.3; group.add(tassel);
      // Book (larger, with visible pages)
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), mt(0xc45454));
      book.position.set(0.13, 0.28, 0.03); group.add(book);
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.015), mt(CREAM));
      pages.position.set(0.13, 0.28, 0.055); group.add(pages);
      topY = 0.60; break;
    }
    case 1: { // Hypothesis — round curious with question mark
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 14), mt(c));
      body.position.y = 0.22; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 14), mt(c));
      head.position.y = 0.44; group.add(head);
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.08, 6, 8), mt(c));
        arm.position.set(side * 0.155, 0.22, 0); arm.rotation.z = side * 0.35; group.add(arm);
      }
      // Feet
      for (const side of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mt(c));
        foot.position.set(side * 0.06, 0.06, 0.02); group.add(foot);
      }
      // Question mark (torus arc + dot)
      const qCurve = new THREE.Mesh(
        new THREE.TorusGeometry(0.025, 0.006, 8, 16, Math.PI * 1.5), mt(CREAM));
      qCurve.position.set(0, 0.57, 0.08); qCurve.rotation.x = 0.2; group.add(qCurve);
      const qDot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), mt(CREAM));
      qDot.position.set(0, 0.535, 0.09); group.add(qDot);
      // Clipboard (held in right arm)
      const clipboard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.008), mt(WOOD));
      clipboard.position.set(0.15, 0.18, 0.06); clipboard.rotation.z = -0.15; group.add(clipboard);
      const clipPaper = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.004), mt(CREAM));
      clipPaper.position.set(0.15, 0.19, 0.065); clipPaper.rotation.z = -0.15; group.add(clipPaper);
      topY = 0.56; break;
    }
    case 2: { // Design — boxy builder with hard hat & pencil
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.15), mt(c));
      body.position.y = 0.23; body.castShadow = true; group.add(body);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.13), mt(c));
      head.position.y = 0.44; head.castShadow = true; group.add(head);
      // Arms (blocky)
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.08, 12, 20), mt(c));
        arm.position.set(side * 0.125, 0.24, 0); arm.rotation.z = side * 0.12; group.add(arm);
      }
      // Legs (blocky)
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.025, 0.1, 16), mt(c));
        leg.position.set(side * 0.05, 0.06, 0); group.add(leg);
      }
      // Hard hat (dome + brim)
      const hat = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mt(a));
      hat.position.y = 0.51; group.add(hat);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 16), mt(a));
      brim.position.y = 0.505; group.add(brim);
      // Pencil (larger, held at side)
      const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 8), mt(0xe8c040));
      pencil.position.set(0.15, 0.28, 0.04); pencil.rotation.z = -0.25; group.add(pencil);
      const pencilTip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 8), mt(0x5a5a5a));
      pencilTip.position.set(0.157, 0.21, 0.04); pencilTip.rotation.z = -0.25; group.add(pencilTip);
      // Ruler (at other side)
      const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.005), mt(WOOD));
      ruler.position.set(-0.13, 0.22, 0.04); ruler.rotation.z = 0.15; group.add(ruler);
      topY = 0.54; break;
    }
    case 3: { // Analysis — detective with hat, monocle & magnifying glass
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.16, 8, 16), mt(c));
      body.position.y = 0.22; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), mt(c));
      head.position.y = 0.46; group.add(head);
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.1, 6, 8), mt(c));
        arm.position.set(side * 0.14, 0.24, 0); arm.rotation.z = side * 0.2; group.add(arm);
      }
      // Legs
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.1, 8), mt(c));
        leg.position.set(side * 0.045, 0.06, 0); group.add(leg);
      }
      // Detective hat (deerstalker — base + dome + front visor)
      const hatBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.035, 16), mt(a));
      hatBase.position.y = 0.545; group.add(hatBase);
      const hatDome = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mt(a));
      hatDome.position.y = 0.56; group.add(hatDome);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.008, 0.05), mt(a));
      visor.position.set(0, 0.54, 0.1); visor.rotation.x = -0.2; group.add(visor);
      // Monocle (larger, more visible)
      const monocle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 12, 24),
        mt(0xd0d0d0, { metalness: 0.5 }));
      monocle.position.set(0.08, 0.48, 0.085); monocle.rotation.y = 0.2; group.add(monocle);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16),
        mt(0xd0e8f0, { roughness: 0.1, transparent: true, opacity: 0.4 }));
      lens.position.set(0.08, 0.48, 0.09); monocle.rotation.y = 0.2; group.add(lens);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.12, 6), mt(0xc0c0c0));
      chain.position.set(0.06, 0.40, 0.06); chain.rotation.z = 0.1; group.add(chain);
      // Magnifying glass (held in left arm, bigger)
      const magRing = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 8, 24),
        mt(0xc8c8c8, { metalness: 0.4 }));
      magRing.position.set(-0.15, 0.28, 0.06); group.add(magRing);
      const magLens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16),
        mt(0xd0e8f0, { roughness: 0.1, transparent: true, opacity: 0.3 }));
      magLens.position.set(-0.15, 0.28, 0.065); group.add(magLens);
      const magHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 8), mt(WOOD_D));
      magHandle.position.set(-0.15, 0.20, 0.06); group.add(magHandle);
      topY = 0.58; break;
    }
    case 4: { // Bear — chunky round body, round ears, snout
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 14), mt(c));
      body.position.y = 0.20; body.scale.set(1, 0.9, 0.85); group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), mt(c));
      head.position.y = 0.42; group.add(head);
      // Round ears
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), mt(c));
        ear.position.set(side * 0.08, 0.52, -0.01); group.add(ear);
        const innerEar = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), mt(a));
        innerEar.position.set(side * 0.08, 0.52, 0.015); group.add(innerEar);
      }
      // Snout + nose
      const snout = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), mt(a));
      snout.position.set(0, 0.40, 0.1); snout.scale.set(1, 0.7, 0.8); group.add(snout);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), mt(0x505050));
      nose.position.set(0, 0.41, 0.14); group.add(nose);
      // Stubby arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.06, 6, 8), mt(c));
        arm.position.set(side * 0.14, 0.20, 0); arm.rotation.z = side * 0.4; group.add(arm);
      }
      // Stubby legs
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mt(c));
        leg.position.set(side * 0.06, 0.05, 0.02); group.add(leg);
      }
      // Honey pot
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.04, 12), mt(0xc89840));
      pot.position.set(0.15, 0.14, 0.06); group.add(pot);
      topY = 0.55; break;
    }
    case 5: { // Rabbit — long ears, fluffy body, cotton tail
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.10, 0.14, 8, 16), mt(c));
      body.position.y = 0.21; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.10, 16, 12), mt(c));
      head.position.y = 0.44; group.add(head);
      // Long ears
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.12, 6, 8), mt(c));
        ear.position.set(side * 0.04, 0.58, -0.01); ear.rotation.z = side * 0.1; group.add(ear);
        const innerEar = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.09, 6, 8), mt(a));
        innerEar.position.set(side * 0.04, 0.58, 0.01); innerEar.rotation.z = side * 0.1; group.add(innerEar);
      }
      // Buck teeth
      for (const side of [-0.5, 0.5]) {
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.018, 0.007), mt(CREAM));
        tooth.position.set(side * 0.012, 0.385, 0.095); group.add(tooth);
      }
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.08, 6, 8), mt(c));
        arm.position.set(side * 0.12, 0.22, 0); arm.rotation.z = side * 0.25; group.add(arm);
      }
      // Big feet
      for (const side of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.04, 6, 8), mt(c));
        foot.position.set(side * 0.05, 0.04, 0.03); foot.rotation.x = Math.PI / 2; group.add(foot);
      }
      // Fluffy tail
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mt(CREAM));
      tail.position.set(0, 0.18, -0.1); group.add(tail);
      // Carrot
      const carrot = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 8), mt(0xe08030));
      carrot.position.set(0.12, 0.15, 0.05); carrot.rotation.z = -0.3; group.add(carrot);
      const carrotLeaf = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.025, 6), mt(GREEN_D));
      carrotLeaf.position.set(0.115, 0.185, 0.05); carrotLeaf.rotation.z = -0.1; group.add(carrotLeaf);
      topY = 0.66; break;
    }
    case 6: { // Cat — pointy ears, whiskers, curling tail
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.18, 8, 16), mt(c));
      body.position.y = 0.22; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), mt(c));
      head.position.y = 0.46; head.scale.set(1, 0.9, 0.9); group.add(head);
      // Pointy ears
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 8), mt(c));
        ear.position.set(side * 0.06, 0.55, -0.01); group.add(ear);
        const innerEar = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 8), mt(a));
        innerEar.position.set(side * 0.06, 0.55, 0.01); group.add(innerEar);
      }
      // Whiskers
      for (const side of [-1, 1]) {
        for (let w = 0; w < 2; w++) {
          const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.001, 0.08, 6), mt(CREAM));
          whisker.position.set(side * 0.08, 0.44 + w * 0.02, 0.07);
          whisker.rotation.z = Math.PI / 2 + side * (0.15 + w * 0.15);
          group.add(whisker);
        }
      }
      // Nose
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), mt(a));
      nose.position.set(0, 0.44, 0.085); group.add(nose);
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.09, 6, 8), mt(c));
        arm.position.set(side * 0.11, 0.23, 0); arm.rotation.z = side * 0.2; group.add(arm);
      }
      // Legs
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.09, 8), mt(c));
        leg.position.set(side * 0.04, 0.06, 0); group.add(leg);
      }
      // Curving tail
      const tail = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 8, 16, Math.PI * 0.8), mt(c));
      tail.position.set(0, 0.2, -0.1); tail.rotation.x = -0.5; group.add(tail);
      // Yarn ball
      const yarn = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), mt(0xc04060));
      yarn.position.set(-0.12, 0.06, 0.06); group.add(yarn);
      topY = 0.58; break;
    }
    case 7: { // Fox — pointy ears, bushy tail, white chest
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.18, 8, 16), mt(c));
      body.position.y = 0.22; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), mt(c));
      head.position.y = 0.47; head.scale.set(1, 0.9, 1.1); group.add(head);
      // White chest
      const chest = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), mt(CREAM));
      chest.position.set(0, 0.22, 0.06); chest.scale.set(0.8, 1.2, 0.5); group.add(chest);
      // Pointy ears with dark tips
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 8), mt(c));
        ear.position.set(side * 0.055, 0.56, 0); group.add(ear);
        const earTip = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.03, 8), mt(0x505050));
        earTip.position.set(side * 0.055, 0.59, 0); group.add(earTip);
      }
      // Narrow snout
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 10), mt(c));
      snout.position.set(0, 0.44, 0.1); snout.rotation.x = Math.PI / 2; group.add(snout);
      const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), mt(0x505050));
      noseTip.position.set(0, 0.445, 0.13); group.add(noseTip);
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.09, 6, 8), mt(c));
        arm.position.set(side * 0.115, 0.23, 0); arm.rotation.z = side * 0.2; group.add(arm);
      }
      // Dark paws
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.09, 8), mt(0x5a5a5a));
        leg.position.set(side * 0.04, 0.06, 0); group.add(leg);
      }
      // Bushy tail
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.1, 8, 12), mt(c));
      tail.position.set(0, 0.18, -0.12); tail.rotation.x = -0.4; group.add(tail);
      const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mt(CREAM));
      tailTip.position.set(0, 0.15, -0.18); group.add(tailTip);
      // Small backpack
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.04), mt(a));
      pack.position.set(0, 0.26, -0.08); group.add(pack);
      topY = 0.60; break;
    }
  }

  // Eyes — larger, more legible face
  const eyeY = [0.51, 0.46, 0.45, 0.48, 0.44, 0.46, 0.47, 0.48][index % 8];
  const eyeZ = [0.075, 0.09, 0.07, 0.08, 0.08, 0.085, 0.065, 0.08][index % 8];
  const eyeX = [0.035, 0.042, 0.048, 0.038, 0.045, 0.04, 0.04, 0.035][index % 8];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), mt(CREAM, { roughness: 0.3 }));
    eye.position.set(side * eyeX, eyeY, eyeZ); group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), mt(0x505050));
    pupil.position.set(side * eyeX, eyeY, eyeZ + 0.017); group.add(pupil);
  }

  // Antenna + glow (shorter, tighter to head)
  const antennaWire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.1, 8), mt(0xb0b0b0, { metalness: 0.3 }));
  antennaWire.position.set(0, topY + 0.05, 0); group.add(antennaWire);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 10),
    mt(config.body, { emissive: config.body, emissiveIntensity: 0.3 }));
  antennaTip.position.set(0, topY + 0.11, 0); group.add(antennaTip);

  // Signal rings — smaller, subtler (no floating-artifact look)
  const signalRing = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.003, 8, 24),
    new THREE.MeshBasicMaterial({ color: config.body, transparent: true, opacity: 0.35 }));
  signalRing.rotation.x = -Math.PI / 2;
  signalRing.position.set(0, topY + 0.11, 0); group.add(signalRing);
  const signalRing2 = signalRing.clone();
  signalRing2.material = signalRing.material.clone();
  group.add(signalRing2);

  const label = makeLabel(config.name, config.body);
  label.position.set(0, topY + 0.28, 0); group.add(label);

  const speechBubble = makeSpeechBubble();
  speechBubble.position.set(0.15, topY + 0.18, 0); group.add(speechBubble);

  const scroll = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.065),
    mt(config.body, { roughness: 0.5 }));
  scroll.position.set(0, 0.45, 0.1); scroll.visible = false; group.add(scroll);

  // Invisible hitbox for click detection
  const hitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 8),
    new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = 0.3;
  group.add(hitbox);

  // Scale agents down to ~55% so they read as smaller relative to buildings
  group.scale.setScalar(0.55);
  topY *= 0.55;

  group.position.set(...config.home);
  if (index === 3) group.position.y = ANALYSIS_HILL_Y;

  // children[0] = contact shadow, [1] = body, [2] = head
  const bodyMesh = group.children[1];
  const headMesh = group.children[2];

  return {
    group, bodyMesh, headMesh, hitbox, scroll, antennaTip, signalRing, signalRing2,
    speechBubble, config, index, state: "idle",
    pauseTimer: 60 + index * 30, idleTimer: 80 + index * 60, target: null, topY,
    // Physics state for smooth movement
    speed: 0,               // current forward speed (lerps toward WALK_SPEED)
    facingAngle: config.angle + Math.PI, // smoothed facing direction
    smoothY: config.home[1], // smoothed ground height
  };
}

/* ═══════════════════════════════════════════════════════════
   Agent FSM — with district idle behavior
   ═══════════════════════════════════════════════════════════ */

// Steer direction away from obstacles (buildings, trees, other agents)
function avoidObstacles(px, pz, dirX, dirZ, agentIdx) {
  let steerX = 0, steerZ = 0;
  const AVOID_R = 0.4; // agent personal radius
  const LOOK_AHEAD = 1.5; // how far ahead to check
  // Check static obstacles (buildings)
  for (const obs of obstacles) {
    const dx = obs.x - px, dz = obs.z - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = obs.r + AVOID_R;
    if (dist < minDist + LOOK_AHEAD && dist > 0.01) {
      // Check if obstacle is ahead of us
      const dot = dx * dirX + dz * dirZ;
      if (dot > 0) { // obstacle is in front
        const strength = Math.max(0, 1 - (dist - minDist) / LOOK_AHEAD);
        // Push perpendicular to the obstacle direction (go around)
        const perpX = -dz / dist, perpZ = dx / dist;
        // Choose side: pick the one more aligned with current direction
        const sideSign = (perpX * dirX + perpZ * dirZ) > 0 ? 1 : -1;
        steerX += perpX * sideSign * strength * 0.06;
        steerZ += perpZ * sideSign * strength * 0.06;
        // Also push away if very close
        if (dist < minDist * 1.1) {
          steerX -= (dx / dist) * 0.04;
          steerZ -= (dz / dist) * 0.04;
        }
      }
    }
  }
  // Check other agents
  for (let i = 0; i < agents.length; i++) {
    if (i === agentIdx) continue;
    const other = agents[i].group.position;
    const dx = other.x - px, dz = other.z - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = AVOID_R * 2;
    if (dist < minDist + 0.5 && dist > 0.01) {
      const strength = Math.max(0, 1 - (dist - minDist) / 0.5);
      steerX -= (dx / dist) * strength * 0.03;
      steerZ -= (dz / dist) * strength * 0.03;
    }
  }
  return { x: dirX + steerX, z: dirZ + steerZ };
}

// Smoothly interpolate angle (handles wrapping)
function lerpAngle(a, b, t) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function updateAgent(agent) {
  const t = clock.getElapsedTime();
  const pos = agent.group.position;

  // Signal pulse (always — subtle ripple from antenna)
  const pulse = (Math.sin(t * 3 + agent.index * 1.5) + 1) * 0.5;
  const rScale = 1 + pulse * 0.8;
  agent.signalRing.scale.set(rScale, rScale, 1);
  agent.signalRing.material.opacity = 0.3 * (1 - pulse);
  const pulse2 = (Math.sin(t * 3 + agent.index * 1.5 + 1.5) + 1) * 0.5;
  const rScale2 = 1 + pulse2 * 0.8;
  agent.signalRing2.scale.set(rScale2, rScale2, 1);
  agent.signalRing2.material.opacity = 0.25 * (1 - pulse2);
  agent.antennaTip.material.emissiveIntensity = 0.3 + pulse * 0.7;

  const baseY = (agent.useBridge || agent.useBridge2 || agent.useBridge3) ? agent.config.home[1] : getTerrainHeight(pos.x, pos.z);

  // Shared walk helper: moves agent toward target with collision avoidance + smooth physics
  const walkToward = (target, arrivalCallback) => {
    const dx = target.x - pos.x, dz = target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.15) {
      // Decelerate to stop
      agent.speed *= 0.7;
      if (agent.speed < 0.001) { agent.speed = 0; arrivalCallback(); }
      return;
    }
    // Accelerate toward walk speed, decelerate near target
    const targetSpeed = dist < 0.5 ? WALK_SPEED * (dist / 0.5) : WALK_SPEED;
    agent.speed += (targetSpeed - agent.speed) * 0.1;
    // Direction with obstacle avoidance
    const rawDirX = dx / dist, rawDirZ = dz / dist;
    const steered = avoidObstacles(pos.x, pos.z, rawDirX, rawDirZ, agent.index);
    const sLen = Math.sqrt(steered.x * steered.x + steered.z * steered.z);
    const finalDirX = sLen > 0 ? steered.x / sLen : rawDirX;
    const finalDirZ = sLen > 0 ? steered.z / sLen : rawDirZ;
    // Apply movement
    pos.x += finalDirX * agent.speed;
    pos.z += finalDirZ * agent.speed;
    // Smooth terrain following
    const onBridge = (agent.useBridge || agent.useBridge2 || agent.useBridge3 || agent.useBridge4);
    const terrainY = getTerrainHeight(pos.x, pos.z);
    const targetY = (onBridge && terrainY < -0.1) ? 0.03 : terrainY;
    agent.smoothY += (targetY - agent.smoothY) * 0.15;
    // Walk bob: foot-step bounce (faster, more natural than sin)
    const stepPhase = t * 11 + agent.index;
    const stepBounce = Math.abs(Math.sin(stepPhase)) * 0.03 * (agent.speed / WALK_SPEED);
    pos.y = agent.smoothY + stepBounce;
    // Smooth rotation toward movement direction
    const desiredAngle = Math.atan2(finalDirX, finalDirZ);
    agent.facingAngle = lerpAngle(agent.facingAngle, desiredAngle, 0.12);
    agent.group.rotation.y = agent.facingAngle;
    // Walk animation: body sway + arm swing
    const walkCycle = Math.sin(stepPhase);
    agent.bodyMesh.rotation.z = walkCycle * 0.06 * (agent.speed / WALK_SPEED);
    // Slight forward lean while walking
    agent.bodyMesh.rotation.x = 0.04 * (agent.speed / WALK_SPEED);
    agent.headMesh.rotation.x = -0.02 * (agent.speed / WALK_SPEED);
  };

  switch (agent.state) {
    case "idle": {
      agent.speechBubble.visible = false;
      const idlePhase = t * 0.8 + agent.index * 2;
      // Decelerate to stop
      agent.speed *= 0.9;
      agent.bodyMesh.rotation.x = 0;

      if (agent.index === 0) {
        agent.headMesh.rotation.x = -0.12 + Math.sin(t * 0.6) * 0.05;
        agent.bodyMesh.rotation.z = Math.sin(t * 0.3) * 0.015;
        pos.y = baseY + Math.sin(t * 0.5 + agent.index) * 0.01;
      } else {
        pos.y = baseY + Math.sin(t * BOB_SPEED + agent.index * 1.7) * BOB_AMP * 0.5;
        agent.headMesh.rotation.y = Math.sin(idlePhase) * 0.25;
        agent.bodyMesh.rotation.z = Math.sin(t * 1.0 + agent.index * 2) * 0.02;
      }

      // Smooth rotation to idle facing
      const idleAngle = agent.config.angle + Math.PI;
      agent.facingAngle = lerpAngle(agent.facingAngle, idleAngle, 0.05);
      agent.group.rotation.y = agent.facingAngle;
      agent.idleTimer--;
      if (agent.idleTimer <= 0) {
        agent.state = "walking-to-plaza";
        agent.scroll.visible = !agentsMuted;
        agent.headMesh.rotation.x = 0;
        // Seat on the agent's own side of the table (no crossing through center)
        const homeAngle = Math.atan2(agent.config.home[0], agent.config.home[2]);
        const seatR = PLAZA_R + 0.35;
        const plazaSeat = new THREE.Vector3(
          Math.sin(homeAngle) * seatR, 0, Math.cos(homeAngle) * seatR);
        // Bridge agents get waypoints: island end → main end → plaza
        if (agent.useBridge && bridgeIslandEnd && bridgeMainEnd) {
          agent.waypoints = [
            new THREE.Vector3(bridgeIslandEnd.x, 0, bridgeIslandEnd.z),
            new THREE.Vector3(bridgeMainEnd.x, 0, bridgeMainEnd.z),
            plazaSeat,
          ];
          agent.target = agent.waypoints.shift();
        } else if (agent.useBridge2 && bridge2IslandEnd && bridge2MainEnd) {
          agent.waypoints = [
            new THREE.Vector3(bridge2IslandEnd.x, 0, bridge2IslandEnd.z),
            new THREE.Vector3(bridge2MainEnd.x, 0, bridge2MainEnd.z),
            plazaSeat,
          ];
          agent.target = agent.waypoints.shift();
        } else if (agent.useBridge3 && bridge3IslandEnd && bridge3MainEnd) {
          agent.waypoints = [
            new THREE.Vector3(bridge3IslandEnd.x, 0, bridge3IslandEnd.z),
            new THREE.Vector3(bridge3MainEnd.x, 0, bridge3MainEnd.z),
            plazaSeat,
          ];
          agent.target = agent.waypoints.shift();
        } else if (agent.useBridge4 && bridge4IslandEnd && bridge4MainEnd) {
          agent.waypoints = [
            new THREE.Vector3(bridge4IslandEnd.x, 0, bridge4IslandEnd.z),
            new THREE.Vector3(bridge4MainEnd.x, 0, bridge4MainEnd.z),
            plazaSeat,
          ];
          agent.target = agent.waypoints.shift();
        } else {
          agent.waypoints = [];
          agent.target = plazaSeat;
        }
      }
      break;
    }
    case "walking-to-plaza": {
      walkToward(agent.target, () => {
        if (agent.waypoints && agent.waypoints.length > 0) {
          agent.target = agent.waypoints.shift();
        } else {
          const isSymposium = symposiumActive;
          agent.state = "exchanging";
          agent.pauseTimer = isSymposium ? 99999 : EXCHANGE_F;
          agent.scroll.visible = false;
          agent.bodyMesh.rotation.x = 0;
          if (!isSymposium) {
            const line = CASUAL_LINES[Math.floor(Math.random() * CASUAL_LINES.length)];
            showHtmlBubble(agents.indexOf(agent), line);
          }
          agent.speechBubble.visible = false;
          addPaperToTable(agent);
          if (isSymposium && dialogueStep < 0) {
            dialogueStep = 0;
            dialogueTimer = DIALOGUE_SHOW_FRAMES;
            startDialogueLine(0);
          }
        }
      });
      break;
    }
    case "exchanging": {
      agent.smoothY += (getTerrainHeight(pos.x, pos.z) - agent.smoothY) * 0.1;
      pos.y = agent.smoothY + Math.sin(t * 3 + agent.index) * 0.015 + 0.015;
      // Face inward toward the table center (smooth)
      const faceAngle = Math.atan2(-pos.x, -pos.z);
      agent.facingAngle = lerpAngle(agent.facingAngle, faceAngle, 0.08);
      agent.group.rotation.y = agent.facingAngle;
      agent.headMesh.rotation.y = Math.sin(t * 2.5 + agent.index) * 0.35;
      agent.bodyMesh.rotation.x = 0;
      // Advance dialogue if symposium is running
      if (symposiumActive && agent.index === 0) advanceDialogue();
      agent.pauseTimer--;
      if (agent.pauseTimer <= 0) {
        agent.state = "walking-home";
        // Bridge agents get waypoints: main end → island end → home
        if (agent.useBridge && bridgeMainEnd && bridgeIslandEnd) {
          agent.waypoints = [
            new THREE.Vector3(bridgeMainEnd.x, 0, bridgeMainEnd.z),
            new THREE.Vector3(bridgeIslandEnd.x, 0, bridgeIslandEnd.z),
            new THREE.Vector3(...agent.config.home),
          ];
          agent.target = agent.waypoints.shift();
        } else if (agent.useBridge2 && bridge2MainEnd && bridge2IslandEnd) {
          agent.waypoints = [
            new THREE.Vector3(bridge2MainEnd.x, 0, bridge2MainEnd.z),
            new THREE.Vector3(bridge2IslandEnd.x, 0, bridge2IslandEnd.z),
            new THREE.Vector3(...agent.config.home),
          ];
          agent.target = agent.waypoints.shift();
        } else if (agent.useBridge3 && bridge3MainEnd && bridge3IslandEnd) {
          agent.waypoints = [
            new THREE.Vector3(bridge3MainEnd.x, 0, bridge3MainEnd.z),
            new THREE.Vector3(bridge3IslandEnd.x, 0, bridge3IslandEnd.z),
            new THREE.Vector3(...agent.config.home),
          ];
          agent.target = agent.waypoints.shift();
        } else if (agent.useBridge4 && bridge4MainEnd && bridge4IslandEnd) {
          agent.waypoints = [
            new THREE.Vector3(bridge4MainEnd.x, 0, bridge4MainEnd.z),
            new THREE.Vector3(bridge4IslandEnd.x, 0, bridge4IslandEnd.z),
            new THREE.Vector3(...agent.config.home),
          ];
          agent.target = agent.waypoints.shift();
        } else {
          agent.waypoints = [];
          agent.target = new THREE.Vector3(...agent.config.home);
        }
        agent.speechBubble.visible = false;
        hideHtmlBubble(agents.indexOf(agent));
        cleanupDialogue();
      }
      break;
    }
    case "walking-home": {
      walkToward(agent.target, () => {
        if (agent.waypoints && agent.waypoints.length > 0) {
          agent.target = agent.waypoints.shift();
        } else {
          const homeY = (agent.useBridge || agent.useBridge2 || agent.useBridge3) ? agent.config.home[1] : getTerrainHeight(agent.config.home[0], agent.config.home[2]);
          pos.set(agent.config.home[0], homeY, agent.config.home[2]);
          agent.smoothY = homeY;
          agent.state = "idle";
          agent.speed = 0;
          agent.bodyMesh.rotation.x = 0;
          agent.idleTimer = WAITS[agent.index % WAITS.length] + Math.random() * 80;
          hideHtmlBubble(agents.indexOf(agent));
          checkSymposiumEnd();
        }
      });
      break;
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Extra Features — more bonfires, small islands, yachts, airplane
   ═══════════════════════════════════════════════════════════ */

function createExtraFeatures() {
  // ── Additional bonfires around the island ──
  const bonfireSpots = [
    { x: -7, z: 3, scale: 0.8 },   // west beach
    { x: 2, z: -8, scale: 0.7 },   // north shore
    { x: 8, z: 3, scale: 0.9 },    // east side
    { x: -4, z: 8, scale: 0.75 },  // south side near analysis
  ];
  bonfireSpots.forEach((spot, idx) => {
    if (!isOnIsland(spot.x, spot.z)) return;
    const by = getTerrainHeight(spot.x, spot.z);
    const fire = new THREE.Group();
    fire.position.set(spot.x, by, spot.z);
    fire.scale.setScalar(spot.scale);
    // Stone ring
    const stoneCount = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < stoneCount; i++) {
      const a = (i / stoneCount) * Math.PI * 2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.03, 0), mt(STONE, { roughness: 0.95 }));
      st.position.set(Math.cos(a) * 0.14, 0.015, Math.sin(a) * 0.14);
      st.rotation.set(Math.random(), Math.random(), Math.random());
      st.scale.y = 0.55; fire.add(st);
    }
    // Flame
    const fMat = new THREE.MeshStandardMaterial({
      color: 0xff8830, emissive: 0xff6610, emissiveIntensity: 1.2,
      roughness: 1, flatShading: true, transparent: true, opacity: 0.85,
    });
    const flm = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 5), fMat);
    flm.position.y = 0.065; fire.add(flm);
    const cMat = new THREE.MeshStandardMaterial({
      color: 0xffcc40, emissive: 0xffaa20, emissiveIntensity: 1.5,
      roughness: 1, flatShading: true, transparent: true, opacity: 0.9,
    });
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 4), cMat);
    core.position.y = 0.045; fire.add(core);
    animatedObjects.push({ type: "flicker", mesh: flm, mat: fMat, phase: idx * 1.5, baseScaleX: 1, baseScaleY: 1 });
    // Point light
    const fLight = new THREE.PointLight(0xff9940, 0.5, 3);
    fLight.position.y = 0.12; fire.add(fLight);
    animatedObjects.push({ type: "lightFlicker", light: fLight, baseIntensity: 0.5, phase: idx * 1.5 });
    // Logs
    for (let i = 0; i < 3; i++) {
      const la = (i / 3) * Math.PI * 2 + Math.random();
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.013, 0.1, 4),
        mt(0x6a5a4a, { roughness: 0.95 }));
      log.position.set(Math.cos(la) * 0.06, 0.008, Math.sin(la) * 0.06);
      log.rotation.z = Math.PI / 2; log.rotation.y = Math.random() * Math.PI;
      fire.add(log);
    }
    // Smoke
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.01 + i * 0.003, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xc0c0c0, transparent: true, opacity: 0.12 - i * 0.03 }));
      puff.position.set(spot.x, by + 0.12 + i * 0.08, spot.z);
      puff.userData.smokeBase = { x: spot.x, y: by + 0.12 + i * 0.08, z: spot.z, i: idx * 3 + i };
      scene.add(puff);
      animatedObjects.push({ type: "smoke", mesh: puff });
    }
    scene.add(fire);
  });

  // ── Additional small islands — each with a unique shape ──

  // Island 4 — Long narrow sandbar/spit, west
  const di4 = new THREE.Group();
  di4.position.set(-45, -0.3, -5);
  // Elongated sandbar (stretched cylinder)
  const di4Bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.8, 0.2, 8), mt(0xd8c890, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.12 }));
  di4Bar.scale.set(4.0, 1.0, 1.0); di4Bar.position.y = 0.06; di4.add(di4Bar);
  // Slight green tuft at center
  const di4Tuft = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), mt(0x7a9a60, { emissive: 0x304020, emissiveIntensity: 0.12 }));
  di4Tuft.position.y = 0.15; di4Tuft.scale.set(1.2, 0.6, 0.8); di4.add(di4Tuft);
  // One leaning palm at the end
  const di4Trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.7, 4), mt(0x8a7050));
  di4Trunk.position.set(1.5, 0.35, 0); di4Trunk.rotation.z = -0.4; di4.add(di4Trunk);
  const di4Frond = new THREE.Mesh(new THREE.SphereGeometry(0.22, 5, 3), mt(0x5a8a4a));
  di4Frond.position.set(1.7, 0.75, 0); di4Frond.scale.y = 0.35; di4.add(di4Frond);
  // Driftwood log
  const di4Drift = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 4), mt(0x9a8a6a));
  di4Drift.position.set(-0.8, 0.12, 0.3); di4Drift.rotation.z = Math.PI / 2; di4Drift.rotation.y = 0.4; di4.add(di4Drift);
  // Tiny tide pools (translucent circles)
  for (const [tx, tz] of [[0.5, 0.3], [-1.2, -0.2]]) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.12, 8),
      new THREE.MeshBasicMaterial({ color: 0x60b0c0, transparent: true, opacity: 0.4 }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(tx, 0.17, tz); di4.add(pool);
  }
  scene.add(di4);

  // Island 5 — Dramatic volcanic peak with lava glow, far NW
  const di5 = new THREE.Group();
  di5.position.set(-38, -0.3, -38);
  // Wide rocky base
  const di5Base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.5, 0.5, 12), mt(0xc0b8a8, { roughness: 0.95, emissive: 0x605850, emissiveIntensity: 0.12 }));
  di5Base.position.y = 0.15; di5.add(di5Base);
  // Mid cone — dark volcanic rock
  const di5Mid = new THREE.Mesh(
    new THREE.ConeGeometry(1.4, 1.5, 10), mt(0xc0b8a8, { emissive: 0x605850, emissiveIntensity: 0.12 }));
  di5Mid.position.y = 1.0; di5.add(di5Mid);
  // Summit cone — lighter ash/rock
  const di5Peak = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 0.8, 8), mt(0xc0b8a8, { emissive: 0x605850, emissiveIntensity: 0.12 }));
  di5Peak.position.y = 1.8; di5.add(di5Peak);
  // Crater rim (torus at top)
  const di5Crater = new THREE.Mesh(
    new THREE.TorusGeometry(0.25, 0.06, 4, 8), mt(0xb8b0a0, { emissive: 0x504030, emissiveIntensity: 0.12 }));
  di5Crater.rotation.x = -Math.PI / 2; di5Crater.position.y = 2.15; di5.add(di5Crater);
  // Lava glow inside crater
  const di5Lava = new THREE.Mesh(new THREE.CircleGeometry(0.2, 8),
    mt(0xff4400, { emissive: 0xff2200, emissiveIntensity: 0.6 }));
  di5Lava.rotation.x = -Math.PI / 2; di5Lava.position.y = 2.1; di5.add(di5Lava);
  animatedObjects.push({ type: "blink", mesh: di5Lava, speed: 0.8, phase: 3 });
  // Lava streaks down one side
  const di5Streak = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.8, 0.04),
    mt(0xff3300, { emissive: 0xff2200, emissiveIntensity: 0.3, transparent: true, opacity: 0.5 }));
  di5Streak.position.set(0.3, 1.2, 0.4); di5Streak.rotation.z = 0.25; di5.add(di5Streak);
  // Smoke puffs from crater
  for (let i = 0; i < 4; i++) {
    const vPuff = new THREE.Mesh(
      new THREE.SphereGeometry(0.1 + i * 0.05, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xa0a0a0, transparent: true, opacity: 0.12 - i * 0.02 }));
    vPuff.position.set(-38, 2.4 + i * 0.35, -38);
    vPuff.userData.smokeBase = { x: -38, y: 2.4 + i * 0.35, z: -38, i: 20 + i };
    scene.add(vPuff);
    animatedObjects.push({ type: "smoke", mesh: vPuff });
  }
  scene.add(di5);

  // Island 6 — Tall rocky sea stack / cliff with lighthouse, east
  const di6 = new THREE.Group();
  di6.position.set(32, -0.3, -18);
  // Tall cliff base — narrow and tall
  const di6Cliff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 1.4, 1.8, 12), mt(0xc0b8a8, { roughness: 0.95, emissive: 0x605850, emissiveIntensity: 0.12 }));
  di6Cliff.position.y = 0.7; di6.add(di6Cliff);
  // Flat grassy top
  const di6Top = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 0.9, 0.12, 8), mt(0x6a9a50, { emissive: 0x304020, emissiveIntensity: 0.15 }));
  di6Top.position.y = 1.65; di6.add(di6Top);
  // Rocky outcrops at base (sea-level rocks)
  for (let i = 0; i < 5; i++) {
    const ra = i * Math.PI * 2 / 5 + 0.3;
    const rr = 1.2 + Math.random() * 0.4;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.15, 0), mt(0xb0a898, { emissive: 0x504030, emissiveIntensity: 0.12 }));
    rock.position.set(Math.cos(ra) * rr, -0.05 + Math.random() * 0.1, Math.sin(ra) * rr);
    rock.scale.y = 0.5 + Math.random() * 0.3; di6.add(rock);
  }
  // Lighthouse on top
  const lhTower = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.8, 6), mt(CREAM));
  lhTower.position.y = 2.1; di6.add(lhTower);
  const lhStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.15, 6), mt(0xc04040));
  lhStripe.position.y = 1.9; di6.add(lhStripe);
  const lhTop = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.12, 6), mt(0xc04040));
  lhTop.position.y = 2.55; di6.add(lhTop);
  const lhGlow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4),
    mt(0xffee80, { emissive: 0xffee80, emissiveIntensity: 0.8 }));
  lhGlow.position.y = 2.62; di6.add(lhGlow);
  animatedObjects.push({ type: "blink", mesh: lhGlow, speed: 2.5, phase: 0 });
  // Tiny stairs carved into cliff side
  for (let s = 0; s < 6; s++) {
    const stair = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.06), mt(0x9a9080));
    const sa = 0.5 + s * 0.2;
    stair.position.set(Math.cos(sa) * 0.85, 0.15 + s * 0.25, Math.sin(sa) * 0.85);
    stair.rotation.y = -sa; di6.add(stair);
  }
  scene.add(di6);

  // Island 7 — Crescent atoll with turquoise lagoon, far south-east
  const di7 = new THREE.Group();
  di7.position.set(32, -0.3, 38);
  // Shallow turquoise lagoon center
  const di7Lagoon = new THREE.Mesh(
    new THREE.CircleGeometry(1.8, 16),
    new THREE.MeshBasicMaterial({ color: 0x40c8c0, transparent: true, opacity: 0.4 }));
  di7Lagoon.rotation.x = -Math.PI / 2; di7Lagoon.position.y = -0.02; di7.add(di7Lagoon);
  // Crescent-shaped land (torus segment)
  const di7Geo = new THREE.TorusGeometry(2.0, 0.5, 6, 16, Math.PI * 1.4);
  // Flatten it into an island shape
  const di7P = di7Geo.attributes.position;
  for (let i = 0; i < di7P.count; i++) {
    di7P.setY(i, di7P.getY(i) * 0.3);
  }
  di7Geo.computeVertexNormals();
  const di7Land = new THREE.Mesh(di7Geo, mt(0x90b070, { roughness: 0.9, emissive: 0x304020, emissiveIntensity: 0.12 }));
  di7Land.rotation.x = -Math.PI / 2; di7Land.position.y = 0.15; di7.add(di7Land);
  // Sandy beach rim on outer edge
  const di7Beach = new THREE.Mesh(
    new THREE.TorusGeometry(2.0, 0.6, 4, 16, Math.PI * 1.4),
    mt(0xd8c890, { roughness: 0.95 }));
  const di7BP = di7Beach.geometry.attributes.position;
  for (let i = 0; i < di7BP.count; i++) { di7BP.setY(i, di7BP.getY(i) * 0.15); }
  di7Beach.geometry.computeVertexNormals();
  di7Beach.rotation.x = -Math.PI / 2; di7Beach.position.y = 0.06; di7.add(di7Beach);
  // Palm trees along the crescent
  for (let i = 0; i < 6; i++) {
    const pa = -Math.PI * 0.65 + i * (Math.PI * 1.3 / 5);
    const px = Math.cos(pa) * 2.0, pz = Math.sin(pa) * 2.0;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.6, 4), mt(0x8a7050));
    trunk.position.set(px, 0.45, pz);
    trunk.rotation.z = (Math.random() - 0.5) * 0.3;
    trunk.rotation.x = (Math.random() - 0.5) * 0.2;
    di7.add(trunk);
    const frond = new THREE.Mesh(new THREE.SphereGeometry(0.2, 5, 3), mt(0x5a8a4a));
    frond.position.set(px, 0.78, pz); frond.scale.y = 0.35; di7.add(frond);
  }
  // Small dock/pier extending into lagoon
  const di7Pier = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.1), mt(0x9a8060));
  di7Pier.position.set(0, 0.12, -0.8); di7.add(di7Pier);
  // Stilts under pier
  for (const sx of [-0.3, 0, 0.3]) {
    const pStilt = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 3), mt(0x8a7050));
    pStilt.position.set(sx, -0.02, -0.8); di7.add(pStilt);
  }
  // Tiny boat moored at pier
  const di7Boat = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.08), mt(0xc04040));
  di7Boat.position.set(0.45, 0.06, -0.9); di7Boat.rotation.y = 0.2; di7.add(di7Boat);
  scene.add(di7);

  // Island 8 — Maldives resort island
  const di8 = new THREE.Group();
  di8.position.set(24, -0.3, 26);

  // Turquoise shallow water around island
  const mShallows = new THREE.Mesh(
    new THREE.CylinderGeometry(4.5, 5.0, 0.06, 16),
    new THREE.MeshBasicMaterial({ color: 0x48d8d0, transparent: true, opacity: 0.35 }));
  mShallows.position.y = -0.02;
  di8.add(mShallows);

  // Main island — flat elongated sandy land
  const mLand = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 3.2, 0.3, 10), mt(0xf5edd5, { roughness: 0.9, emissive: 0x504030, emissiveIntensity: 0.1 }));
  mLand.position.y = 0.1;
  mLand.scale.set(1.0, 1.0, 0.6);
  di8.add(mLand);

  // White sand beach rim
  const mBeach = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.5, 0.1, 12), mt(0xfaf5ea, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.08 }));
  mBeach.position.y = 0.02;
  mBeach.scale.set(1.0, 1.0, 0.6);
  di8.add(mBeach);

  // Lush green vegetation cover
  const mVeg = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.5, 0.15, 10), mt(0x5a9a50, { roughness: 0.8, emissive: 0x304020, emissiveIntensity: 0.12 }));
  mVeg.position.y = 0.3;
  mVeg.scale.set(1.0, 1.0, 0.55);
  di8.add(mVeg);

  // Palm trees scattered across island
  const mPalms = [
    [0, 0], [0.8, 0.2], [-0.7, 0.3], [0.3, -0.5], [-0.4, -0.3],
    [1.5, 0], [-1.3, 0.1], [0.6, 0.6], [-0.9, -0.4], [1.8, -0.2],
    [-1.7, 0.2], [0, 0.5], [0.4, -0.7],
  ];
  mPalms.forEach(([px, pz]) => {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, 0.9, 4), mt(0x8a7050));
    trunk.position.set(px, 0.7, pz);
    trunk.rotation.z = (Math.random() - 0.5) * 0.35;
    trunk.rotation.x = (Math.random() - 0.5) * 0.15;
    di8.add(trunk);
    const frond = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 5, 3), mt(0x4a8a40));
    frond.position.set(px, 1.2, pz);
    frond.scale.y = 0.35;
    di8.add(frond);
  });

  // Overwater bungalows extending in a curved line from island
  for (let i = 0; i < 6; i++) {
    const t8 = i / 5;
    const ba = -0.4 + t8 * 1.4;
    const bd = 3.8 + i * 0.3;
    const bx = Math.cos(ba) * bd;
    const bz = Math.sin(ba) * bd * 0.6;

    // Jetty plank to previous bungalow
    if (i > 0) {
      const pa = -0.4 + ((i - 1) / 5) * 1.4;
      const pd = 3.8 + (i - 1) * 0.3;
      const px2 = Math.cos(pa) * pd, pz2 = Math.sin(pa) * pd * 0.6;
      const mx = (bx + px2) / 2, mz = (bz + pz2) / 2;
      const ln = Math.sqrt((bx - px2) ** 2 + (bz - pz2) ** 2);
      const ja = Math.atan2(bz - pz2, bx - px2);
      const plnk = new THREE.Mesh(
        new THREE.BoxGeometry(ln, 0.03, 0.12), mt(0x9a8060));
      plnk.position.set(mx, 0.15, mz);
      plnk.rotation.y = -ja;
      di8.add(plnk);
    }

    // Stilts
    [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]].forEach(([sx, sz]) => {
      const stilt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 0.5, 3), mt(0x8a7050));
      stilt.position.set(bx + sx, -0.05, bz + sz);
      di8.add(stilt);
    });
    // Deck
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.04, 0.4), mt(0xb09060));
    deck.position.set(bx, 0.2, bz); deck.rotation.y = ba;
    di8.add(deck);
    // Cabin (white walls)
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.25, 0.32), mt(0xf0e8d8));
    cab.position.set(bx, 0.38, bz); cab.rotation.y = ba;
    di8.add(cab);
    // Thatched roof
    const brf = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.2, 4), mt(0x907040));
    brf.position.set(bx, 0.58, bz);
    brf.rotation.y = ba + Math.PI / 4;
    di8.add(brf);
  }

  // Main jetty connecting island to bungalows
  const mJetty = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.04, 0.15), mt(0x9a8060));
  mJetty.position.set(3.3, 0.15, 0);
  di8.add(mJetty);

  // Small reception building on island
  const mRec = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.3, 0.4), mt(0xf0e8d8));
  mRec.position.set(-1.5, 0.4, 0);
  di8.add(mRec);
  const mRecRoof = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.2, 4), mt(0x907040));
  mRecRoof.position.set(-1.5, 0.62, 0);
  mRecRoof.rotation.y = Math.PI / 4;
  di8.add(mRecRoof);

  // ── Manta ray swimming around island ──
  const manta = new THREE.Group();
  const mantaBody = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.2), mt(0x4a4a5e));
  manta.add(mantaBody);
  // Wings
  for (const ws of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.008, 0.18), mt(0x4a4a5e));
    wing.position.set(ws * 0.25, 0, 0.02); wing.rotation.z = ws * -0.1; manta.add(wing);
  }
  // Belly (white)
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.14), mt(0xf0f0f0));
  belly.position.y = -0.005; manta.add(belly);
  // Tail
  const mantaTail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.2), mt(0x4a4a5e));
  mantaTail.position.set(0, 0, -0.18); manta.add(mantaTail);
  manta.position.set(24, -0.15, 26);
  scene.add(manta);
  animatedObjects.push({
    type: "jetski", mesh: manta,
    cx: 24, cz: 26, radius: 4.5, speed: 0.1, phase: Math.PI * 0.5,
  });

  // ── Hammock between palms ──
  const mHammock = new THREE.Mesh(
    new THREE.PlaneGeometry(0.4, 0.12),
    mt(0xf08030, { side: THREE.DoubleSide, transparent: true, opacity: 0.75 }));
  mHammock.position.set(0.8, 0.35, 0.5); mHammock.rotation.x = -0.15; mHammock.rotation.y = 0.5;
  di8.add(mHammock);
  animatedObjects.push({ type: "bob", mesh: mHammock, speed: 0.5, baseY: 0.35, amp: 0.015, phase: 4 });

  // ── Beach bonfire ──
  const mBonfire = new THREE.Group();
  for (let bs = 0; bs < 5; bs++) {
    const bStone = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3), mt(0x808080));
    const ba = bs * Math.PI * 2 / 5;
    bStone.position.set(Math.cos(ba) * 0.06, 0, Math.sin(ba) * 0.06);
    bStone.scale.y = 0.5; mBonfire.add(bStone);
  }
  const bfFlame = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 5),
    mt(0xff6600, { emissive: 0xff4400, emissiveIntensity: 0.7, transparent: true, opacity: 0.8 }));
  bfFlame.position.y = 0.04; mBonfire.add(bfFlame);
  const bfGlow = new THREE.PointLight(0xff8800, 0.5, 2);
  bfGlow.position.y = 0.06; mBonfire.add(bfGlow);
  animatedObjects.push({ type: "lightFlicker", light: bfGlow, baseIntensity: 0.5, phase: 5 });
  mBonfire.position.set(1.5, 0.22, -0.3);
  di8.add(mBonfire);

  // ── Beach chairs ──
  for (let bc = 0; bc < 2; bc++) {
    const chair = new THREE.Group();
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.005, 0.15), mt(0xf0f0f0));
    chairSeat.position.y = 0.04; chair.add(chairSeat);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.005), mt(0xf0f0f0));
    chairBack.position.set(0, 0.06, -0.07); chairBack.rotation.x = -0.3; chair.add(chairBack);
    for (const lx of [-0.03, 0.03]) {
      const cLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 3), mt(0x8a8a8a));
      cLeg.position.set(lx, 0.02, 0); chair.add(cLeg);
    }
    chair.position.set(1.0 + bc * 0.25, 0.22, 0.3 + bc * 0.15);
    chair.rotation.y = -0.5 + bc * 0.2; di8.add(chair);
  }

  // ── Umbrella ──
  const umbrella = new THREE.Group();
  const umPole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 4), mt(0x8a6a3a));
  umPole.position.y = 0.2; umbrella.add(umPole);
  const umTop = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.06, 8), mt(0xe04040));
  umTop.position.y = 0.4; umbrella.add(umTop);
  umbrella.position.set(1.1, 0.22, 0.2);
  di8.add(umbrella);

  // ── Snorkeler in water ──
  const snorkeler = new THREE.Group();
  const snBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.1), mt(0x2060a0));
  snBody.position.y = 0; snorkeler.add(snBody);
  const snHead = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0xf0c8a0));
  snHead.position.set(0, 0.01, 0.06); snorkeler.add(snHead);
  const snTube = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 3), mt(0x30a0d0));
  snTube.position.set(0.02, 0.03, 0.07); snorkeler.add(snTube);
  // Fins
  for (const fx of [-0.03, 0.03]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.005, 0.06), mt(0x20a0a0));
    fin.position.set(fx, -0.01, -0.08); snorkeler.add(fin);
  }
  snorkeler.position.set(2.5, -0.12, 1.0); snorkeler.rotation.y = 0.8;
  di8.add(snorkeler);

  scene.add(di8);

  // ── Yachts (sleek, modern boats with cabins) ──
  const yachtConfigs = [
    { angle: 0.9, dist: 3.5, rot: 1.5, scale: 2.8, color: 0xf0f0f0 },   // white yacht, NE
    { angle: 2.8, dist: 4.0, rot: 0.3, scale: 2.5, color: 0xe8e8f0 },   // off-white, SE
    { angle: 4.2, dist: 3.0, rot: 2.1, scale: 3.0, color: 0xf5f0e8 },   // cream yacht, SW
    { angle: 5.5, dist: 5.0, rot: 1.0, scale: 2.2, color: 0xe0e8f0 },   // light blue, W
    { angle: 1.8, dist: 6.0, rot: 0.8, scale: 2.0, color: 0xf0f0f0 },   // distant white, N
    { angle: 0.3, dist: 5.5, rot: 2.5, scale: 2.6, color: 0xf0f0f0 },   // white, far NE
    { angle: 3.5, dist: 5.0, rot: 1.8, scale: 2.3, color: 0xe8e0d0 },   // warm cream, S
    { angle: 4.8, dist: 4.5, rot: 0.6, scale: 3.2, color: 0xf8f8ff },   // large white, WSW
    { angle: 5.9, dist: 7.0, rot: 1.2, scale: 1.8, color: 0xe0e8f0 },   // small distant, NW
    { angle: 1.3, dist: 8.0, rot: 0.4, scale: 1.6, color: 0xe8e8e8 },   // tiny far, NNE
    { angle: 2.2, dist: 3.0, rot: 2.8, scale: 2.4, color: 0xf0ece0 },   // near shore, E
    { angle: 3.9, dist: 6.5, rot: 1.4, scale: 2.0, color: 0xf0f5f0 },   // distant, SSW
  ];
  yachtConfigs.forEach((cfg, idx) => {
    const edgeR = getIslandRadius(cfg.angle);
    const yd = edgeR + cfg.dist;
    const yx = Math.cos(cfg.angle) * yd, yz = Math.sin(cfg.angle) * yd;
    const yacht = new THREE.Group();
    yacht.position.set(yx, -0.1, yz);
    yacht.rotation.y = cfg.rot;
    yacht.scale.setScalar(cfg.scale);
    // Sleek hull
    const yHull = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.4), mt(cfg.color));
    yHull.position.y = 0.015; yacht.add(yHull);
    // Tapered bow
    const yBow = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), mt(cfg.color));
    yBow.position.set(0, 0.015, 0.25); yBow.rotation.x = Math.PI / 2; yacht.add(yBow);
    // Stern
    const yStern = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.03), mt(cfg.color));
    yStern.position.set(0, 0.02, -0.21); yacht.add(yStern);
    // Cabin / superstructure
    const yCabin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.12), mt(CREAM));
    yCabin.position.set(0, 0.05, -0.04); yacht.add(yCabin);
    // Windshield
    const yWindshield = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.025, 0.005),
      mt(0xa0c8e0, { transparent: true, opacity: 0.5 }));
    yWindshield.position.set(0, 0.06, 0.02); yacht.add(yWindshield);
    // Deck railing (thin line)
    const yRail = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.015, 0.38), mt(METAL));
    for (const side of [-1, 1]) {
      const rail = yRail.clone();
      rail.position.set(side * 0.048, 0.045, 0.02); yacht.add(rail);
    }
    // Mast (shorter, modern)
    const yMast = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.15, 3), mt(METAL));
    yMast.position.set(0, 0.1, 0.08); yacht.add(yMast);
    scene.add(yacht);
    animatedObjects.push({
      type: "bob", mesh: yacht, speed: 0.35 + idx * 0.05,
      baseY: -0.1, amp: 0.014, phase: idx * 2.3,
    });
  });

  // ── Occasional airplane (orbiting high above the scene) ──
  const airplane = new THREE.Group();
  airplane.position.set(0, 12, 0);
  // Fuselage
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.7, 5),
    mt(0xf0f0f0));
  fuselage.rotation.x = Math.PI / 2; airplane.add(fuselage);
  // Wings
  const wingGeo = new THREE.BoxGeometry(1.0, 0.02, 0.15);
  const wing = new THREE.Mesh(wingGeo, mt(0xe8e8e8));
  wing.position.set(0, 0, 0.05); airplane.add(wing);
  // Tail vertical
  const tailV = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.1), mt(0xe0e0e0));
  tailV.position.set(0, 0.07, -0.32); airplane.add(tailV);
  // Tail horizontal
  const tailH = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.015, 0.08), mt(0xe0e0e0));
  tailH.position.set(0, 0, -0.32); airplane.add(tailH);
  // Engine nacelles
  for (const side of [-0.25, 0.25]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.12, 5),
      mt(0xd0d0d0));
    engine.rotation.x = Math.PI / 2;
    engine.position.set(side, -0.03, 0.1); airplane.add(engine);
  }
  // Red accent on tail
  const tailAccent = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.06, 0.04), mt(0xc04040));
  tailAccent.position.set(0, 0.1, -0.32); airplane.add(tailAccent);
  airplane.scale.setScalar(0.5);
  scene.add(airplane);
  // Airplane orbits very slowly at high altitude with gentle banking
  animatedObjects.push({
    type: "airplane", mesh: airplane,
    radius: 30, baseY: 12, speed: 0.06, phase: 0,
  });

  // ── Submarine (patrols deep water between islands) ──
  const sub = new THREE.Group();
  const HULL_C = 0x7a8a8a, ACCENT_C = 0xc04040, METAL_C = 0x6a6a6a;

  // Main hull — elongated cylinder
  const subHull = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.18, 1.0, 6, 12), mt(HULL_C));
  subHull.rotation.z = Math.PI / 2;
  subHull.castShadow = true; sub.add(subHull);

  // Conning tower (sail)
  const sail = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.2, 0.25), mt(HULL_C));
  sail.position.set(0.05, 0.22, 0); sub.add(sail);

  // Periscope
  const periscope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.18, 4), mt(METAL_C));
  periscope.position.set(0.05, 0.4, 0); sub.add(periscope);
  const periTop = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.015, 0.025), mt(METAL_C));
  periTop.position.set(0.05, 0.49, 0); sub.add(periTop);

  // Rudder (vertical fin at stern)
  const rudder = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.18, 0.08), mt(HULL_C));
  rudder.position.set(-0.62, 0.05, 0); sub.add(rudder);

  // Horizontal tail fins (hydroplanes)
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.04, 0.16), mt(HULL_C));
    fin.position.set(-0.58, 0, side * 0.02); sub.add(fin);
  }

  // Propeller
  const prop = new THREE.Group();
  prop.position.set(-0.68, 0, 0);
  for (let b = 0; b < 4; b++) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.08, 0.02), mt(METAL_C));
    blade.rotation.x = (b / 4) * Math.PI * 2;
    blade.position.y = Math.sin(blade.rotation.x) * 0.04;
    blade.position.z = Math.cos(blade.rotation.x) * 0.04;
    prop.add(blade);
  }
  sub.add(prop);
  animatedObjects.push({ type: "spin", mesh: prop, speed: 3.0 });

  // Red accent stripe along hull
  const stripe2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.02, 0.38), mt(ACCENT_C));
  stripe2.position.set(0, -0.06, 0); sub.add(stripe2);

  // Portholes
  for (let p = 0; p < 4; p++) {
    const porthole = new THREE.Mesh(
      new THREE.CircleGeometry(0.03, 6),
      mt(0xa0c8e0, { transparent: true, opacity: 0.5 }));
    porthole.position.set(0.2 - p * 0.18, 0.02, 0.181);
    sub.add(porthole);
    const ph2 = porthole.clone();
    ph2.position.z = -0.181; ph2.rotation.y = Math.PI;
    sub.add(ph2);
  }

  sub.scale.setScalar(1.8);
  sub.position.set(-12, -0.5, 15);
  scene.add(sub);

  animatedObjects.push({
    type: "submarine", mesh: sub,
    radius: 16, cx: 2, cz: 8, speed: 0.04, phase: 1.5, baseY: -0.5,
  });
}


/* =========================================================
   World Objects - sea stacks, water features, air traffic,
   buoys, creatures to fill the empty ocean and sky
   ========================================================= */

function createWorldObjects() {
  // Sea stacks in open water
  const seaStackConfigs = [
    { x: 12, z: 15, h: 1.8, r: 0.4, color: 0xc0b8a8 },
    { x: -8, z: 18, h: 2.5, r: 0.6, color: 0xc0b8a8 },
    { x: 25, z: -15, h: 1.2, r: 0.35, color: 0xc0b8a8 },
    { x: -25, z: -18, h: 3.2, r: 0.7, color: 0xc0b8a8 },
    { x: 5, z: 22, h: 0.8, r: 0.25, color: 0xc0b8a8 },
    { x: -30, z: 8, h: 1.5, r: 0.45, color: 0xc0b8a8 },
    { x: 28, z: 5, h: 1.0, r: 0.3, color: 0xc0b8a8 },
  ];
  seaStackConfigs.forEach(cfg => {
    const stack = new THREE.Group();
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(cfg.r * 0.6, cfg.r, cfg.h, 12),
      mt(cfg.color, { roughness: 0.95, emissive: 0x605850, emissiveIntensity: 0.15 }));
    col.position.y = cfg.h / 2 - 0.15; col.castShadow = true; stack.add(col);
    const cap = new THREE.Mesh(
      new THREE.DodecahedronGeometry(cfg.r * 0.7, 0), mt(cfg.color, { emissive: 0x605850, emissiveIntensity: 0.15 }));
    cap.position.y = cfg.h - 0.1; cap.scale.y = 0.4; stack.add(cap);
    if (Math.random() > 0.5) {
      const tuft = new THREE.Mesh(
        new THREE.SphereGeometry(cfg.r * 0.5, 4, 3, 0, Math.PI * 2, 0, Math.PI / 2),
        mt(0x5a8a4a));
      tuft.position.y = cfg.h; stack.add(tuft);
    }
    stack.position.set(cfg.x, -0.25, cfg.z);
    scene.add(stack);
  });

  // Natural rock arch
  const archGroup = new THREE.Group();
  const archL = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.5, 2.0, 8), mt(0xc0b8a8, { roughness: 0.95, emissive: 0x605850, emissiveIntensity: 0.15 }));
  archL.position.set(-0.8, 0.7, 0); archGroup.add(archL);
  const archR = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.45, 1.8, 8), mt(0xc0b8a8, { emissive: 0x605850, emissiveIntensity: 0.15 }));
  archR.position.set(0.8, 0.65, 0); archGroup.add(archR);
  const archSpan = new THREE.Mesh(
    new THREE.TorusGeometry(0.8, 0.2, 6, 8, Math.PI), mt(0x7a7068));
  archSpan.position.y = 1.5; archSpan.rotation.z = Math.PI; archGroup.add(archSpan);
  archGroup.position.set(-15, -0.3, 12);
  archGroup.rotation.y = 0.8;
  scene.add(archGroup);

  // Large cargo ship (far distance)
  const cargo = new THREE.Group();
  const cargoHull = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 2.5), mt(0x8898a8));
  cargoHull.position.y = 0.05; cargo.add(cargoHull);
  const cargoDeck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 2.2), mt(0x8a4030));
  cargoDeck.position.y = 0.17; cargo.add(cargoDeck);
  const containerColors = [0xc04040, 0x4080c0, 0x40a040, 0xe0c040, 0xf0f0f0];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const cont = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.25),
        mt(containerColors[(r * 4 + c) % 5]));
      cont.position.set(-0.1 + r * 0.2, 0.27 + r * 0.1, -0.6 + c * 0.4);
      cargo.add(cont);
    }
  }
  const cBridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), mt(0xf0f0f0));
  cBridge.position.set(0, 0.33, -0.9); cargo.add(cBridge);
  const cFunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.15, 4), mt(0xc04040));
  cFunnel.position.set(0, 0.5, -0.85); cargo.add(cFunnel);
  cargo.position.set(-32, -0.12, 15);
  cargo.rotation.y = 0.6;
  cargo.scale.setScalar(2.5);
  scene.add(cargo);
  animatedObjects.push({ type: "bob", mesh: cargo, speed: 0.2, baseY: -0.12, amp: 0.03, phase: 0 });

  // Shipwreck half-submerged on a reef
  const wreck = new THREE.Group();
  const wHull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 1.2), mt(0x9a8a7a));
  wHull.position.y = -0.02; wHull.rotation.z = 0.25; wreck.add(wHull);
  const wMast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.8, 4), mt(0x7a6a5a));
  wMast.position.set(0, 0.3, 0.1); wMast.rotation.z = -0.4; wreck.add(wMast);
  wreck.position.set(28, -0.2, -8);
  wreck.rotation.y = 1.2;
  scene.add(wreck);

  // Channel marker buoys (red/green pairs)
  const buoyConfigs = [
    { x: 8, z: 8, color: 0xc04040 }, { x: 9.5, z: 8.5, color: 0x40a040 },
    { x: -10, z: 5, color: 0xc04040 }, { x: -11, z: 6, color: 0x40a040 },
    { x: 15, z: -8, color: 0xc04040 }, { x: 16.5, z: -7.5, color: 0x40a040 },
    { x: -5, z: -12, color: 0xc04040 }, { x: -3.5, z: -12.5, color: 0x40a040 },
  ];
  buoyConfigs.forEach((b, i) => {
    const buoy = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 6), mt(b.color));
    body.position.y = 0.05; buoy.add(body);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 4), mt(b.color));
    top.position.y = 0.18; buoy.add(top);
    buoy.position.set(b.x, -0.15, b.z);
    scene.add(buoy);
    animatedObjects.push({ type: "bob", mesh: buoy, speed: 0.6 + i * 0.1, baseY: -0.15, amp: 0.04, phase: i * 1.2 });
  });

  // Whale shadow under the surface
  const whale = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0x1a2030, transparent: true, opacity: 0.15 }));
  whale.scale.set(1, 0.15, 2.5);
  whale.position.set(20, -0.35, 20);
  scene.add(whale);
  animatedObjects.push({
    type: "orbit", mesh: whale,
    cx: 15, cz: 20, radius: 8, speed: 0.03, phase: 0, baseY: -0.35,
  });

  // Bird flocks (V-formation)
  for (let f = 0; f < 3; f++) {
    const flock = new THREE.Group();
    const flockSize = 5 + Math.floor(Math.random() * 4);
    for (let b = 0; b < flockSize; b++) {
      const side = b % 2 === 0 ? 1 : -1;
      const row = Math.ceil(b / 2);
      const bird = new THREE.Mesh(
        new THREE.PlaneGeometry(0.06, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x3a3a3a, side: THREE.DoubleSide }));
      bird.position.set(side * row * 0.12, -row * 0.02, -row * 0.15);
      bird.rotation.x = -0.3;
      flock.add(bird);
    }
    const fx = -15 + f * 18, fz = -10 + f * 15;
    flock.position.set(fx, 6 + f * 2, fz);
    scene.add(flock);
    animatedObjects.push({
      type: "orbit", mesh: flock,
      cx: fx, cz: fz, radius: 12 + f * 3, speed: 0.06 + f * 0.01,
      phase: f * 2, baseY: 6 + f * 2,
    });
  }

  // Seaplane on the water
  const seaplane = new THREE.Group();
  const spBody = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.5, 5), mt(0xf0f0f0));
  spBody.rotation.z = Math.PI / 2; seaplane.add(spBody);
  const spWing = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.01, 0.12), mt(0xf0f0f0));
  spWing.position.y = 0.02; seaplane.add(spWing);
  for (const px of [-0.12, 0.12]) {
    const pontoon = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.35, 4), mt(0xd0d0d0));
    pontoon.rotation.z = Math.PI / 2; pontoon.position.set(px, -0.06, 0); seaplane.add(pontoon);
  }
  const spTail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.01), mt(0xc04040));
  spTail.position.set(0, 0.04, -0.22); seaplane.add(spTail);
  seaplane.position.set(-22, -0.1, 10);
  seaplane.rotation.y = 1.0;
  seaplane.scale.setScalar(1.5);
  scene.add(seaplane);
  animatedObjects.push({ type: "bob", mesh: seaplane, speed: 0.3, baseY: -0.1, amp: 0.02, phase: 2 });

  // Airship / zeppelin
  const zeppelin = new THREE.Group();
  const zBody = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mt(0xe0ddd5));
  zBody.scale.set(1, 0.4, 2.5); zeppelin.add(zBody);
  const zGondola = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.3), mt(0x9a8a7a));
  zGondola.position.y = -0.22; zeppelin.add(zGondola);
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.15, 0.2), mt(0xc8c4b8));
    fin.position.set(side * 0.08, 0, -0.5); zeppelin.add(fin);
    const hFin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.2), mt(0xc8c4b8));
    hFin.position.set(0, side * 0.08, -0.5); zeppelin.add(hFin);
  }
  zeppelin.position.set(10, 12, -15);
  zeppelin.scale.setScalar(2.0);
  scene.add(zeppelin);
  animatedObjects.push({
    type: "orbit", mesh: zeppelin,
    cx: 0, cz: 0, radius: 25, speed: 0.015, phase: 1.5, baseY: 12,
  });

  // Fishing boat with nets
  const fisher = new THREE.Group();
  const fHull = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.35), mt(0x4a7ab0));
  fHull.position.y = 0.01; fisher.add(fHull);
  const fCabin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), mt(0xf0e8d0));
  fCabin.position.set(0, 0.06, -0.1); fisher.add(fCabin);
  fisher.position.set(-14, -0.12, 2);
  fisher.rotation.y = 0.8;
  scene.add(fisher);
  animatedObjects.push({ type: "bob", mesh: fisher, speed: 0.4, baseY: -0.12, amp: 0.025, phase: 3 });

  // Kayakers near shoreline
  for (let k = 0; k < 3; k++) {
    const kayak = new THREE.Group();
    const kBody = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.2, 4),
      mt([0xe04040, 0x40a0e0, 0xe0a040][k]));
    kBody.rotation.z = Math.PI / 2; kayak.add(kBody);
    const kHead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), mt(0xf0c8a0));
    kHead.position.set(0, 0.025, 0); kayak.add(kHead);
    const ka = 0.5 + k * 1.2;
    const kr = 13.5 + k * 0.5;
    kayak.position.set(Math.cos(ka) * kr, -0.13, Math.sin(ka) * kr);
    kayak.rotation.y = ka + Math.PI / 2;
    scene.add(kayak);
    animatedObjects.push({ type: "bob", mesh: kayak, speed: 0.5 + k * 0.1, baseY: -0.13, amp: 0.02, phase: k * 2 });
  }

  // Crab pot floats
  for (let c = 0; c < 8; c++) {
    const fl = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 4, 3),
      mt([0xe04040, 0xf0a040, 0xf0f0f0, 0x40a0e0][c % 4]));
    const ca = Math.random() * Math.PI * 2;
    const cd = 14 + Math.random() * 15;
    fl.position.set(Math.cos(ca) * cd, -0.18, Math.sin(ca) * cd);
    scene.add(fl);
    animatedObjects.push({ type: "bob", mesh: fl, speed: 0.7 + c * 0.05, baseY: -0.18, amp: 0.03, phase: c });
  }

  // Sailing junk with battened sails
  const junk = new THREE.Group();
  const jHull = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 0.5), mt(0x6a4a2a));
  jHull.position.y = 0; junk.add(jHull);
  for (let s = 0; s < 2; s++) {
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.25),
      new THREE.MeshBasicMaterial({ color: 0xc8603a, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    sail.position.set(0, 0.16, 0.1 - s * 0.2);
    sail.rotation.y = 0.15;
    junk.add(sail);
  }
  const jMast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.4, 3), mt(0x9a8a7a));
  jMast.position.set(0, 0.2, 0.1); junk.add(jMast);
  junk.position.set(25, -0.1, 18);
  junk.rotation.y = -0.5;
  junk.scale.setScalar(1.8);
  scene.add(junk);
  animatedObjects.push({ type: "bob", mesh: junk, speed: 0.25, baseY: -0.1, amp: 0.03, phase: 1 });
}

/* ═══════════════════════════════════════════════════════════
   Adjacent Island — connected forested island with lighthouse
   ═══════════════════════════════════════════════════════════ */

function createAdjacentIsland() {
  const ISL_X = -18, ISL_Z = -6; // NW of main island
  const adj = new THREE.Group();
  adj.position.set(ISL_X, 0, ISL_Z);

  // ── Catalina-style elongated island — narrow, hilly, NW-SE orientation ──
  // Main landmass: stretched ellipse (long axis ~10, short ~3.5)
  const landGeo = new THREE.CylinderGeometry(1, 1, 0.6, 16);
  // Stretch into ellipse shape
  const lPos = landGeo.attributes.position;
  for (let i = 0; i < lPos.count; i++) {
    const x = lPos.getX(i), z = lPos.getZ(i);
    lPos.setX(i, x * 5.5); // long axis
    lPos.setZ(i, z * 2.2);  // narrow
  }
  landGeo.computeVertexNormals();
  const land = new THREE.Mesh(landGeo, mt(0x8a9a6a, { roughness: 0.9, emissive: 0x304020, emissiveIntensity: 0.18 }));
  land.position.y = -0.05;
  land.rotation.y = 0.4; // angle NW-SE
  adj.add(land);

  // ── Mountain spine (Catalina's rugged ridge) ──
  // Main peak — Mt Orizaba equivalent
  const peak1 = new THREE.Mesh(
    new THREE.ConeGeometry(1.8, 2.0, 6), mt(0xa8b898, { emissive: 0x405030, emissiveIntensity: 0.18 }));
  peak1.position.set(0.5, 0.8, 0); peak1.castShadow = true; adj.add(peak1);
  // Secondary peak
  const peak2 = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 1.4, 5), mt(0x98a888, { emissive: 0x405030, emissiveIntensity: 0.18 }));
  peak2.position.set(-2, 0.5, 0.3); peak2.castShadow = true; adj.add(peak2);
  // Ridge connecting peaks
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(4.5, 0.6, 1.2), mt(0x98a888, { emissive: 0x405030, emissiveIntensity: 0.18 }));
  ridge.position.set(-0.5, 0.3, 0.1); ridge.rotation.y = 0.15; adj.add(ridge);
  // Rocky outcrops along spine
  for (let i = 0; i < 5; i++) {
    const rx = -3 + i * 1.5 + (Math.random() - 0.5) * 0.5;
    const rz = (Math.random() - 0.5) * 1.0;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.3 + Math.random() * 0.3, 0), mt(0xa09880, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.12 }));
    rock.position.set(rx, 0.4 + Math.random() * 0.3, rz);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.y = 0.6 + Math.random() * 0.4;
    adj.add(rock);
  }

  // ── Steep coastal cliffs (south face) ──
  const cliff = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.8, 0.4), mt(0x908070, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.15 }));
  cliff.position.set(0, 0.2, -1.5); cliff.rotation.y = 0.4; adj.add(cliff);

  // ── Beach areas (only on sheltered north side, like Avalon Bay) ──
  const beachGeo = new THREE.CylinderGeometry(1, 1, 0.1, 12);
  const bchPos = beachGeo.attributes.position;
  for (let i = 0; i < bchPos.count; i++) {
    bchPos.setX(i, bchPos.getX(i) * 5.8);
    bchPos.setZ(i, bchPos.getZ(i) * 2.5);
  }
  beachGeo.computeVertexNormals();
  const beach = new THREE.Mesh(beachGeo, mt(0xd8cca0, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.08 }));
  beach.position.y = -0.3; beach.rotation.y = 0.4; adj.add(beach);

  // ── Vegetation — mixed chaparral and trees (Catalina-style, not dense forest) ──
  // Scattered trees — more on north-facing slopes, sparse on south
  for (let i = 0; i < 25; i++) {
    const tx = -4 + Math.random() * 8;
    const tz = -0.5 + Math.random() * 2.0; // mostly north side
    // Skip lighthouse area and cliffs
    if (tx > 3 && Math.abs(tz) < 1.5) continue;
    if (tz < -1.2) continue;
    const treeH = 0.25 + Math.random() * 0.4;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.04, treeH, 4), mt(TRUNK));
    trunk.position.set(tx, treeH / 2 + 0.3, tz); adj.add(trunk);
    // Catalina has oaks and ironwood — use irregular crowns
    const crownR = 0.15 + Math.random() * 0.18;
    const crown = new THREE.Mesh(
      new THREE.DodecahedronGeometry(crownR, 0),
      mt(i % 4 === 0 ? GREEN_D : i % 3 === 0 ? GREEN_VD : GREEN_L));
    crown.position.set(tx, treeH + 0.3 + crownR * 0.4, tz);
    crown.scale.set(1 + Math.random() * 0.3, 0.7 + Math.random() * 0.3, 1 + Math.random() * 0.3);
    crown.castShadow = true; adj.add(crown);
  }
  // Low scrub/chaparral covering hillsides
  for (let i = 0; i < 20; i++) {
    const sx = -3.5 + Math.random() * 7;
    const sz = -1.0 + Math.random() * 2.5;
    const scrub = new THREE.Mesh(
      new THREE.SphereGeometry(0.12 + Math.random() * 0.1, 4, 3),
      mt(i % 2 === 0 ? 0x6a7a4a : 0x7a8a5a));
    scrub.position.set(sx, 0.3 + Math.random() * 0.2, sz);
    scrub.scale.y = 0.4; adj.add(scrub);
  }

  // ── Lighthouse (prominent, on eastern edge) ──
  const lhGroup = new THREE.Group();
  lhGroup.position.set(2.5, 0.25, -0.5);

  const lhBase = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.4, 8), mt(STONE));
  lhBase.position.y = 0.2; lhBase.castShadow = true; lhGroup.add(lhBase);

  const lhTower = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.4, 8), mt(CREAM));
  lhTower.position.y = 1.1; lhTower.castShadow = true; lhGroup.add(lhTower);

  // Red stripe bands
  for (let i = 0; i < 3; i++) {
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.22 + (2-i)*0.015, 0.24 + (2-i)*0.015, 0.08, 8),
      mt(0xc04040));
    stripe.position.y = 0.6 + i * 0.4; lhGroup.add(stripe);
  }

  // Lantern room
  const lhRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.25, 8),
    mt(0x666666));
  lhRoom.position.y = 1.85; lhGroup.add(lhRoom);

  // Glass windows (emissive for glow)
  const lhGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.2, 0.2, 8),
    mt(0xffee80, { emissive: 0xffee80, emissiveIntensity: 0.6, transparent: true, opacity: 0.7 }));
  lhGlass.position.y = 1.85; lhGroup.add(lhGlass);

  // Dome roof
  const lhDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mt(0x505050));
  lhDome.position.y = 1.98; lhGroup.add(lhDome);

  // Light beacon (bright emissive)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4),
    mt(0xffffcc, { emissive: 0xffffaa, emissiveIntensity: 2.0 }));
  beacon.position.y = 1.88; lhGroup.add(beacon);

  // Lighthouse point light
  const lhLight = new THREE.PointLight(0xffee80, 1.0, 15);
  lhLight.position.y = 1.9; lhGroup.add(lhLight);

  // Rotating beam — narrow wedge-shaped plane, subtle glow
  const beamShape = new THREE.BufferGeometry();
  const bVerts = new Float32Array([
    0, 0, 0,       // origin at beacon
    6, 0, 0.4,     // far end, wide side
    6, 0, -0.4,    // far end, other side
  ]);
  beamShape.setAttribute('position', new THREE.BufferAttribute(bVerts, 3));
  beamShape.computeVertexNormals();
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffffdd, transparent: true, opacity: 0.06,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const beam = new THREE.Mesh(beamShape, beamMat);
  beam.position.y = 1.88;
  lhGroup.add(beam);
  // Second beam on opposite side
  const beam2 = beam.clone();
  beam2.rotation.y = Math.PI;
  beam2.position.y = 1.88;
  lhGroup.add(beam2);
  // Both rotate together via parent group trick
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 1.88;
  beamPivot.add(beam);
  beam.position.y = 0;
  beamPivot.add(beam2);
  beam2.position.y = 0;
  lhGroup.remove(beam); lhGroup.remove(beam2);
  lhGroup.add(beamPivot);
  animatedObjects.push({ type: "spin", mesh: beamPivot, speed: 0.5, axis: "y" });
  lighthouseBeams.push(beacon, beamPivot, lhLight);

  adj.add(lhGroup);

  // ── Stone path / walkway on the island ──
  for (let i = 0; i < 8; i++) {
    const px = -1.5 + i * 0.5, pz = 0.5 + Math.sin(i * 0.5) * 0.3;
    const pathStone = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.03, 5),
      mt(STONE, { roughness: 0.95 }));
    pathStone.position.set(px, 0.22, pz); adj.add(pathStone);
  }

  // ── Small cottage ──
  const cottage = new THREE.Group();
  cottage.position.set(-1.5, 0.25, 1.5);
  cottage.rotation.y = 0.5;
  const cotWalls = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), mt(WOOD));
  cotWalls.position.y = 0.175; cotWalls.castShadow = true; cottage.add(cotWalls);
  const cotRoof = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.18, 4), mt(WOOD_D));
  cotRoof.position.y = 0.44; cotRoof.rotation.y = Math.PI / 4; cottage.add(cotRoof);
  const cotDoor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.01), mt(CREAM));
  cotDoor.position.set(0, 0.09, 0.205); cottage.add(cotDoor);
  // Lit window
  const cotWin = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.01),
    mt(0xffe8a0, { emissive: 0xffe8a0, emissiveIntensity: 0.5 }));
  cotWin.position.set(0.14, 0.2, 0.205); cottage.add(cotWin);
  // Chimney with smoke
  const cotChim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.06), mt(STONE));
  cotChim.position.set(-0.15, 0.5, -0.1); cottage.add(cotChim);
  adj.add(cottage);

  // Cottage chimney smoke
  for (let i = 0; i < 3; i++) {
    const sx = ISL_X - 1.5 - 0.15, sz = ISL_Z + 1.5 - 0.1;
    const sy = 0.8 + i * 0.1;
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.012 + i * 0.004, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xc0c0c0, transparent: true, opacity: 0.12 - i * 0.03 }));
    puff.position.set(sx, sy, sz);
    puff.userData.smokeBase = { x: sx, y: sy, z: sz, i: 30 + i };
    scene.add(puff);
    animatedObjects.push({ type: "smoke", mesh: puff });
  }

  // ── Deer (2 grazing in forest) ──
  for (let dr = 0; dr < 2; dr++) {
    const deer = new THREE.Group();
    const deerBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.12), mt(0xb08050));
    deerBody.position.y = 0.1; deer.add(deerBody);
    const deerHead = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3), mt(0xb08050));
    deerHead.position.set(0, 0.14, 0.07); deer.add(deerHead);
    // Antlers
    if (dr === 0) {
      for (const ax of [-0.015, 0.015]) {
        const antler = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 3), mt(0x8a6a3a));
        antler.position.set(ax, 0.18, 0.06); antler.rotation.z = ax > 0 ? 0.3 : -0.3; deer.add(antler);
        const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.025, 3), mt(0x8a6a3a));
        tine.position.set(ax * 1.5, 0.2, 0.06); tine.rotation.z = ax > 0 ? 0.8 : -0.8; deer.add(tine);
      }
    }
    // Legs
    for (const lx of [-0.02, 0.02]) {
      for (const lz of [0.04, -0.04]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.005, 0.08, 3), mt(0xb08050));
        leg.position.set(lx, 0.04, lz); deer.add(leg);
      }
    }
    // Tail
    const deerTail = new THREE.Mesh(new THREE.SphereGeometry(0.01, 3, 2), mt(0xf0e8d0));
    deerTail.position.set(0, 0.1, -0.07); deer.add(deerTail);
    deer.position.set(-1.0 + dr * 1.5, 0.2, -0.5 + dr * 0.8);
    deer.rotation.y = dr * 2.0; adj.add(deer);
  }

  // ── Kayak on beach ──
  const kayak = new THREE.Group();
  const kayakHull = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.25), mt(0xe04040));
  kayakHull.position.y = 0.015; kayak.add(kayakHull);
  const kayakBow = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), mt(0xe04040));
  kayakBow.position.set(0, 0.015, 0.15); kayakBow.rotation.x = Math.PI / 2; kayak.add(kayakBow);
  const kayakStern = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.05, 4), mt(0xe04040));
  kayakStern.position.set(0, 0.015, -0.14); kayakStern.rotation.x = -Math.PI / 2; kayak.add(kayakStern);
  // Paddle across kayak
  const paddle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), mt(0x8a6a3a));
  paddle.position.set(0, 0.04, 0); paddle.rotation.z = Math.PI / 2; kayak.add(paddle);
  kayak.position.set(1.8, 0.02, 2.0); kayak.rotation.y = -0.6;
  adj.add(kayak);

  // ── Eagle circling above ──
  const eagle = new THREE.Group();
  const eagleBody = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.08), mt(0x6a5a4a));
  eagle.add(eagleBody);
  const eagleHead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), mt(0xf0f0f0));
  eagleHead.position.set(0, 0.005, 0.05); eagle.add(eagleHead);
  // Wings spread
  for (const ws of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.005, 0.05), mt(0x6a5a4a));
    wing.position.set(ws * 0.08, 0.005, 0); wing.rotation.z = ws * -0.15; eagle.add(wing);
  }
  const eagleTail = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.005, 0.03), mt(0x6a5a4a));
  eagleTail.position.set(0, 0, -0.05); eagle.add(eagleTail);
  eagle.position.set(ISL_X, 3.5, ISL_Z);
  scene.add(eagle);
  animatedObjects.push({
    type: "jetski", mesh: eagle,
    cx: ISL_X, cz: ISL_Z, radius: 2.5, speed: 0.2, phase: 0,
  });
  animatedObjects.push({ type: "bob", mesh: eagle, speed: 0.4, baseY: 3.5, amp: 0.2, phase: 1 });

  // ── Campfire ring with log seats ──
  const campRing = new THREE.Group();
  for (let cs = 0; cs < 6; cs++) {
    const cStone = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0x808080));
    const ca = cs * Math.PI / 3;
    cStone.position.set(Math.cos(ca) * 0.06, 0, Math.sin(ca) * 0.06);
    cStone.scale.y = 0.5; campRing.add(cStone);
  }
  const campFlame = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 5),
    mt(0xff6600, { emissive: 0xff4400, emissiveIntensity: 0.7, transparent: true, opacity: 0.8 }));
  campFlame.position.y = 0.03; campRing.add(campFlame);
  campRing.position.set(0.5, 0.15, 1.5);
  adj.add(campRing);

  scene.add(adj);

  // ── Bridge connecting main island to adjacent island ──
  // Compute bridge endpoints: main island edge → adjacent island edge
  const bridgeAngleToIsland = Math.atan2(ISL_Z, ISL_X);
  const mainEdgeR = getIslandRadius(bridgeAngleToIsland);
  const bStartX = Math.cos(bridgeAngleToIsland) * (mainEdgeR - 1.0);
  const bStartZ = Math.sin(bridgeAngleToIsland) * (mainEdgeR - 1.0);
  const bEndX = ISL_X + Math.cos(bridgeAngleToIsland + Math.PI) * 3.0;
  const bEndZ = ISL_Z + Math.sin(bridgeAngleToIsland + Math.PI) * 3.0;
  // Store endpoints for agent waypoint navigation
  bridgeMainEnd = { x: bStartX, z: bStartZ };
  bridgeIslandEnd = { x: bEndX, z: bEndZ };
  scene.add(buildRopeBridge(bStartX, bStartZ, bEndX, bEndZ));

  // ── Agents on the island (stay local, never walk to main plaza) ──
  const islAgentConfigs = [
    { name: "Scout", body: 0x6ab87a, accent: 0x58a068, roof: 0x4a8a58,
      home: [ISL_X - 1, 0.3, ISL_Z + 1], angle: Math.PI * 0.5 },
    { name: "Ranger", body: 0x8a7060, accent: 0x7a6050, roof: 0x6a5040,
      home: [ISL_X + 1, 0.3, ISL_Z - 0.5], angle: Math.PI * 1.5 },
  ];
  islAgentConfigs.forEach((cfg, i) => {
    const agent = createAgent(cfg, i + 4); // bear (4), rabbit (5)
    agent.useBridge = true;
    scene.add(agent.group);
    agents.push(agent);
  });
}

/* ═══════════════════════════════════════════════════════════
   Greek Island — Santorini/Mykonos style, connected by bridge
   ═══════════════════════════════════════════════════════════ */

function createGreekIsland() {
  const GK_X = 16, GK_Z = 9;
  const gk = new THREE.Group();
  gk.position.set(GK_X, 0, GK_Z);

  // ── Santorini palette ──
  const WHITE = 0xffffff;       // pure white walls
  const WHITE_D = 0xf5f2ec;     // slightly warm white
  const BLUE_DOME = 0x1e56a0;   // deep cobalt blue domes
  const BLUE_ACC = 0x2868b0;    // blue accent (shutters/doors)
  const GROUND = 0xdcd0b8;      // pale warm stone ground
  const GROUND_L = 0xe8e0cc;    // lighter dusty ground
  const CLIFF_DARK = 0xd0c8b5;  // cliff strata dark band (lightened)
  const CLIFF_LIGHT = 0xd5d0c5; // cliff strata light band (pale gray-white)
  const CLIFF_RED = 0xe0c8a8;   // warm volcanic band (lightened)

  // ══════════════════════════════════════════════
  //   CRESCENT TERRAIN — caldera rim shape
  // ══════════════════════════════════════════════
  function getGkR(a) {
    let r = 3.5;
    r += Math.sin(a - 1.2) * 0.8;
    r += Math.cos(a * 2 + 0.5) * 0.25;
    const dNE = Math.abs(((a + Math.PI * 2) % (Math.PI * 2)) - 0.3);
    if (dNE < 0.9) r -= (0.9 - dNE) * 1.8;
    return Math.max(r, 1.5);
  }

  function getGkH(x, z) {
    const d = Math.sqrt(x * x + z * z);
    const a = Math.atan2(z, x);
    const calderaArc = (a > -0.5 && a < 2.2);
    const ridgeH = calderaArc ? 1.8 : 0.4;
    const edgeR = getGkR(a);
    const innerR = edgeR * 0.5;
    const distFromInner = d - innerR;
    let h;
    if (calderaArc) {
      if (d < innerR - 0.3) {
        h = 0.03;
      } else if (d < innerR + 0.3) {
        const cliffT = (d - (innerR - 0.3)) / 0.6;
        h = ridgeH * cliffT * cliffT;
      } else {
        const outerT = Math.max(0, (d - innerR - 0.3) / (edgeR - innerR - 0.3));
        h = ridgeH * Math.max(0, 1 - outerT * 1.2);
      }
    } else {
      const outerT = Math.max(0, (d - innerR) / (edgeR - innerR));
      h = ridgeH * Math.max(0, 1 - outerT * 1.2);
    }
    h += Math.sin(x * 1.2) * 0.04 + Math.cos(z * 0.9) * 0.03;
    return Math.max(h, 0);
  }

  // ── Terrain mesh ──
  const gkRes = 80;
  const gkGeo = new THREE.PlaneGeometry(9, 9, gkRes, gkRes);
  gkGeo.rotateX(-Math.PI / 2);
  const gkPos = gkGeo.attributes.position;
  const gkColors = new Float32Array(gkPos.count * 3);
  const groundC = new THREE.Color(0xe8dcc8);
  const groundLC = new THREE.Color(0xf0ead8);
  const whiteC = new THREE.Color(0xf5f2ec);

  for (let vi = 0; vi < gkPos.count; vi++) {
    const x = gkPos.getX(vi), z = gkPos.getZ(vi);
    const a = Math.atan2(z, x);
    const d = Math.sqrt(x * x + z * z);
    const edgeR = getGkR(a);
    if (d > edgeR + 0.3) {
      gkPos.setY(vi, -0.5);
    } else if (d > edgeR - 0.3) {
      const beachT = smoothstep(edgeR - 0.3, edgeR + 0.3, d);
      gkPos.setY(vi, THREE.MathUtils.lerp(getGkH(x, z) + 0.15, -0.06, beachT));
    } else {
      gkPos.setY(vi, getGkH(x, z) + 0.15);
    }
    const h = gkPos.getY(vi);
    let c;
    if (d > edgeR - 0.5) {
      c = groundLC.clone();
    } else if (h > 1.2) {
      c = whiteC.clone();
      c.lerp(groundLC, Math.random() * 0.2);
    } else {
      const mix = Math.sin(x * 2.5 + z * 1.8) * 0.3 + 0.5;
      c = groundC.clone().lerp(groundLC, mix);
      if (Math.sin(x * 4 + z * 3) > 0.6) c.lerp(whiteC, 0.4);
    }
    gkColors[vi * 3] = c.r; gkColors[vi * 3 + 1] = c.g; gkColors[vi * 3 + 2] = c.b;
  }
  gkGeo.setAttribute("color", new THREE.BufferAttribute(gkColors, 3));
  gkGeo.computeVertexNormals();
  const gkTerrain = new THREE.Mesh(gkGeo, mt(0xffffff, { vertexColors: true, roughness: 0.95, emissive: 0xb0a890, emissiveIntensity: 0.2 }));
  gkTerrain.receiveShadow = true; gk.add(gkTerrain);

  // ── Cliff underside ring ──
  const cSegs = 80;
  const cGeo2 = new THREE.BufferGeometry();
  const cV = [], cN = [], cC2 = [];
  for (let ci = 0; ci < cSegs; ci++) {
    const a0 = (ci / cSegs) * Math.PI * 2;
    const a1 = ((ci + 1) / cSegs) * Math.PI * 2;
    const r0 = getGkR(a0), r1 = getGkR(a1);
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const bulge = 0.1 + Math.sin(a0 * 4) * 0.03;
    const mx0 = x0 + Math.cos(a0) * bulge, mz0 = z0 + Math.sin(a0) * bulge;
    const mx1 = x1 + Math.cos(a1) * bulge, mz1 = z1 + Math.sin(a1) * bulge;
    const sCol = [0.95, 0.92, 0.88], rCol = [0.90, 0.86, 0.80];
    cV.push(x0, -0.1, z0, mx0, -0.28, mz0, x1, -0.1, z1);
    cV.push(x1, -0.1, z1, mx0, -0.28, mz0, mx1, -0.28, mz1);
    for (let t = 0; t < 6; t++) { cC2.push(...sCol); cN.push(Math.cos(a0), 0, Math.sin(a0)); }
    cV.push(mx0, -0.28, mz0, x0 * 0.95, -0.5, z0 * 0.95, mx1, -0.28, mz1);
    cV.push(mx1, -0.28, mz1, x0 * 0.95, -0.5, z0 * 0.95, x1 * 0.95, -0.5, z1 * 0.95);
    for (let t = 0; t < 6; t++) { cC2.push(...rCol); cN.push(Math.cos(a0), -0.3, Math.sin(a0)); }
  }
  cGeo2.setAttribute("position", new THREE.Float32BufferAttribute(cV, 3));
  cGeo2.setAttribute("normal", new THREE.Float32BufferAttribute(cN, 3));
  cGeo2.setAttribute("color", new THREE.Float32BufferAttribute(cC2, 3));
  cGeo2.computeVertexNormals();
  gk.add(new THREE.Mesh(cGeo2, mt(0xffffff, { vertexColors: true, roughness: 1, emissive: 0xb0a890, emissiveIntensity: 0.2 })));

  // ══════════════════════════════════════════════
  //   CALDERA CLIFF WALL — single continuous mesh (no z-fighting)
  // ══════════════════════════════════════════════
  {
    const cliffArcStart = -0.5, cliffArcEnd = 2.2;
    const cliffSegs = 40;
    const bandCount = 4;
    const cliffH = 3.0;
    const bandH = cliffH / bandCount;
    const bandColors = [
      new THREE.Color(CLIFF_LIGHT), new THREE.Color(CLIFF_DARK),
      new THREE.Color(CLIFF_RED), new THREE.Color(CLIFF_LIGHT),
    ];
    const cwV = [], cwN = [], cwC = [];
    for (let ci = 0; ci < cliffSegs; ci++) {
      const t0 = ci / cliffSegs, t1 = (ci + 1) / cliffSegs;
      const a0 = cliffArcStart + t0 * (cliffArcEnd - cliffArcStart);
      const a1 = cliffArcStart + t1 * (cliffArcEnd - cliffArcStart);
      const r0 = getGkR(a0) * 0.43, r1 = getGkR(a1) * 0.43;
      const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
      const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
      const nx = Math.cos((a0 + a1) / 2 + Math.PI);
      const nz = Math.sin((a0 + a1) / 2 + Math.PI);
      for (let band = 0; band < bandCount; band++) {
        const y0 = -0.3 + band * bandH;
        const y1 = y0 + bandH;
        const bc = bandColors[band];
        const cr = bc.r, cg = bc.g, cb = bc.b;
        // Two triangles per quad
        cwV.push(x0, y0, z0, x1, y0, z1, x1, y1, z1);
        cwV.push(x0, y0, z0, x1, y1, z1, x0, y1, z0);
        for (let t = 0; t < 6; t++) {
          cwN.push(nx, 0, nz);
          cwC.push(cr, cg, cb);
        }
      }
    }
    const cwGeo = new THREE.BufferGeometry();
    cwGeo.setAttribute("position", new THREE.Float32BufferAttribute(cwV, 3));
    cwGeo.setAttribute("normal", new THREE.Float32BufferAttribute(cwN, 3));
    cwGeo.setAttribute("color", new THREE.Float32BufferAttribute(cwC, 3));
    cwGeo.computeVertexNormals();
    gk.add(new THREE.Mesh(cwGeo, mt(0xffffff, {
      vertexColors: true, roughness: 0.95,
      emissive: 0xc0b8a0, emissiveIntensity: 0.2,
    })));
  }

  // ══════════════════════════════════════════════
  //   TERRACED VILLAGE — 50 small white buildings on cliff
  // ══════════════════════════════════════════════
  function makeHouse(hx, hz, _hy, hw, hh, hd, rot, barrel) {
    const hy = getGkH(hx, hz) + 0.16;
    hw *= 1.5; hh *= 1.4; hd *= 1.5;
    const house = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(hw, hh, hd),
      mt(WHITE, { roughness: 0.85, emissive: 0xd0c8b8, emissiveIntensity: 0.25 }));
    walls.position.y = hh / 2; walls.castShadow = true; house.add(walls);
    if (barrel) {
      const vault = new THREE.Mesh(
        new THREE.CylinderGeometry(hw * 0.5, hw * 0.5, hd, 8, 1, false, 0, Math.PI),
        mt(WHITE, { roughness: 0.85, emissive: 0xd0c8b8, emissiveIntensity: 0.25 }));
      vault.rotation.z = Math.PI / 2;
      vault.rotation.y = Math.PI / 2;
      vault.position.y = hh; house.add(vault);
    } else {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(hw + 0.01, 0.015, hd + 0.01), mt(WHITE));
      roof.position.y = hh; house.add(roof);
    }
    if (hh > 0.15) {
      for (const wx of [-0.25, 0.25]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.12, hh * 0.18, 0.008), mt(BLUE_ACC));
        win.position.set(hw * wx, hh * 0.6, hd / 2 + 0.005); house.add(win);
      }
    }
    if (Math.random() > 0.4) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.12, hh * 0.35, 0.008), mt(BLUE_ACC));
      door.position.set(0, hh * 0.18, hd / 2 + 0.005); house.add(door);
    }
    house.position.set(hx, hy, hz);
    house.rotation.y = rot; gk.add(house);
  }

  // Full caldera arc: -0.5 to 2.2  (wider coverage)
  const t1Arc = { start: -0.5, end: 2.2 };

  // ── 7 tiers of tightly packed buildings across the full cliff ──
  const tierDefs = [
    { n: 14, rFrac: 0.63, pad: 0.0,  hwMin: 0.18, hhMin: 0.22, hdMin: 0.14, barrelP: 0.7 },
    { n: 14, rFrac: 0.60, pad: 0.05, hwMin: 0.16, hhMin: 0.20, hdMin: 0.13, barrelP: 0.6 },
    { n: 12, rFrac: 0.57, pad: 0.10, hwMin: 0.15, hhMin: 0.18, hdMin: 0.12, barrelP: 0.65 },
    { n: 12, rFrac: 0.54, pad: 0.15, hwMin: 0.14, hhMin: 0.17, hdMin: 0.11, barrelP: 0.55 },
    { n: 10, rFrac: 0.51, pad: 0.20, hwMin: 0.13, hhMin: 0.16, hdMin: 0.10, barrelP: 0.6 },
    { n: 10, rFrac: 0.48, pad: 0.25, hwMin: 0.12, hhMin: 0.15, hdMin: 0.10, barrelP: 0.5 },
    { n:  8, rFrac: 0.45, pad: 0.30, hwMin: 0.11, hhMin: 0.14, hdMin: 0.09, barrelP: 0.5 },
  ];
  tierDefs.forEach((tier, ti) => {
    for (let h = 0; h < tier.n; h++) {
      const t = h / tier.n;
      const a = t1Arc.start + tier.pad + t * (t1Arc.end - t1Arc.start - tier.pad * 2);
      // offset alternate tiers to stagger
      const jitter = (ti % 2 === 0) ? 0 : 0.5 / tier.n * (t1Arc.end - t1Arc.start);
      const aFinal = a + jitter;
      const r = getGkR(aFinal) * tier.rFrac + (Math.random() - 0.5) * 0.06;
      const hx = Math.cos(aFinal) * r, hz = Math.sin(aFinal) * r;
      makeHouse(hx, hz, 0, // y computed inside makeHouse
        tier.hwMin + Math.random() * 0.08,
        tier.hhMin + Math.random() * 0.08,
        tier.hdMin + Math.random() * 0.06,
        aFinal + Math.PI + (Math.random() - 0.5) * 0.3,
        Math.random() > tier.barrelP);
    }
  });

  // Terrace walls — 6 tiers, denser segments across full arc
  const wallTierR = [0.62, 0.59, 0.56, 0.53, 0.50, 0.47];
  for (let tw = 0; tw < wallTierR.length; tw++) {
    for (let seg = 0; seg < 12; seg++) {
      const t = seg / 12;
      const a = t1Arc.start + 0.05 + t * (t1Arc.end - t1Arc.start - 0.1);
      const r = getGkR(a) * wallTierR[tw];
      const _twx = Math.cos(a) * r, _twz = Math.sin(a) * r;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.03),
        mt(WHITE_D, { emissive: 0xc0b8a0, emissiveIntensity: 0.2 }));
      wall.position.set(_twx, getGkH(_twx, _twz) + 0.16, _twz);
      wall.rotation.y = -a + Math.PI; gk.add(wall);
    }
  }

  // ══════════════════════════════════════════════
  //   BLUE-DOMED CHURCHES — 4 prominent churches
  // ══════════════════════════════════════════════
  [{ a: 0.5, r: 0.61, s: 1.3 }, { a: 1.1, r: 0.58, s: 1.15 },
   { a: 1.7, r: 0.55, s: 1.0 }, { a: -0.1, r: 0.53, s: 0.95 }].forEach(cc => {
    const cr = getGkR(cc.a) * cc.r;
    const cx = Math.cos(cc.a) * cr, cz = Math.sin(cc.a) * cr;
    const s = cc.s;
    const ch = new THREE.Group();
    // Main body
    const chBody = new THREE.Mesh(new THREE.BoxGeometry(0.45 * s, 0.38 * s, 0.40 * s),
      mt(WHITE, { emissive: 0xd0c8b8, emissiveIntensity: 0.25 }));
    chBody.position.y = 0.19 * s; ch.add(chBody);
    // Drum (cylinder under dome)
    const drum = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17 * s, 0.18 * s, 0.06 * s, 12), mt(WHITE));
    drum.position.y = 0.41 * s; ch.add(drum);
    // Blue dome — large and prominent
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.19 * s, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(BLUE_DOME, { emissive: 0x102848, emissiveIntensity: 0.15 }));
    dome.position.y = 0.44 * s; ch.add(dome);
    // Cross on top
    const crV = new THREE.Mesh(new THREE.BoxGeometry(0.018 * s, 0.10 * s, 0.018 * s), mt(WHITE));
    crV.position.y = 0.67 * s; ch.add(crV);
    const crH = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.018 * s, 0.018 * s), mt(WHITE));
    crH.position.y = 0.61 * s; ch.add(crH);
    // Bell tower
    const btW = 0.12 * s, btH = 0.55 * s;
    const bellT = new THREE.Mesh(new THREE.BoxGeometry(btW, btH, 0.07 * s),
      mt(WHITE, { emissive: 0xd0c8b8, emissiveIntensity: 0.2 }));
    bellT.position.set(0.28 * s, btH / 2, 0); ch.add(bellT);
    // Bell openings
    for (const bx of [-0.025, 0.025]) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.022 * s, 0.05 * s, 0.01), mt(0x404040));
      arch.position.set(0.28 * s + bx * s, btH - 0.06 * s, 0.04 * s); ch.add(arch);
    }
    const btCap = new THREE.Mesh(new THREE.BoxGeometry(btW + 0.03 * s, 0.025 * s, 0.10 * s), mt(WHITE));
    btCap.position.set(0.28 * s, btH + 0.012 * s, 0); ch.add(btCap);
    // Tiny bell
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.01 * s, 5, 4), mt(0xc0a040, { metalness: 0.5 }));
    bell.position.set(0.28 * s, btH - 0.07 * s, 0); ch.add(bell);
    // Small cross on bell tower
    const btCross = new THREE.Mesh(new THREE.BoxGeometry(0.012 * s, 0.06 * s, 0.012 * s), mt(WHITE));
    btCross.position.set(0.28 * s, btH + 0.05 * s, 0); ch.add(btCross);

    ch.position.set(cx, getGkH(cx, cz) + 0.16, cz);
    ch.rotation.y = cc.a + Math.PI; gk.add(ch);
  });

  // ── Staircases descending cliff between tiers ──
  [{ a: 0.3, rTop: 0.62, rBot: 0.45 },
   { a: 0.9, rTop: 0.61, rBot: 0.44 },
   { a: 1.5, rTop: 0.60, rBot: 0.45 },
   { a: 2.0, rTop: 0.59, rBot: 0.46 }].forEach(stDef => {
    const baseR = getGkR(stDef.a);
    for (let s = 0; s < 25; s++) {
      const t = s / 25;
      // Radius decreases from outer (top) to inner (bottom of cliff)
      const sr = baseR * THREE.MathUtils.lerp(stDef.rTop, stDef.rBot, t);
      // Gentle zigzag as stairs wind down
      const zigzag = Math.sin(t * Math.PI * 5) * 0.04;
      const sa = stDef.a + zigzag;
      const _sx = Math.cos(sa) * sr, _sz = Math.sin(sa) * sr;
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.05),
        mt(WHITE_D, { emissive: 0xc0b8a0, emissiveIntensity: 0.2 }));
      step.position.set(_sx, getGkH(_sx, _sz) + 0.17, _sz);
      step.rotation.y = -sa; gk.add(step);
    }
  });

  // ── Windmills ──
  [{ a: 2.5, r: 0.7, ry: -0.3 }, { a: -0.4, r: 0.65, ry: 0.5 }].forEach(wpos => {
    const wr = getGkR(wpos.a) * wpos.r;
    const wm = new THREE.Group();
    { const _wx = Math.cos(wpos.a) * wr, _wz = Math.sin(wpos.a) * wr;
    wm.position.set(_wx, getGkH(_wx, _wz) + 0.16, _wz); }
    const wmB = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.65, 10), mt(WHITE));
    wmB.position.y = 0.32; wm.add(wmB);
    const wmR = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.15, 8), mt(GROUND));
    wmR.position.y = 0.72; wm.add(wmR);
    const wmHub = new THREE.Group();
    wmHub.position.set(0, 0.45, 0.22);
    for (let si = 0; si < 6; si++) {
      const bl = new THREE.Group();
      bl.rotation.z = (si / 6) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.008), mt(0x8a7a5a));
      arm.position.y = 0.2; bl.add(arm);
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.3),
        mt(WHITE, { transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      sail.position.set(0.05, 0.18, 0); bl.add(sail);
      wmHub.add(bl);
    }
    wm.add(wmHub);
    animatedObjects.push({ type: "spin", mesh: wmHub, speed: 0.25, axis: "z" });
    wm.rotation.y = wpos.ry; gk.add(wm);
  });

  // ── Bougainvillea ──
  for (let bi = 0; bi < 15; bi++) {
    const ba = t1Arc.start + 0.2 + Math.random() * (t1Arc.end - t1Arc.start - 0.4);
    const br = getGkR(ba) * (0.44 + Math.random() * 0.12);
    const bx = Math.cos(ba) * br, bz = Math.sin(ba) * br;
    const by = getGkH(bx, bz) + 0.18 + Math.random() * 0.06;
    const bg = new THREE.Mesh(new THREE.SphereGeometry(0.04 + Math.random() * 0.03, 5, 4), mt(0xd0308a));
    bg.position.set(bx, by, bz); bg.scale.set(1.4, 0.5, 1.0); gk.add(bg);
    if (Math.random() > 0.4) {
      const vine = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3), mt(0xc02878));
      vine.position.set(bx + 0.02, by - 0.06, bz + 0.01);
      vine.scale.set(0.7, 1.3, 0.5); gk.add(vine);
    }
  }

  // ══════════════════════════════════════════════
  //   NON-CALDERA PLAIN — scrub, rocks, vineyards, paths, chapel
  // ══════════════════════════════════════════════

  // Lone chapel on the plain
  {
    const chapA = 3.6, chapR = getGkR(chapA) * 0.45;
    const chapX = Math.cos(chapA) * chapR, chapZ = Math.sin(chapA) * chapR;
    const chapel = new THREE.Group();
    const cBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 0.30),
      mt(WHITE, { emissive: 0xd0c8b8, emissiveIntensity: 0.25 }));
    cBody.position.y = 0.125; chapel.add(cBody);
    const cRoof = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 0.33), mt(WHITE_D));
    cRoof.position.y = 0.26; chapel.add(cRoof);
    // Tiny blue dome
    const cDrum = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.03, 8), mt(WHITE));
    cDrum.position.y = 0.28; chapel.add(cDrum);
    const cDome = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(BLUE_DOME, { emissive: 0x102848, emissiveIntensity: 0.15 }));
    cDome.position.y = 0.295; chapel.add(cDome);
    const cCrV = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.01), mt(WHITE));
    cCrV.position.y = 0.37; chapel.add(cCrV);
    const cCrH = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.01), mt(WHITE));
    cCrH.position.y = 0.35; chapel.add(cCrH);
    chapel.position.set(chapX, getGkH(chapX, chapZ) + 0.15, chapZ);
    chapel.rotation.y = chapA + Math.PI * 0.8; gk.add(chapel);
  }

  // Vineyard rows — low stone walls + grape clusters
  for (let vi = 0; vi < 6; vi++) {
    const vA = 2.8 + vi * 0.3 + (Math.random() - 0.5) * 0.15;
    const vR = getGkR(vA) * (0.35 + Math.random() * 0.2);
    const vx = Math.cos(vA) * vR, vz = Math.sin(vA) * vR;
    // Low dry-stone wall
    const vWall = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 0.025),
      mt(GROUND, { emissive: 0x807060, emissiveIntensity: 0.15 }));
    vWall.position.set(vx, getGkH(vx, vz) + 0.17, vz);
    vWall.rotation.y = vA + 0.3; gk.add(vWall);
    // Grape basket / vine clump
    for (let gv = 0; gv < 3; gv++) {
      const gOff = (gv - 1) * 0.1;
      const gx = vx + Math.cos(vA) * gOff, gz = vz + Math.sin(vA) * gOff;
      const grape = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3),
        mt(0x5a3a68, { emissive: 0x302040, emissiveIntensity: 0.1 }));
      grape.position.set(gx, getGkH(gx, gz) + 0.17, gz);
      grape.scale.set(1.2, 0.6, 1.0); gk.add(grape);
    }
  }

  // Scrub bushes on plain
  for (let sb = 0; sb < 18; sb++) {
    const sA = 2.4 + Math.random() * 2.8;
    const sR = getGkR(sA) * (0.25 + Math.random() * 0.45);
    const sx = Math.cos(sA) * sR, sz = Math.sin(sA) * sR;
    const scrub = new THREE.Mesh(
      new THREE.SphereGeometry(0.03 + Math.random() * 0.025, 5, 4),
      mt(0x7a8a5a, { emissive: 0x304020, emissiveIntensity: 0.12 }));
    scrub.position.set(sx, getGkH(sx, sz) + 0.16, sz);
    scrub.scale.set(1.2 + Math.random() * 0.5, 0.5 + Math.random() * 0.3, 1.0 + Math.random() * 0.3);
    gk.add(scrub);
  }

  // Scattered rocks on plain
  for (let ri = 0; ri < 12; ri++) {
    const rA = 2.5 + Math.random() * 2.6;
    const rR = getGkR(rA) * (0.2 + Math.random() * 0.5);
    const rx = Math.cos(rA) * rR, rz = Math.sin(rA) * rR;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.02 + Math.random() * 0.025, 0),
      mt(0xc0b8a8, { emissive: 0x504838, emissiveIntensity: 0.12 }));
    rock.position.set(rx, getGkH(rx, rz) + 0.16, rz);
    rock.rotation.set(Math.random() * 2, Math.random() * 2, 0); gk.add(rock);
  }

  // Dirt path across plain (series of flat discs)
  for (let pi = 0; pi < 15; pi++) {
    const t = pi / 15;
    const pathA = 2.5 + t * 2.0;
    const pathR = getGkR(pathA) * (0.38 + Math.sin(t * Math.PI) * 0.08);
    const px = Math.cos(pathA) * pathR, pz = Math.sin(pathA) * pathR;
    const pathSeg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.005, 6),
      mt(0xd8c8a8, { emissive: 0x605040, emissiveIntensity: 0.1 }));
    pathSeg.position.set(px, getGkH(px, pz) + 0.155, pz);
    gk.add(pathSeg);
  }

  // ── Trees ──
  [{ a: 2.8, r: 0.65 }, { a: 3.5, r: 0.55 }, { a: -0.6, r: 0.6 }].forEach(tp => {
    const tr = getGkR(tp.a) * tp.r;
    const tx = Math.cos(tp.a) * tr, tz = Math.sin(tp.a) * tr;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.15, 4), mt(0x7a6a4a));
    trunk.position.set(tx, getGkH(tx, tz) + 0.22, tz); gk.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 5), mt(0x2a5a28));
    crown.position.set(tx, getGkH(tx, tz) + 0.5, tz); gk.add(crown);
  });
  [{ a: 3.2, r: 0.7 }, { a: 4.0, r: 0.5 }].forEach(tp => {
    const tr = getGkR(tp.a) * tp.r;
    const tx = Math.cos(tp.a) * tr, tz = Math.sin(tp.a) * tr;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.25, 4), mt(0x8a7a5a));
    trunk.position.set(tx, getGkH(tx, tz) + 0.2, tz); gk.add(trunk);
    const crown = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), mt(0x6a8a4a));
    crown.position.set(tx, getGkH(tx, tz) + 0.4, tz); crown.scale.set(1.3, 0.7, 1.0); gk.add(crown);
  });

  // ── Pools ──
  [{ a: 0.8, r: 0.60 }, { a: 1.5, r: 0.56 }, { a: 0.3, r: 0.52 }].forEach(pp => {
    const pr = getGkR(pp.a) * pp.r;
    const _px = Math.cos(pp.a) * pr, _pz = Math.sin(pp.a) * pr;
    const _py = getGkH(_px, _pz) + 0.17;
    const pool = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.015, 0.10), mt(0x40c8d8, { roughness: 0.1 }));
    pool.position.set(_px, _py, _pz); pool.rotation.y = pp.a; gk.add(pool);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.005, 0.12), mt(WHITE));
    rim.position.set(_px, _py + 0.008, _pz); rim.rotation.y = pp.a; gk.add(rim);
  });

  // ── Cats ──
  for (let gc = 0; gc < 5; gc++) {
    const gCat = new THREE.Group();
    const catCol = [0xf0a040, 0x404040, 0xffffff, 0xd08030, 0x606060][gc];
    const catBody = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.07), mt(catCol));
    catBody.position.y = 0.02; gCat.add(catBody);
    const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3), mt(catCol));
    catHead.position.set(0, 0.03, 0.04); gCat.add(catHead);
    for (const ex of [-0.008, 0.008]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.012, 3), mt(catCol));
      ear.position.set(ex, 0.045, 0.04); gCat.add(ear);
    }
    const catA = 0.1 + gc * 0.45;
    const catR = getGkR(catA) * (0.50 + gc * 0.02);
    const _cx = Math.cos(catA) * catR, _cz = Math.sin(catA) * catR;
    gCat.position.set(_cx, getGkH(_cx, _cz) + 0.18, _cz);
    gCat.rotation.y = gc * 1.3; gk.add(gCat);
  }

  // ── Amphora ──
  [{ a: 0.5, r: 0.58, y: 1.6 }, { a: 1.4, r: 0.52, y: 1.15 }].forEach(ps => {
    const pr = getGkR(ps.a) * ps.r;
    const amp = new THREE.Group();
    const ampBody = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 0.04, 6), mt(0xc07040));
    ampBody.position.y = 0.02; amp.add(ampBody);
    const ampNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.012, 0.018, 6), mt(0xc07040));
    ampNeck.position.y = 0.045; amp.add(ampNeck);
    { const _ax = Math.cos(ps.a) * pr, _az = Math.sin(ps.a) * pr;
    amp.position.set(_ax, getGkH(_ax, _az) + 0.17, _az); gk.add(amp); }
  });

  // ── Dock ──
  const dockA = Math.PI + 0.5;
  const dockR = getGkR(dockA) - 0.3;
  const dock = new THREE.Group();
  dock.position.set(Math.cos(dockA) * dockR, -0.05, Math.sin(dockA) * dockR);
  dock.rotation.y = -dockA;
  dock.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.18), mt(0x8a7a5a)));
  for (const dx of [-0.25, 0, 0.25]) {
    const dp = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.2, 4), mt(0x8a7a5a));
    dp.position.set(dx, -0.07, 0); dock.add(dp);
  }
  gk.add(dock);

  // ── Boats ──
  [0, 0.25].forEach((phase, bi) => {
    const boat = new THREE.Group();
    boat.position.set(Math.cos(dockA) * (dockR + 0.5 + bi * 0.4), -0.08,
      Math.sin(dockA) * (dockR + 0.5 + bi * 0.4));
    boat.rotation.y = -dockA + 0.3 + bi * 0.4; boat.scale.setScalar(1.4);
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.18),
      mt(bi === 0 ? 0x3060a0 : 0xa03030));
    hull.position.y = 0.015; boat.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.05, 4),
      mt(bi === 0 ? 0x3060a0 : 0xa03030));
    bow.position.set(0, 0.015, 0.115); bow.rotation.x = Math.PI / 2; boat.add(bow);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.006, 0.17), mt(WHITE));
    stripe.position.y = 0.025; boat.add(stripe);
    gk.add(boat);
    animatedObjects.push({ type: "bob", mesh: boat, speed: 0.5, baseY: -0.08, amp: 0.01, phase: 8 + bi * 3 });
  });

  // ── Fill light ──
  // [perf] removed: const fillGk = new THREE.PointLight(0xfff8f0, 3.0, 20);
  // [perf] removed: fillGk.position.set(0, 6, 0); gk.add(fillGk);

  scene.add(gk);

  // ── Bridge ──
  const bAngle = Math.atan2(GK_Z, GK_X);
  const mainEdge = getIslandRadius(bAngle);
  const gb1X = Math.cos(bAngle) * (mainEdge - 1.0);
  const gb1Z = Math.sin(bAngle) * (mainEdge - 1.0);
  const gb2X = GK_X + Math.cos(bAngle + Math.PI) * 3.0;
  const gb2Z = GK_Z + Math.sin(bAngle + Math.PI) * 3.0;
  bridge2MainEnd = { x: gb1X, z: gb1Z };
  bridge2IslandEnd = { x: gb2X, z: gb2Z };
  scene.add(buildRopeBridge(gb1X, gb1Z, gb2X, gb2Z, { color: 0xe0d8cc, colorD: 0xd0c8b8 }));

  // ── Arch Bridge ──
  const MALD_X = 24, MALD_Z = 26;
  const archBridgeG = new THREE.Group();
  const abStartX = GK_X, abStartZ = GK_Z + 3.5;
  const abEndX = MALD_X, abEndZ = MALD_Z - 1.6;
  const abAng = Math.atan2(abEndZ - abStartZ, abEndX - abStartX);
  const abSpan = Math.sqrt((abEndX - abStartX) ** 2 + (abEndZ - abStartZ) ** 2);
  const ARCH_H = abSpan * 0.18, AB_SEGS = 28, AB_W = 0.45;
  const STONE_C = 0xd0c8b8, STONE_D2 = 0xb8b0a0;

  const archPts = [];
  for (let ai = 0; ai <= AB_SEGS; ai++) {
    const t = ai / AB_SEGS;
    archPts.push(new THREE.Vector3(
      abStartX + (abEndX - abStartX) * t,
      4 * ARCH_H * t * (1 - t),
      abStartZ + (abEndZ - abStartZ) * t));
  }

  for (let ai = 0; ai < AB_SEGS; ai++) {
    const p0 = archPts[ai], p1 = archPts[ai + 1];
    const segA = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    const pitch = Math.atan2(p1.y - p0.y, Math.sqrt((p1.x - p0.x) ** 2 + (p1.z - p0.z) ** 2));
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(p0.distanceTo(p1) + 0.02, 0.05, AB_W), mt(STONE_C));
    plank.position.set((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
    plank.rotation.y = -segA; plank.rotation.z = pitch;
    archBridgeG.add(plank);
  }

  for (const side of [-1, 1]) {
    for (let ai = 0; ai < AB_SEGS; ai++) {
      const p0 = archPts[ai], p1 = archPts[ai + 1];
      const segA = Math.atan2(p1.z - p0.z, p1.x - p0.x);
      const pitch = Math.atan2(p1.y - p0.y, Math.sqrt((p1.x - p0.x) ** 2 + (p1.z - p0.z) ** 2));
      const offX = Math.sin(segA) * (AB_W / 2 - 0.02) * side;
      const offZ = -Math.cos(segA) * (AB_W / 2 - 0.02) * side;
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(p0.distanceTo(p1) + 0.02, 0.12, 0.05), mt(STONE_C));
      rail.position.set((p0.x + p1.x) / 2 + offX, (p0.y + p1.y) / 2 + 0.08, (p0.z + p1.z) / 2 + offZ);
      rail.rotation.y = -segA; rail.rotation.z = pitch;
      archBridgeG.add(rail);
    }
  }

  [0.15, 0.3, 0.5, 0.7, 0.85].forEach((t) => {
    const px = abStartX + (abEndX - abStartX) * t;
    const pz = abStartZ + (abEndZ - abStartZ) * t;
    const py = 4 * ARCH_H * t * (1 - t);
    const pil = new THREE.Mesh(new THREE.BoxGeometry(0.18, py + 0.3, 0.18), mt(STONE_D2));
    pil.position.set(px, py / 2 - 0.15, pz); archBridgeG.add(pil);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.28), mt(STONE_C));
    cap.position.set(px, py - 0.05, pz); archBridgeG.add(cap);
  });

  const peakPt = archPts[Math.floor(AB_SEGS / 2)];
  const ks = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, AB_W + 0.06), mt(STONE_D2));
  ks.position.set(peakPt.x, peakPt.y + 0.12, peakPt.z); ks.rotation.y = -abAng;
  archBridgeG.add(ks);
  scene.add(archBridgeG);

  // ── Agents ──
  const gkAgentConfigs = [
    { name: "Philosopher", body: 0x3068a8, accent: 0x285898, roof: 0x204880,
      home: [GK_X + 0.3, 0.5, GK_Z + 0.15], angle: Math.PI * 0.75 },
    { name: "Oracle", body: 0xc0a060, accent: 0xa88848, roof: 0x907030,
      home: [GK_X - 0.4, 0.4, GK_Z + 0.3], angle: Math.PI * 1.25 },
    { name: "Artisan", body: 0xa06848, accent: 0x885838, roof: 0x704828,
      home: [GK_X + 0.6, 0.35, GK_Z + 0.5], angle: Math.PI * 0.5 },
  ];
  gkAgentConfigs.forEach((cfg, i) => {
    const agent = createAgent(cfg, i + 6);
    agent.useBridge2 = true;
    scene.add(agent.group);
    agents.push(agent);
  });
}

/* ═══════════════════════════════════════════════════════════
   Desert Island — sand dunes, oasis, ruins, cacti
   ═══════════════════════════════════════════════════════════ */

function createDesertIsland() {
  const DI_X = 5, DI_Z = -14;
  const DI_R = 4.5;
  const di = new THREE.Group();
  di.position.set(DI_X, 0, DI_Z);

  // ── Desert palette — warm golden/ochre ──
  const SAND = 0xdcc890, SAND_D = 0xc8b878;
  const SAND_L = 0xe8d8a0;
  const SANDSTONE = 0xd0b888;

  // ── Irregular coastline ──
  function getDesertRadius(angle) {
    let r = DI_R;
    r += Math.sin(angle * 2.5 + 0.7) * 0.4;
    r += Math.cos(angle * 4.5 - 0.3) * 0.2;
    r += Math.sin(angle * 6.0 + 1.5) * 0.12;
    r -= Math.exp(-Math.pow((angle - 1.5) * 3, 2)) * 0.7;
    r -= Math.exp(-Math.pow((angle + 2.2) * 2.5, 2)) * 0.5;
    return Math.max(r, 2.5);
  }

  // ── DUNE HEIGHT — rolling ridges with directional crests ──
  function getDuneHeight(x, z) {
    const wa = 0.6; // wind direction
    const wx = x * Math.cos(wa) + z * Math.sin(wa);
    const wz = -x * Math.sin(wa) + z * Math.cos(wa);
    let h = 0;
    // Primary dune ridges (tall, wind-aligned)
    h += Math.sin(wx * 0.9) * 0.25;
    // Secondary ridges
    h += Math.sin(wx * 2.2 + 0.5) * 0.12;
    // Cross-wind ripples
    h += Math.sin(wz * 3.0 + wx * 0.3) * 0.04;
    // Gentle undulation
    h += Math.sin(x * 0.4 + z * 0.3 + 1.0) * 0.08;
    // Oasis depression
    const oaDist = Math.sqrt((x + 0.8) * (x + 0.8) + (z + 1.5) * (z + 1.5));
    if (oaDist < 1.2) h -= Math.max(0, (1.2 - oaDist) * 0.15);
    return Math.max(h + 0.08, 0.01);
  }

  // ── Terrain mesh with vertex colors for dune shading ──
  const RES = 96, SIZE = DI_R * 2.8;
  const planeGeo = new THREE.PlaneGeometry(SIZE, SIZE, RES, RES);
  planeGeo.rotateX(-Math.PI / 2);
  const pos = planeGeo.attributes.position;
  const duneColors = new Float32Array(pos.count * 3);
  const CREST_C = new THREE.Color(SAND_L);   // sunlit crests
  const TROUGH_C = new THREE.Color(SAND_D);  // shadowed leeward
  const MID_C = new THREE.Color(SAND);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dist = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);
    const edgeR = getDesertRadius(angle);
    if (dist > edgeR + 0.6) {
      pos.setY(i, -0.4);
    } else if (dist > edgeR - 1.2) {
      const t = Math.max(0, Math.min(1, (dist - (edgeR - 1.2)) / 1.8));
      const ss = t * t * (3 - 2 * t);
      pos.setY(i, getDuneHeight(x, z) * (1 - ss) + (-0.06) * ss);
    } else {
      pos.setY(i, getDuneHeight(x, z));
    }
    // Color based on slope (lit crest vs shadow)
    const h = pos.getY(i);
    const wa = 0.6;
    const wx = x * Math.cos(wa) + z * Math.sin(wa);
    const slopeT = Math.cos(wx * 2.0) * 0.5 + 0.5; // windward=bright, leeward=dark
    let c;
    if (dist > edgeR - 0.5) {
      c = MID_C.clone();
    } else {
      c = TROUGH_C.clone().lerp(CREST_C, slopeT);
      // Sand ripple variation
      const ripple = Math.sin(wx * 12 + z * 8) * 0.02;
      c.r += ripple; c.g += ripple * 0.9; c.b += ripple * 0.7;
    }
    duneColors[i * 3] = c.r; duneColors[i * 3 + 1] = c.g; duneColors[i * 3 + 2] = c.b;
  }
  planeGeo.setAttribute("color", new THREE.BufferAttribute(duneColors, 3));
  planeGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(planeGeo, mt(SAND, { vertexColors: true, roughness: 0.92, emissive: 0x504030, emissiveIntensity: 0.1 }));
  terrain.receiveShadow = true; di.add(terrain);

  // ── Cliff underside ──
  const cliffSegs = 64;
  const cGeo = new THREE.BufferGeometry();
  const cV = [], cN = [], cU = [], cI = [];
  for (let i = 0; i <= cliffSegs; i++) {
    const a = (i / cliffSegs) * Math.PI * 2;
    const r = getDesertRadius(a);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const topY = Math.max(getDuneHeight(x * 0.9, z * 0.9) * 0.5, -0.05);
    const nx = Math.cos(a), nz = Math.sin(a);
    const u = i / cliffSegs;
    cV.push(x, topY, z); cN.push(nx, 0, nz); cU.push(u, 1);
    cV.push(x, -0.35, z); cN.push(nx, 0, nz); cU.push(u, 0);
    if (i < cliffSegs) {
      const vi = i * 2;
      cI.push(vi, vi + 1, vi + 2, vi + 2, vi + 1, vi + 3);
    }
  }
  cGeo.setAttribute("position", new THREE.Float32BufferAttribute(cV, 3));
  cGeo.setAttribute("normal", new THREE.Float32BufferAttribute(cN, 3));
  cGeo.setAttribute("uv", new THREE.Float32BufferAttribute(cU, 2));
  cGeo.setIndex(cI);
  di.add(new THREE.Mesh(cGeo, mt(SAND_D, { roughness: 0.95 })));

  // ══════════════════════════════════════════════
  //   SANDSTONE ROCK FORMATIONS (wind-carved)
  // ══════════════════════════════════════════════
  const makeOutcrop = (cx, cz, layers, baseSize) => {
    const group = new THREE.Group();
    group.position.set(cx, getDuneHeight(cx, cz), cz);
    for (let i = 0; i < layers; i++) {
      const s = baseSize * (1 - i * 0.1);
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(s * (1 + Math.random() * 0.3), 0.08 + Math.random() * 0.04,
          s * (0.6 + Math.random() * 0.3)),
        mt(i % 2 === 0 ? SANDSTONE : SAND_D, { roughness: 0.95 }));
      slab.position.y = i * 0.1;
      slab.rotation.y = (Math.random() - 0.5) * 0.3;
      slab.castShadow = true; group.add(slab);
    }
    di.add(group);
  };
  makeOutcrop(2.5, -1.5, 6, 0.8);
  makeOutcrop(-2.0, 1.5, 4, 0.6);
  makeOutcrop(0.5, 2.5, 3, 0.5);

  // ── Weathered mudbrick ruin (replaces ziggurat) ──
  const ruinG = new THREE.Group();
  ruinG.position.set(-2.5, getDuneHeight(-2.5, -2.0), -2.0);
  ruinG.rotation.y = 0.4;
  // Crumbling walls
  const wallA = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.06), mt(SANDSTONE, { roughness: 1 }));
  wallA.position.set(0, 0.12, -0.15); ruinG.add(wallA);
  const wallB = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.35), mt(SANDSTONE, { roughness: 1 }));
  wallB.position.set(-0.22, 0.1, 0); ruinG.add(wallB);
  // Partial arch
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 8, Math.PI), mt(SANDSTONE, { roughness: 1 }));
  arch.position.set(0, 0.22, -0.15); arch.rotation.z = Math.PI; ruinG.add(arch);
  // Fallen blocks
  for (let rb = 0; rb < 6; rb++) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.06 + Math.random() * 0.04, 0.04, 0.05 + Math.random() * 0.03),
      mt(SANDSTONE, { roughness: 1 }));
    block.position.set((Math.random() - 0.5) * 0.5, 0.02, (Math.random() - 0.5) * 0.4);
    block.rotation.set(Math.random() * 0.2, Math.random(), 0); ruinG.add(block);
  }
  di.add(ruinG);

  // ══════════════════════════════════════════════
  //   OASIS — sunken between dunes
  // ══════════════════════════════════════════════
  const oX = -0.8, oZ = -1.5, oY = getDuneHeight(-0.8, -1.5);
  const outerGrass = new THREE.Mesh(new THREE.CircleGeometry(1.0, 16), mt(0x8ab87a, { roughness: 0.9 }));
  outerGrass.rotation.x = -Math.PI / 2; outerGrass.position.set(oX, oY + 0.003, oZ); di.add(outerGrass);
  const innerGrass = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), mt(GREEN_L, { roughness: 0.85 }));
  innerGrass.rotation.x = -Math.PI / 2; innerGrass.position.set(oX, oY + 0.005, oZ); di.add(innerGrass);
  const poolBed = new THREE.Mesh(new THREE.CircleGeometry(0.4, 12), mt(0xb8b0a0));
  poolBed.rotation.x = -Math.PI / 2; poolBed.position.set(oX, oY + 0.006, oZ); di.add(poolBed);
  const poolWater = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12),
    mt(WATER, { roughness: 0.05, transparent: true, opacity: 0.6 }));
  poolWater.rotation.x = -Math.PI / 2; poolWater.position.set(oX, oY + 0.008, oZ); di.add(poolWater);
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.12, 4), mt(GREEN_VD));
    reed.position.set(oX + Math.cos(a) * 0.32, oY + 0.06, oZ + Math.sin(a) * 0.32); di.add(reed);
  }

  // ── DATE PALMS (replaces saguaro — Arabian) ──
  [
    { x: oX - 0.5, z: oZ - 0.3, lean: 0.15 },
    { x: oX + 0.4, z: oZ + 0.4, lean: -0.1 },
    { x: oX - 0.3, z: oZ + 0.5, lean: 0.2 },
    { x: oX + 0.6, z: oZ - 0.2, lean: -0.15 },
    { x: 1.5, z: 0.8, lean: 0.1 },
    { x: -1.5, z: 2.0, lean: -0.08 },
  ].forEach(p => {
    const trunkH = 0.5 + Math.random() * 0.2;
    const py = getDuneHeight(p.x, p.z);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.035, trunkH, 5), mt(0x8a7050));
    trunk.position.set(p.x, py + trunkH / 2, p.z);
    trunk.rotation.z = p.lean; di.add(trunk);
    const frondG = new THREE.Group();
    frondG.position.set(p.x + p.lean * trunkH * 0.3, py + trunkH, p.z);
    for (let f = 0; f < 8; f++) {
      const fa = (f / 8) * Math.PI * 2;
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.22),
        mtWind(0x4a7a2a, { heightFactor: 3.0, swayAmp: 0.04, swaySpeed: 0.7 }));
      frond.material.side = THREE.DoubleSide;
      frond.position.set(Math.cos(fa) * 0.08, -0.04, Math.sin(fa) * 0.08);
      frond.rotation.set(0.9, fa, 0); frondG.add(frond);
    }
    // Date clusters hanging below fronds
    for (let dc = 0; dc < 3; dc++) {
      const da = dc * Math.PI * 2 / 3;
      const dates = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0x8a4020));
      dates.position.set(Math.cos(da) * 0.06, -0.08, Math.sin(da) * 0.06);
      frondG.add(dates);
    }
    di.add(frondG);
    const sh = makeContactShadow(0.12);
    sh.position.set(p.x, py + 0.005, p.z); di.add(sh);
  });

  // ── Desert scrub (sparse) ──
  for (let i = 0; i < 10; i++) {
    const sx = -3 + Math.random() * 6, sz = -3 + Math.random() * 6;
    if (Math.sqrt(sx * sx + sz * sz) > DI_R - 0.8) continue;
    if (Math.sqrt((sx - oX) ** 2 + (sz - oZ) ** 2) < 1.2) continue;
    const scrub = new THREE.Mesh(
      new THREE.SphereGeometry(0.05 + Math.random() * 0.03, 4, 3),
      mt(i % 2 === 0 ? 0x8a8a5a : 0x7a7a4a));
    scrub.position.set(sx, getDuneHeight(sx, sz) + 0.015, sz);
    scrub.scale.y = 0.35; di.add(scrub);
  }

  // ── Bedouin tent (low, dark — replaces yurt) ──
  const tentX = 0.8, tentZ = -0.8, tentY = getDuneHeight(0.8, -0.8);
  const tent = new THREE.Group();
  tent.position.set(tentX, tentY, tentZ); tent.rotation.y = 0.4;
  // Low, flat profile (Bedouin style — dark fabric)
  const tentBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.01, 0.4),
    mt(0x2a1a10, { roughness: 0.95 }));
  tentBody.position.y = 0.18; tent.add(tentBody);
  // Support poles
  for (const px of [-0.25, 0, 0.25]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 3), mt(0x8a6a3a));
    pole.position.set(px, 0.1, 0); tent.add(pole);
  }
  // Side flaps hanging down
  const flap1 = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), mt(0x2a1a10, { side: THREE.DoubleSide }));
  flap1.position.set(0, 0.11, 0.2); tent.add(flap1);
  const flap2 = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), mt(0x2a1a10, { side: THREE.DoubleSide }));
  flap2.position.set(0, 0.11, -0.2); tent.add(flap2);
  // Rugs outside
  const rug = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.005, 0.15), mt(0x8a2020));
  rug.position.set(0.35, 0.003, 0); tent.add(rug);
  // Warm glow inside
  const tentGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.12),
    mt(0xffe8a0, { emissive: 0xffe8a0, emissiveIntensity: 0.3, transparent: true, opacity: 0.4 }));
  tentGlow.position.set(0.3, 0.08, 0); tentGlow.rotation.y = Math.PI / 2; tent.add(tentGlow);
  di.add(tent);

  // ── Fire pit near tent ──
  const fpX = tentX + 0.6, fpZ = tentZ + 0.2, fpY = getDuneHeight(fpX, fpZ);
  const firePit = new THREE.Group();
  firePit.position.set(fpX, fpY, fpZ);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const fpStone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.025, 0), mt(STONE, { roughness: 0.95 }));
    fpStone.position.set(Math.cos(a) * 0.1, 0.012, Math.sin(a) * 0.1);
    fpStone.rotation.set(Math.random(), Math.random(), Math.random());
    fpStone.scale.y = 0.6; firePit.add(fpStone);
  }
  const dfMat = new THREE.MeshStandardMaterial({
    color: 0xff8830, emissive: 0xff6610, emissiveIntensity: 1.2,
    roughness: 1, flatShading: true, transparent: true, opacity: 0.85,
  });
  const dFlame = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 5), dfMat);
  dFlame.position.y = 0.06; firePit.add(dFlame);
  animatedObjects.push({ type: "flicker", mesh: dFlame, mat: dfMat, phase: 10, baseScaleX: 1, baseScaleY: 1 });
  const dFireLight = new THREE.PointLight(0xff9940, 0.6, 3);
  dFireLight.position.y = 0.1; firePit.add(dFireLight);
  animatedObjects.push({ type: "lightFlicker", light: dFireLight, baseIntensity: 0.6, phase: 10 });
  di.add(firePit);

  // ── Camels ──
  function makeCamel(cx, cz, rotY, scale) {
    const camel = new THREE.Group();
    const cy = getDuneHeight(cx, cz);
    camel.position.set(cx, cy, cz); camel.rotation.y = rotY; camel.scale.setScalar(scale);
    const CAMEL_BODY = 0xc8a060, CAMEL_DARK = 0xa88040;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.28), mt(CAMEL_BODY));
    body.position.y = 0.22; camel.add(body);
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), mt(CAMEL_DARK));
    hump.position.set(0, 0.32, 0.02); hump.scale.set(0.8, 1, 1.2); camel.add(hump);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.18, 4), mt(CAMEL_BODY));
    neck.position.set(0, 0.3, 0.16); neck.rotation.x = 0.5; camel.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.08), mt(CAMEL_BODY));
    head.position.set(0, 0.37, 0.24); camel.add(head);
    const legPositions = [[-0.04, 0.08, 0.1], [0.04, 0.08, 0.1], [-0.04, 0.08, -0.1], [0.04, 0.08, -0.1]];
    legPositions.forEach(([lx, ly, lz]) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.16, 4), mt(CAMEL_BODY));
      leg.position.set(lx, ly, lz); camel.add(leg);
    });
    di.add(camel); return camel;
  }
  makeCamel(-0.5, 1.2, Math.PI * 0.3, 1.0);
  makeCamel(1.5, -0.5, Math.PI * 0.8, 0.95);
  makeCamel(2.0, -0.9, Math.PI * 0.75, 0.9);

  // ── Merchant stall ──
  const merchant = new THREE.Group();
  for (const mx of [-0.2, 0.2]) {
    const mPole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.45, 4), mt(0x8a6a3a));
    mPole.position.set(mx, 0.22, 0); merchant.add(mPole);
  }
  const mCanopy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.35), mt(0xcc3333));
  mCanopy.position.y = 0.42; merchant.add(mCanopy);
  const mTable = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.2), mt(0x8a6a3a));
  mTable.position.y = 0.12; merchant.add(mTable);
  for (let sb = 0; sb < 3; sb++) {
    const spice = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt([0xd4a000, 0xc03020, 0x50a040][sb]));
    spice.scale.y = 0.4; spice.position.set(-0.08 + sb * 0.08, 0.21, -0.05); merchant.add(spice);
  }
  merchant.position.set(-1.5, 0.12, 0.8); merchant.rotation.y = 0.6; di.add(merchant);

  // ── Desert foxes (fennec) ──
  for (let df = 0; df < 2; df++) {
    const fox = new THREE.Group();
    const fBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.1), mt(0xe8c880));
    fBody.position.y = 0.05; fox.add(fBody);
    const fHead = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3), mt(0xe8c880));
    fHead.position.set(0, 0.07, 0.06); fox.add(fHead);
    for (const ex of [-0.02, 0.02]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 3), mt(0xf0d8a0));
      ear.position.set(ex, 0.1, 0.05); fox.add(ear);
    }
    fox.position.set(-0.3 + df * 2.5, 0.12, -1.0 + df * 1.5); fox.rotation.y = df * 1.5; di.add(fox);
  }

  // ── Magic carpet (flying) ──
  const carpet = new THREE.Group();
  const carpetBody = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.45), mt(0x8b2252, { side: THREE.DoubleSide }));
  carpet.add(carpetBody);
  const carpetTrim = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.005, 0.47), mt(0xdaa520));
  carpetTrim.position.y = -0.005; carpet.add(carpetTrim);
  carpet.position.set(DI_X + 1, 1.8, DI_Z - 1);
  scene.add(carpet);
  animatedObjects.push({ type: "jetski", mesh: carpet, cx: DI_X, cz: DI_Z, radius: 3.0, speed: 0.15, phase: 0 });
  animatedObjects.push({ type: "bob", mesh: carpet, speed: 0.6, baseY: 1.8, amp: 0.15, phase: 2 });

  // ── Weathered signpost ──
  const signG = new THREE.Group();
  signG.position.set(1.0, getDuneHeight(1.0, -2.5), -2.5);
  const signPole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.3, 4), mt(WOOD_D, { roughness: 0.95 }));
  signPole.position.y = 0.15; signG.add(signPole);
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.04, 0.008), mt(WOOD, { roughness: 0.9 }));
  signBoard.position.set(0.04, 0.27, 0); signBoard.rotation.z = -0.05; signG.add(signBoard);
  di.add(signG);

    scene.add(di);

  // ── Blowing sand particles (world-space) ──
  for (let i = 0; i < 12; i++) {
    const px = DI_X + (Math.random() - 0.5) * 8;
    const pz = DI_Z + (Math.random() - 0.5) * 8;
    const py = 0.05 + Math.random() * 0.1;
    const sp = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 3, 2),
      new THREE.MeshBasicMaterial({ color: 0xd8c890, transparent: true, opacity: 0.3 }));
    sp.position.set(px, py, pz);
    sp.userData.sandDrift = {
      baseX: px, baseZ: pz, baseY: py,
      speed: 0.3 + Math.random() * 0.4,
      phase: Math.random() * Math.PI * 2,
      range: 2 + Math.random() * 2,
    };
    scene.add(sp);
    animatedObjects.push({ type: "sandDrift", mesh: sp });
  }

  // ── Tumbleweeds (world-space, rolling with wind) ──
  for (let i = 0; i < 2; i++) {
    const tw = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0),
      mt(0xa09060, { roughness: 0.95 }));
    const twx = DI_X + (i === 0 ? 1.5 : -1.5);
    const twz = DI_Z + (i === 0 ? 0.5 : 1.0);
    tw.position.set(twx, 0.06, twz);
    tw.userData.tumbleweed = {
      baseX: twx, baseZ: twz,
      speed: 0.2 + Math.random() * 0.15,
      phase: i * Math.PI, range: 2.0,
    };
    scene.add(tw);
    animatedObjects.push({ type: "tumbleweed", mesh: tw });
  }

  // ── Bridge connecting main island to desert island ──
  const diBridgeAngle = Math.atan2(DI_Z, DI_X);
  const diMainEdge = getIslandRadius(diBridgeAngle);
  const db1X = Math.cos(diBridgeAngle) * (diMainEdge - 1.0);
  const db1Z = Math.sin(diBridgeAngle) * (diMainEdge - 1.0);
  const db2X = DI_X + Math.cos(diBridgeAngle + Math.PI) * 3.0;
  const db2Z = DI_Z + Math.sin(diBridgeAngle + Math.PI) * 3.0;
  bridge3MainEnd = { x: db1X, z: db1Z };
  bridge3IslandEnd = { x: db2X, z: db2Z };

  scene.add(buildRopeBridge(db1X, db1Z, db2X, db2Z));
}

/* ═══════════════════════════════════════════════════════════
   Treasure Island — gold castle, treasure piles, gems
   ═══════════════════════════════════════════════════════════ */

function createTreasureIsland() {
  const TI_X = 10, TI_Z = -35;
  const TI_R = 3.5;
  const ti = new THREE.Group();
  ti.position.set(TI_X, 0, TI_Z);

  const GOLD = 0xd4a020, GOLD_D = 0xb88a18, GOLD_L = 0xf0c840;
  const SILVER = 0xc8c8d0, DIAMOND = 0xa0e8f0;
  const ROCK = 0xa09880;

  // ── Dramatic rocky base ──
  const tiBaseGeo = new THREE.CylinderGeometry(TI_R - 0.2, TI_R + 0.6, 1.4, 16);
  const tiPos = tiBaseGeo.attributes.position;
  for (let i = 0; i < tiPos.count; i++) {
    const x = tiPos.getX(i), z = tiPos.getZ(i), y = tiPos.getY(i);
    const a = Math.atan2(z, x);
    const w = 1 + Math.sin(a * 3) * 0.12 + Math.cos(a * 5) * 0.06 + Math.sin(a * 7) * 0.03;
    tiPos.setX(i, x * w); tiPos.setZ(i, z * w);
    if (y > 0.2) tiPos.setY(i, y + Math.sin(a * 4 + x * 2) * 0.2 + Math.cos(a * 3) * 0.1);
  }
  tiBaseGeo.computeVertexNormals();
  const tiBase = new THREE.Mesh(tiBaseGeo, mt(ROCK, { roughness: 0.95, emissive: 0x605040, emissiveIntensity: 0.2 }));
  tiBase.position.y = -0.25; ti.add(tiBase);

  // Top terrain
  const tiTop = new THREE.Mesh(
    new THREE.CylinderGeometry(TI_R - 0.5, TI_R - 0.2, 0.15, 14), mt(0x5fa84e, { roughness: 0.85, emissive: 0x304020, emissiveIntensity: 0.18 }));
  tiTop.position.y = 0.35; ti.add(tiTop);

  // ── Sandy beach ring ──
  const beachRing = new THREE.Mesh(
    new THREE.TorusGeometry(TI_R + 0.1, 0.35, 6, 20),
    mt(0xe8d8a8, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.1 }));
  beachRing.rotation.x = -Math.PI / 2; beachRing.position.y = -0.02;
  ti.add(beachRing);

  // ── Palm trees ──
  const palmPositions = [
    { x: 2.8, z: 1.5, lean: 0.3, h: 1.2 },
    { x: -2.5, z: 2.0, lean: -0.2, h: 1.0 },
    { x: 1.5, z: -2.8, lean: 0.15, h: 1.1 },
    { x: -3.0, z: -0.5, lean: -0.25, h: 0.9 },
    { x: 0.5, z: 3.0, lean: 0.1, h: 1.15 },
    { x: -1.5, z: -2.5, lean: -0.15, h: 1.0 },
    { x: 3.2, z: -1.0, lean: 0.2, h: 0.95 },
  ];
  palmPositions.forEach(pp => {
    const palmG = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, pp.h, 5), mt(0x8a7050));
    trunk.position.y = pp.h / 2; palmG.add(trunk);
    // Fronds
    for (let f = 0; f < 5; f++) {
      const fa = (f / 5) * Math.PI * 2 + Math.random() * 0.4;
      const frond = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.5, 3), mt(0x4a9a38));
      frond.position.set(Math.cos(fa) * 0.12, pp.h - 0.05, Math.sin(fa) * 0.12);
      frond.rotation.z = Math.cos(fa) * 0.8;
      frond.rotation.x = Math.sin(fa) * 0.8;
      palmG.add(frond);
    }
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 5, 3), mt(0x3a8a2a));
    crown.position.y = pp.h + 0.02; crown.scale.y = 0.5; palmG.add(crown);
    palmG.position.set(pp.x, 0.3, pp.z);
    palmG.rotation.z = pp.lean;
    ti.add(palmG);
  });

  // ── Wooden crates and barrels ──
  [{ x: 1.0, z: -1.8 }, { x: -1.0, z: 1.5 }, { x: 2.2, z: -0.5 }].forEach(cp => {
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.12, 0.14), mt(0x8a6a40, { roughness: 0.9 }));
    crate.position.set(cp.x, 0.42, cp.z); ti.add(crate);
    // Iron bands
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.015, 0.15), mt(0x5a5a58));
    band.position.set(cp.x, 0.44, cp.z); ti.add(band);
  });
  [{ x: -2.0, z: -1.0 }, { x: 0.8, z: 2.0 }].forEach(bp => {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.16, 8), mt(0x7a5a38));
    barrel.position.set(bp.x, 0.43, bp.z); ti.add(barrel);
    const bBand = new THREE.Mesh(
      new THREE.TorusGeometry(0.062, 0.006, 4, 8), mt(0x5a5a58));
    bBand.position.set(bp.x, 0.45, bp.z); bBand.rotation.x = Math.PI / 2; ti.add(bBand);
  });

  // ── Rowboat on beach ──
  const rowboat = new THREE.Group();
  const rbHull = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.3), mt(0x8a6a40));
  rbHull.position.y = 0.02; rowboat.add(rbHull);
  const rbBow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.08, 4), mt(0x8a6a40));
  rbBow.position.set(0, 0.02, 0.18); rbBow.rotation.x = Math.PI / 2; rowboat.add(rbBow);
  rowboat.position.set(3.0, 0.28, 0.5); rowboat.rotation.y = 0.8; ti.add(rowboat);

  // ── Tattered flag on pole ──
  const flagP = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.0, 4), mt(0x6a4a2a));
  flagP.position.set(-2.8, 0.85, 1.0); ti.add(flagP);
  const tFlag = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.15),
    mt(0x3a3a3a, { side: THREE.DoubleSide }));
  tFlag.position.set(-2.65, 1.25, 1.0); ti.add(tFlag);
  const fSkull2 = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0xf0f0f0));
  fSkull2.position.set(-2.65, 1.27, 1.02); ti.add(fSkull2);

  // ── Cave entrance in rocky rise ──
  const caveRock = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 6, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    mt(0x8a8070, { roughness: 0.95 }));
  caveRock.position.set(-2.5, 0.32, -1.5); caveRock.scale.set(1.2, 0.8, 1.0); ti.add(caveRock);
  const caveHole = new THREE.Mesh(new THREE.CircleGeometry(0.15, 8),
    new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
  caveHole.position.set(-2.15, 0.38, -1.5); caveHole.rotation.y = Math.PI / 2; ti.add(caveHole);

  // ── Scattered gold coins on sand ──
  for (let gc = 0; gc < 15; gc++) {
    const ga = Math.random() * Math.PI * 2;
    const gr = 1.0 + Math.random() * 2.2;
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.005, 6),
      mt(GOLD_L, { roughness: 0.15, metalness: 0.9 }));
    coin.position.set(Math.cos(ga) * gr, 0.36, Math.sin(ga) * gr);
    coin.rotation.x = Math.random() * 0.3;
    coin.rotation.z = Math.random() * Math.PI; ti.add(coin);
  }

  // ── Shallow turquoise water ring ──
  const shallowWater = new THREE.Mesh(
    new THREE.TorusGeometry(TI_R + 1.0, 0.8, 6, 24),
    mt(0x40c8c0, { transparent: true, opacity: 0.25, roughness: 0.1 }));
  shallowWater.rotation.x = -Math.PI / 2; shallowWater.position.y = -0.15; ti.add(shallowWater);

  // ── Fill light for the island ──
  // [perf] removed: const tiFill = new THREE.PointLight(0xf0d080, 0.4, 10);
  // [perf] removed: tiFill.position.set(0, 1.5, 0); ti.add(tiFill);

  // ── Skull Rock formation ──
  const skullRock = new THREE.Group();
  skullRock.position.set(2.5, 0.3, 0.5);
  const skullHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 6, 5), mt(0xd0e8f0, { roughness: 0.9 }));
  skullHead.scale.set(1, 0.85, 0.8); skullRock.add(skullHead);
  for (const sx of [-0.15, 0.15]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0x101010 }));
    eye.position.set(sx, 0.08, 0.38); skullRock.add(eye);
    const eyeGlow = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3),
      mt(0x40c0ff, { emissive: 0x20a0e0, emissiveIntensity: 0.8 }));
    eyeGlow.position.set(sx, 0.08, 0.35); skullRock.add(eyeGlow);
    animatedObjects.push({ type: "blink", mesh: eyeGlow, speed: 1.5, phase: sx });
  }
  const skNose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 3),
    new THREE.MeshBasicMaterial({ color: 0x181818 }));
  skNose.position.set(0, -0.02, 0.42); skNose.rotation.x = Math.PI; skullRock.add(skNose);
  const skJaw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.15), mt(0xc8e0e8));
  skJaw.position.set(0, -0.2, 0.3); skullRock.add(skJaw);
  for (let t = 0; t < 5; t++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.02), mt(0xd8f0f0));
    tooth.position.set(-0.1 + t * 0.05, -0.16, 0.38); skullRock.add(tooth);
  }
  ti.add(skullRock);

  // ── Gold Castle (with lava moat + giant diamond) ──
  const castle = new THREE.Group();
  castle.position.set(-0.3, 0.4, -0.3);

  // Main keep — taller
  const keep = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.65, 1.4, 8), mt(GOLD, { roughness: 0.3, metalness: 0.7 }));
  keep.position.y = 0.7; keep.castShadow = true; castle.add(keep);

  // Keep battlements
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const merlon = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.15, 0.08), mt(GOLD, { roughness: 0.3, metalness: 0.7 }));
    merlon.position.set(Math.cos(a) * 0.53, 1.47, Math.sin(a) * 0.53);
    merlon.rotation.y = a; castle.add(merlon);
  }

  // Conical roof
  const keepRoof = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 0.6, 8), mt(GOLD_L, { roughness: 0.2, metalness: 0.8 }));
  keepRoof.position.y = 1.75; castle.add(keepRoof);

  // Giant floating diamond above castle
  const megaDiamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0),
    mt(DIAMOND, { roughness: 0.02, metalness: 0.4, transparent: true, opacity: 0.8 }));
  megaDiamond.position.set(0, 2.5, 0); castle.add(megaDiamond);
  animatedObjects.push({ type: "spin", mesh: megaDiamond, speed: 0.6, axis: "y" });
  // [perf] removed: const dmdLight = new THREE.PointLight(0xffd040, 1.2, 8);
  // [perf] removed: dmdLight.position.set(-0.3, 2.9, -0.3); ti.add(dmdLight);
  // [perf] removed: animatedObjects.push({ type: "lightFlicker", light: dmdLight, baseIntensity: 1.5, phase: 0 });

  // Pirate flag (black with skull)
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 3), mt(GOLD_D));
  flagPole.position.y = 2.1; castle.add(flagPole);
  const tiFlag = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), mt(0x3a3a3a));
  tiFlag.position.set(0.1, 2.3, 0); castle.add(tiFlag);
  const fSkull = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0xf0f0f0));
  fSkull.position.set(0.1, 2.32, 0.01); castle.add(fSkull);

  // Corner towers with torches
  const twrAngles = [0.4, Math.PI * 0.5 + 0.4, Math.PI + 0.4, Math.PI * 1.5 + 0.4];
  twrAngles.forEach(a => {
    const tx = Math.cos(a) * 1.0, tz = Math.sin(a) * 1.0;
    const twr = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.25, 1.0, 6), mt(GOLD, { roughness: 0.35, metalness: 0.65 }));
    twr.position.set(tx, 0.5, tz); twr.castShadow = true; castle.add(twr);
    const tRoof = new THREE.Mesh(
      new THREE.ConeGeometry(0.25, 0.35, 6), mt(GOLD_L, { roughness: 0.2, metalness: 0.8 }));
    tRoof.position.set(tx, 1.15, tz); castle.add(tRoof);
    const tFlame = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3),
      mt(0xffaa30, { emissive: 0xff6600, emissiveIntensity: 1.0 }));
    tFlame.position.set(tx * 1.2, 1.0, tz * 1.2); castle.add(tFlame);
    animatedObjects.push({ type: "flicker", mesh: tFlame, baseScaleY: 1, baseScaleX: 1, phase: a });
  });

  // Castle walls
  for (let i = 0; i < twrAngles.length; i++) {
    const a1 = twrAngles[i], a2 = twrAngles[(i + 1) % twrAngles.length];
    const x1 = Math.cos(a1) * 1.0, z1 = Math.sin(a1) * 1.0;
    const x2 = Math.cos(a2) * 1.0, z2 = Math.sin(a2) * 1.0;
    const wLen = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
    const wAng = Math.atan2(z2 - z1, x2 - x1);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(wLen, 0.55, 0.1), mt(GOLD_D, { roughness: 0.4, metalness: 0.5 }));
    wall.position.set((x1 + x2) / 2, 0.32, (z1 + z2) / 2);
    wall.rotation.y = -wAng; castle.add(wall);
  }

  // Lava moat around castle
  const moat = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.15, 6, 16),
    mt(0xff4400, { emissive: 0xff2200, emissiveIntensity: 0.6 }));
  moat.rotation.x = -Math.PI / 2; moat.position.y = 0.02; castle.add(moat);
  // [perf] removed: const moatGlow = new THREE.PointLight(0xff4400, 0.8, 4);
  // [perf] removed: moatGlow.position.set(0, 0.1, 0); castle.add(moatGlow);
  // [perf] removed: animatedObjects.push({ type: "lightFlicker", light: moatGlow, baseIntensity: 0.8, phase: 2 });

  ti.add(castle);

  // ── Big Pirate Ship ──
  const ship = new THREE.Group();
  ship.position.set(4.5, -0.15, -3.5); ship.rotation.y = -0.8;
  const HULL_W = 1.4, HULL_H = 0.6, HULL_L = 3.5;
  const hullMat = mt(0x7a5838, { roughness: 0.95 });
  const hullDarkMat = mt(0x5a4528, { roughness: 0.95 });

  // Main hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(HULL_W, HULL_H, HULL_L), hullMat);
  hull.position.y = 0.3; ship.add(hull);

  // Hull bottom keel
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, HULL_L - 0.3), hullDarkMat);
  keel.position.y = -0.05; ship.add(keel);

  // Bow (pointed front)
  const bowGeo = new THREE.ConeGeometry(HULL_W * 0.55, 1.2, 4);
  const shipBow = new THREE.Mesh(bowGeo, hullMat);
  shipBow.position.set(0, 0.3, HULL_L / 2 + 0.5); shipBow.rotation.x = Math.PI / 2;
  ship.add(shipBow);

  // Bowsprit (front pole)
  const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 2.0, 6), mt(0x6a4830));
  bowsprit.position.set(0, 0.5, HULL_L / 2 + 1.2); bowsprit.rotation.x = Math.PI / 2 - 0.25;
  ship.add(bowsprit);

  // Figurehead (gold skull at bow)
  const figHead = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), mt(GOLD));
  figHead.position.set(0, 0.35, HULL_L / 2 + 1.8); figHead.scale.set(1, 1.1, 1);
  ship.add(figHead);

  // Stern (raised back section)
  const sternBlock = new THREE.Mesh(new THREE.BoxGeometry(HULL_W + 0.1, 0.9, 1.0), hullMat);
  sternBlock.position.set(0, 0.55, -HULL_L / 2 + 0.3); ship.add(sternBlock);
  const sternTop = new THREE.Mesh(new THREE.BoxGeometry(HULL_W + 0.15, 0.08, 1.1), mt(0x6a4830));
  sternTop.position.set(0, 1.0, -HULL_L / 2 + 0.3); ship.add(sternTop);

  // Stern windows (gold trim)
  for (let sw = -1; sw <= 1; sw++) {
    const sWin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.02), mt(GOLD, { emissive: GOLD, emissiveIntensity: 0.3 }));
    sWin.position.set(sw * 0.3, 0.65, -HULL_L / 2 - 0.2); ship.add(sWin);
  }

  // Captain's cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(HULL_W - 0.2, 0.5, 0.8), mt(0x6a4830));
  cabin.position.set(0, 0.85, -HULL_L / 2 + 0.4); ship.add(cabin);
  const cabinRoof = new THREE.Mesh(new THREE.BoxGeometry(HULL_W - 0.1, 0.06, 0.9), hullDarkMat);
  cabinRoof.position.set(0, 1.12, -HULL_L / 2 + 0.4); ship.add(cabinRoof);

  // Deck planks
  const sDeck = new THREE.Mesh(new THREE.BoxGeometry(HULL_W - 0.05, 0.04, HULL_L - 0.2), mt(0xc4a870));
  sDeck.position.y = 0.62; ship.add(sDeck);

  // Deck rails (port and starboard)
  for (let side = -1; side <= 1; side += 2) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, HULL_L - 0.5), mt(0x6a4830));
    rail.position.set(side * HULL_W / 2, 0.73, 0); ship.add(rail);
    for (let rp = -3; rp <= 3; rp++) {
      const rPost = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mt(0x6a4830));
      rPost.position.set(side * HULL_W / 2, 0.75, rp * 0.45); ship.add(rPost);
    }
  }

  // ── Three masts with sails ──
  const mastDefs = [
    { z: HULL_L / 2 - 0.8, h: 2.8 },
    { z: 0.1, h: 3.5 },
    { z: -HULL_L / 2 + 1.0, h: 2.5 }
  ];
  const sailMat = mt(0xf5f0e0, { side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const blackSailMat = mt(0x505050, { side: THREE.DoubleSide });

  mastDefs.forEach((mp, mi) => {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, mp.h, 6), mt(0x6a4830));
    mast.position.set(0, 0.6 + mp.h / 2, mp.z); ship.add(mast);

    const numYards = mi === 1 ? 3 : 2;
    for (let yi = 0; yi < numYards; yi++) {
      const yardY = 0.6 + mp.h * 0.4 + yi * (mp.h * 0.25);
      const yardW = HULL_W * (1.1 - yi * 0.15);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, yardW, 4), mt(0x6a4830));
      yard.position.set(0, yardY, mp.z); yard.rotation.z = Math.PI / 2; ship.add(yard);

      const sailH = mp.h * 0.22;
      const sail = new THREE.Mesh(new THREE.PlaneGeometry(yardW * 0.85, sailH),
        mi === 1 && yi === 1 ? blackSailMat : sailMat);
      sail.position.set(0, yardY - sailH / 2 - 0.02, mp.z); ship.add(sail);
    }

    // Crow's nest on main mast
    if (mi === 1) {
      const nestY = 0.6 + mp.h * 0.85;
      const nestBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.08, 8), mt(0x6a4830));
      nestBase.position.set(0, nestY, mp.z); ship.add(nestBase);
      const nestRim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 4, 8), mt(0x6a4830));
      nestRim.position.set(0, nestY + 0.04, mp.z); nestRim.rotation.x = Math.PI / 2; ship.add(nestRim);
    }
  });

  // Pirate flag on main mast top
  const sFlagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 4), mt(0x6a4830));
  sFlagPole.position.set(0, 0.6 + 3.5 + 0.3, 0.1); ship.add(sFlagPole);
  const jollyRoger = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), blackSailMat);
  jollyRoger.position.set(0.27, 0.6 + 3.5 + 0.45, 0.1); ship.add(jollyRoger);
  const skullIcon = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), mt(0xffffff));
  skullIcon.position.set(0.27, 0.6 + 3.5 + 0.47, 0.12); ship.add(skullIcon);

  // ── Cannons (3 per side) ──
  for (let side = -1; side <= 1; side += 2) {
    for (let ci = 0; ci < 3; ci++) {
      const cannon = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.35, 6), mt(0x5a5a5a));
      barrel.rotation.z = Math.PI / 2; barrel.position.x = side * 0.1; cannon.add(barrel);
      const cBase = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.12), mt(0x5a3820));
      cBase.position.y = -0.04; cannon.add(cBase);
      cannon.position.set(side * HULL_W / 2, 0.68, -0.6 + ci * 0.6);
      cannon.rotation.y = side * Math.PI / 2; ship.add(cannon);
    }
  }

  // ── Anchor ──
  const anchorGrp = new THREE.Group();
  const anchorRing = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 4, 8), mt(0x555555));
  anchorRing.position.y = 0.08; anchorGrp.add(anchorRing);
  const anchorShank = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mt(0x555555));
  anchorShank.position.y = -0.08; anchorGrp.add(anchorShank);
  const anchorArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.025), mt(0x555555));
  anchorArm.position.y = -0.22; anchorGrp.add(anchorArm);
  anchorGrp.position.set(HULL_W / 2 + 0.05, 0.15, HULL_L / 2 - 0.3);
  ship.add(anchorGrp);

  // ── Ship wheel at stern ──
  const sWheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 6, 8), mt(0x6a4830));
  sWheel.position.set(0, 1.25, -HULL_L / 2 + 0.9); sWheel.rotation.x = Math.PI * 0.25;
  ship.add(sWheel);
  for (let sp = 0; sp < 6; sp++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 3), mt(0x6a4830));
    spoke.rotation.z = sp * Math.PI / 3;
    spoke.position.copy(sWheel.position); ship.add(spoke);
  }

  // ── Lanterns on stern ──
  for (let ls = -1; ls <= 1; ls += 2) {
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4),
      mt(0xffaa00, { emissive: 0xffaa00, emissiveIntensity: 0.5, transparent: true, opacity: 0.8 }));
    lantern.position.set(ls * 0.5, 1.05, -HULL_L / 2 - 0.15); ship.add(lantern);
    const lLight = new THREE.PointLight(0xffaa00, 0.4, 3);
    lLight.position.copy(lantern.position); ship.add(lLight);
    animatedObjects.push({ type: "lightFlicker", light: lLight, baseIntensity: 0.4, phase: ls * 2 });
  }

  // ── Hull waterline stripe ──
  const waterline = new THREE.Mesh(new THREE.BoxGeometry(HULL_W + 0.02, 0.06, HULL_L + 0.02), mt(0x8b0000));
  waterline.position.y = 0.08; ship.add(waterline);

  // ── Wake foam ──
  const shipWake = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.6),
    mt(0xffffff, { transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
  shipWake.rotation.x = -Math.PI / 2; shipWake.position.set(0, -0.05, -HULL_L / 2 - 0.8);
  ship.add(shipWake);

  ti.add(ship);
  animatedObjects.push({ type: "bob", mesh: ship, speed: 0.25, baseY: -0.15, amp: 0.04, phase: 1.5 });

  // ── Dragon skeleton ──
  const dragon = new THREE.Group();
  dragon.position.set(-1.0, 0.38, 1.8); dragon.rotation.y = -0.5;
  for (let s = 0; s < 8; s++) {
    const vert = new THREE.Mesh(new THREE.SphereGeometry(0.025 - s * 0.002, 4, 3), mt(0xe0d8c8));
    vert.position.set(0, 0.02, s * 0.07); dragon.add(vert);
  }
  const dSkull = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.1), mt(0xe0d8c8));
  dSkull.position.set(0, 0.04, -0.05); dragon.add(dSkull);
  for (const hx of [-0.04, 0.04]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.05, 3), mt(0xd0c8b0));
    horn.position.set(hx, 0.08, -0.03); horn.rotation.z = hx > 0 ? 0.3 : -0.3; dragon.add(horn);
  }
  for (let r = 0; r < 4; r++) {
    for (const side of [-1, 1]) {
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 3), mt(0xd8d0c0));
      rib.position.set(side * 0.04, 0.01, 0.05 + r * 0.08);
      rib.rotation.z = side * 0.8; dragon.add(rib);
    }
  }
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.003, 0.2, 3), mt(0xd0c8b0));
    wing.position.set(side * 0.08, 0.05, 0.15);
    wing.rotation.z = side * 1.2; wing.rotation.x = -0.3; dragon.add(wing);
  }
  ti.add(dragon);

  // ── Treasure map table ──
  const mapTable = new THREE.Group();
  mapTable.position.set(1.2, 0.35, 1.5);
  for (const [lx, lz] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.12, 3), mt(0x5a3a1a));
    leg.position.set(lx, 0.06, lz); mapTable.add(leg);
  }
  const tTop2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.01, 0.14), mt(0x6a4a2a));
  tTop2.position.y = 0.125; mapTable.add(tTop2);
  const mapScroll = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.08), mt(0xe8d8a0));
  mapScroll.position.set(0, 0.135, 0); mapScroll.rotation.x = -Math.PI / 2; mapTable.add(mapScroll);
  ti.add(mapTable);

  // ── Torch-lit path ──
  [[2.0, -1.3], [1.0, -2.0], [-0.5, -2.2], [-1.8, -1.5], [2.5, 0.0], [-2.5, 0.5]].forEach(([tx, tz], idx) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.35, 4), mt(0x5a3a1a));
    pole.position.set(tx, 0.52, tz); ti.add(pole);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 4, 3),
      mt(0xffaa30, { emissive: 0xff6600, emissiveIntensity: 1.0 }));
    flame.position.set(tx, 0.72, tz); ti.add(flame);
    animatedObjects.push({ type: "flicker", mesh: flame, baseScaleY: 1, baseScaleX: 1, phase: idx * 1.1 });
  });

  // ── "X marks the spot" ──
  for (const [dx, dz] of [[0.03, 0.03], [-0.03, -0.03]]) {
    const xMark = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.005, 0.02), mt(0xc02020));
    xMark.position.set(-1.8 + dx, 0.36, -1.5 + dz);
    xMark.rotation.y = dx > 0 ? 0.75 : -0.75; ti.add(xMark);
  }

  // ── Gold piles (more, scattered) ──
  const goldSpots = [[1.5, 0.5, 0.3], [-1.2, 1.0, 0.35], [0.8, -1.5, 0.25], [-1.5, -0.8, 0.22],
   [1.8, -0.5, 0.2], [0.3, 1.8, 0.28], [-0.8, -1.8, 0.18]];
  goldSpots.forEach(([gx, gz, sz]) => {
    const heap = new THREE.Mesh(
      new THREE.SphereGeometry(sz, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(GOLD, { roughness: 0.25, metalness: 0.8 }));
    heap.position.set(gx, 0.35, gz); ti.add(heap);
    for (let c = 0; c < 5; c++) {
      const coin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.008, 6),
        mt(GOLD_L, { roughness: 0.15, metalness: 0.9 }));
      coin.position.set(
        gx + (Math.random() - 0.5) * sz * 0.8,
        0.35 + sz * 0.6 + Math.random() * sz * 0.3,
        gz + (Math.random() - 0.5) * sz * 0.8);
      coin.rotation.x = Math.random() * 0.5;
      coin.rotation.z = Math.random() * Math.PI;
      ti.add(coin);
    }
  });

  // ── Silver ingot stacks ──
  [[1.0, 1.2], [-0.5, -1.5], [2.0, 0.2]].forEach(([sx, sz]) => {
    for (let s = 0; s < 3; s++) {
      const ingot = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.04, 0.14),
        mt(SILVER, { roughness: 0.2, metalness: 0.85 }));
      ingot.position.set(sx + (s - 1) * 0.06, 0.37 + s * 0.04, sz);
      ingot.rotation.y = Math.random() * 0.3;
      ti.add(ingot);
    }
  });

  // ── Spinning diamond crystals ──
  [[1.6, 1.0], [-1.0, 0.5], [0.3, -1.8], [-1.8, -0.2], [0.5, 1.5]].forEach(([dx, dz]) => {
    const sz = 0.06 + Math.random() * 0.06;
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(sz, 0),
      mt(DIAMOND, { roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.85 }));
    gem.position.set(dx, 0.4 + sz, dz);
    gem.rotation.x = Math.random(); gem.rotation.z = Math.random();
    ti.add(gem);
    animatedObjects.push({ type: "spin", mesh: gem, speed: 0.8 + Math.random() * 0.5, axis: "y" });
  });

  // ── Treasure chests (open, coins spilling out) ──
  [[1.8, 1.2, 0.3], [-1.6, 0.3, -0.5], [0.2, 1.8, Math.PI * 0.7]].forEach(([cx, cz, ry]) => {
    const chest = new THREE.Group();
    const cBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.12, 0.14), mt(0x6a3a1a, { roughness: 0.8 }));
    cBox.position.y = 0.06; chest.add(cBox);
    for (const bz of [-0.04, 0.04]) {
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.015, 0.015), mt(GOLD_D, { roughness: 0.3, metalness: 0.7 }));
      band.position.set(0, 0.06, bz); chest.add(band);
    }
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.03, 0.14), mt(0x6a3a1a, { roughness: 0.8 }));
    lid.position.set(0, 0.14, -0.06); lid.rotation.x = -0.6; chest.add(lid);
    for (let g = 0; g < 4; g++) {
      const spill = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.005, 5),
        mt(GOLD_L, { roughness: 0.15, metalness: 0.9 }));
      spill.position.set((Math.random() - 0.5) * 0.18, 0.01 + Math.random() * 0.03, 0.1 + Math.random() * 0.06);
      spill.rotation.x = Math.PI / 2 + Math.random() * 0.5;
      chest.add(spill);
    }
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.08, 0.1),
      mt(GOLD_L, { emissive: GOLD, emissiveIntensity: 0.4 }));
    glow.position.y = 0.08; chest.add(glow);
    chest.position.set(cx, 0.35, cz); chest.rotation.y = ry;
    ti.add(chest);
  });

  // ── Ruby, emerald, amethyst gems ──
  [
    { pos: [-0.8, 1.3], color: 0xff2040, sz: 0.05 },
    { pos: [1.2, -1.0], color: 0x20d060, sz: 0.06 },
    { pos: [-1.5, -1.2], color: 0xff2040, sz: 0.04 },
    { pos: [0.6, 1.6], color: 0x20d060, sz: 0.05 },
    { pos: [2.2, 0.6], color: 0xa020ff, sz: 0.05 },
  ].forEach(gd => {
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(gd.sz, 0), mt(gd.color, { roughness: 0.1, metalness: 0.2 }));
    gem.position.set(gd.pos[0], 0.42 + gd.sz, gd.pos[1]);
    ti.add(gem);
    animatedObjects.push({ type: "spin", mesh: gem, speed: 0.6 + Math.random() * 0.4, axis: "y" });
  });

  // ── Gold crown on pedestal ──
  const tiPed = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.2, 6), mt(0xf0f0f0, { roughness: 0.2, metalness: 0.5 }));
  tiPed.position.set(-0.3, 0.45, -0.8); ti.add(tiPed);
  const crownBand = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.015, 6, 8), mt(GOLD, { roughness: 0.15, metalness: 0.9 }));
  crownBand.position.set(-0.3, 0.58, -0.8);
  crownBand.rotation.x = Math.PI / 2; ti.add(crownBand);
  for (let i = 0; i < 5; i++) {
    const ca = (i / 5) * Math.PI * 2;
    const cp = new THREE.Mesh(
      new THREE.ConeGeometry(0.012, 0.04, 3), mt(GOLD_L, { roughness: 0.1, metalness: 0.9 }));
    cp.position.set(-0.3 + Math.cos(ca) * 0.05, 0.61, -0.8 + Math.sin(ca) * 0.05);
    ti.add(cp);
  }
  const crownJewel = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 5, 4), mt(0xff1040, { emissive: 0xff0020, emissiveIntensity: 0.5 }));
  crownJewel.position.set(-0.3, 0.62, -0.8); ti.add(crownJewel);

  // ── Floating gold dust particles ──
  for (let i = 0; i < 10; i++) {
    const gp = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 3, 2),
      new THREE.MeshBasicMaterial({ color: GOLD_L, transparent: true, opacity: 0.6 }));
    const gpx = (Math.random() - 0.5) * 4;
    const gpz = (Math.random() - 0.5) * 4;
    const gpy = 0.8 + Math.random() * 1.5;
    gp.position.set(TI_X + gpx, gpy, TI_Z + gpz);
    scene.add(gp);
    animatedObjects.push({
      type: "butterfly", mesh: gp,
      baseX: TI_X + gpx, baseZ: TI_Z + gpz, baseY: gpy,
      speed: 0.3 + Math.random() * 0.3, phase: Math.random() * Math.PI * 2,
      radius: 0.3 + Math.random() * 0.3,
    });
  }

  scene.add(ti);

  // ── Bridge connecting desert island to treasure island ──
  const DI_X = 5, DI_Z = -14;
  const tbAngle = Math.atan2(TI_Z - DI_Z, TI_X - DI_X);
  const tb1X = DI_X + Math.cos(tbAngle) * 4.0;
  const tb1Z = DI_Z + Math.sin(tbAngle) * 4.0;
  const tb2X = TI_X + Math.cos(tbAngle + Math.PI) * 3.2;
  const tb2Z = TI_Z + Math.sin(tbAngle + Math.PI) * 3.2;
  bridge5DesertEnd = { x: tb1X, z: tb1Z };
  bridge5TreasureEnd = { x: tb2X, z: tb2Z };

  scene.add(buildRopeBridge(tb1X, tb1Z, tb2X, tb2Z, { ropeColor: 0xb8a040, capColor: GOLD }));
}

/* ═══════════════════════════════════════════════════════════
   Hawaii Island — volcanic, tropical, palm trees, tiki torches
   ═══════════════════════════════════════════════════════════ */

function createHawaiiIsland() {
  const HI_X = -22, HI_Z = 18;
  const hi = new THREE.Group();
  hi.position.set(HI_X, 0, HI_Z);

  const LAVA_ROCK = 0x8a7a70;
  const TROP_G = 0x5aaa5a;
  const TROP_GD = 0x4a9a4a;
  const SAND_H = 0xe8d8a8;

  // ── Volcanic base — dark rocky cylinder ──
  const baseGeo = new THREE.CylinderGeometry(3.0, 4.0, 1.6, 16);
  const bP = baseGeo.attributes.position;
  for (let i = 0; i < bP.count; i++) {
    const x = bP.getX(i), z = bP.getZ(i), y = bP.getY(i);
    const a = Math.atan2(z, x);
    const w = 1 + Math.sin(a * 4) * 0.08 + Math.cos(a * 6) * 0.05;
    bP.setX(i, x * w); bP.setZ(i, z * w);
    if (y > 0.3) bP.setY(i, y + Math.sin(a * 5) * 0.1);
  }
  baseGeo.computeVertexNormals();
  const baseMesh = new THREE.Mesh(baseGeo, mt(LAVA_ROCK, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.15 }));
  baseMesh.position.y = -0.5; hi.add(baseMesh);

  // ── Sandy beach ring ──
  const beachGeo = new THREE.CylinderGeometry(4.2, 4.5, 0.1, 16);
  const beP = beachGeo.attributes.position;
  for (let i = 0; i < beP.count; i++) {
    const x = beP.getX(i), z = beP.getZ(i);
    const a = Math.atan2(z, x);
    beP.setX(i, x * (1 + Math.sin(a * 4) * 0.06));
    beP.setZ(i, z * (1 + Math.cos(a * 6) * 0.04));
  }
  beachGeo.computeVertexNormals();
  const beachMesh = new THREE.Mesh(beachGeo, mt(SAND_H, { roughness: 0.92, emissive: 0x504030, emissiveIntensity: 0.1 }));
  beachMesh.position.y = -0.35; hi.add(beachMesh);

  // ── Lush green top ──
  const topGeo2 = new THREE.CylinderGeometry(3.1, 3.1, 0.1, 16);
  const toP = topGeo2.attributes.position;
  for (let i = 0; i < toP.count; i++) {
    const x = toP.getX(i), z = toP.getZ(i);
    const a = Math.atan2(z, x);
    toP.setX(i, x * (1 + Math.sin(a * 4) * 0.06));
    toP.setZ(i, z * (1 + Math.cos(a * 6) * 0.04));
  }
  topGeo2.computeVertexNormals();
  const topM2 = new THREE.Mesh(topGeo2, mt(TROP_G, { emissive: 0x304020, emissiveIntensity: 0.15 }));
  topM2.position.y = 0.35; hi.add(topM2);

  // ── Volcanic peak — cone with crater ──
  const peak = new THREE.Mesh(
    new THREE.ConeGeometry(1.2, 2.0, 8), mt(0x8a7a68, { roughness: 0.9, emissive: 0x504030, emissiveIntensity: 0.15 }));
  peak.position.set(0.5, 1.3, -0.5); peak.castShadow = true; hi.add(peak);
  // Crater rim
  const craterRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.12, 6, 8), mt(0x9a8a80));
  craterRim.position.set(0.5, 2.3, -0.5); craterRim.rotation.x = Math.PI / 2; hi.add(craterRim);
  // Lava glow
  const lavaGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.35, 8),
    mt(0xff4400, { emissive: 0xff2200, emissiveIntensity: 0.8 }));
  lavaGlow.position.set(0.5, 2.28, -0.5); lavaGlow.rotation.x = -Math.PI / 2; hi.add(lavaGlow);
  // Smoke wisps
  for (let i = 0; i < 3; i++) {
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(0.15 + i * 0.08, 5, 4),
      mt(0xcccccc, { transparent: true, opacity: 0.25 }));
    smoke.position.set(0.5 + (i - 1) * 0.15, 2.5 + i * 0.3, -0.5);
    hi.add(smoke);
    animatedObjects.push({ type: "bob", mesh: smoke, speed: 0.3 + i * 0.1,
      baseY: 2.5 + i * 0.3, amp: 0.1, phase: i * 2 });
  }

  // ── Palm trees ──
  function makePalm(px, py, pz, h, lean) {
    const pg = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.1, h, 5), mt(0x8a7050));
    trunk.position.y = h / 2; pg.add(trunk);
    for (let f = 0; f < 7; f++) {
      const frond = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.15),
        mt(f % 2 === 0 ? TROP_G : TROP_GD));
      frond.material.side = THREE.DoubleSide;
      frond.position.set(0, h - 0.05, 0);
      frond.rotation.set(-0.4 - Math.random() * 0.3, (f / 7) * Math.PI * 2, 0);
      pg.add(frond);
    }
    for (let c = 0; c < 2; c++) {
      const coco = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 4, 3), mt(0x6a5030));
      coco.position.set(0.05 * (c * 2 - 1), h - 0.15, 0.04); pg.add(coco);
    }
    pg.position.set(px, py, pz); pg.rotation.z = lean;
    return pg;
  }
  [[-2.2, 0.3, 1.5, 1.6, 0.15], [2.0, 0.3, 1.8, 1.4, -0.1],
   [-1.5, 0.3, -1.2, 1.8, 0.08], [1.8, 0.3, -0.3, 1.3, -0.2],
   [-0.8, 0.3, 2.0, 1.5, 0.12], [2.5, 0.3, 0.8, 1.2, -0.15],
   [-2.5, 0.3, 0.0, 1.4, 0.1],
  ].forEach(([px, py, pz, h, lean]) => hi.add(makePalm(px, py, pz, h, lean)));

  // ── Thatched huts ──
  [{ x: -1.0, z: 0.8, w: 0.7, d: 0.6, h: 0.5, ry: 0.2 },
   { x: 0.8, z: 1.2, w: 0.6, d: 0.5, h: 0.45, ry: -0.3 },
   { x: -1.8, z: -0.2, w: 0.55, d: 0.5, h: 0.4, ry: 0.5 },
   { x: 1.5, z: 0.0, w: 0.5, d: 0.45, h: 0.4, ry: -0.1 },
  ].forEach((h) => {
    const hg = new THREE.Group();
    hg.position.set(h.x, 0.3, h.z); hg.rotation.y = h.ry;
    const walls = new THREE.Mesh(new THREE.BoxGeometry(h.w, h.h, h.d), mt(WOOD_D));
    walls.position.y = h.h / 2; walls.castShadow = true; hg.add(walls);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(h.w, h.d) * 0.75, h.h * 0.7, 4), mt(0x9a8a50));
    roof.position.y = h.h + h.h * 0.35; roof.rotation.y = Math.PI / 4;
    roof.castShadow = true; hg.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(h.w * 0.25, h.h * 0.55, 0.02), mt(0x605850));
    door.position.set(0, h.h * 0.27, h.d / 2 + 0.01); hg.add(door);
    hi.add(hg);
  });

  // ── Tiki torches ──
  for (const [tx, tz] of [[-0.5, 1.5], [0.3, 1.6], [-1.5, 0.5], [1.2, 0.6]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.8, 4), mt(WOOD_D));
    pole.position.set(tx, 0.7, tz); hi.add(pole);
    const tfl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 3),
      mt(0xff6600, { emissive: 0xff4400, emissiveIntensity: 1.2 }));
    tfl.position.set(tx, 1.15, tz); hi.add(tfl);
  }

  // ── Waterfall on volcano slope ──
  const wf = new THREE.Mesh(
    new THREE.PlaneGeometry(0.25, 1.2),
    mt(0x70b8d8, { transparent: true, opacity: 0.6 }));
  wf.material.side = THREE.DoubleSide;
  wf.position.set(-0.3, 1.0, -0.8); wf.rotation.y = 0.3; hi.add(wf);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 8), mt(0x60a8c8, { transparent: true, opacity: 0.7 }));
  pool.position.set(-0.3, 0.35, -0.3); pool.rotation.x = -Math.PI / 2; hi.add(pool);

  // ── Tropical flowers ──
  const flowerColors = [0xff3060, 0xff8030, 0xffdd00, 0xff50a0];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 1.8 + Math.sin(i * 3) * 0.5;
    const fl = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 4, 3), mt(flowerColors[i % 4]));
    fl.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r);
    fl.scale.set(1.2, 0.5, 1.0); hi.add(fl);
  }

  // ── Outrigger canoe ──
  const canoe = new THREE.Group();
  const cAng = Math.atan2(HI_Z, HI_X) + Math.PI;
  canoe.position.set(Math.cos(cAng) * 3.5, -0.08, Math.sin(cAng) * 2.8);
  canoe.rotation.y = -cAng + 0.2;
  const cHull = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.3), mt(0x8a5030));
  cHull.position.y = 0.015; canoe.add(cHull);
  const cBow = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.06, 4), mt(0x8a5030));
  cBow.position.set(0, 0.015, 0.18); cBow.rotation.x = Math.PI / 2; canoe.add(cBow);
  const outrig = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 4), mt(WOOD_D));
  outrig.position.set(0.15, 0.01, 0); outrig.rotation.x = Math.PI / 2; canoe.add(outrig);
  for (const oz of [-0.06, 0.06]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.008, 0.012), mt(WOOD_D));
    beam.position.set(0.07, 0.025, oz); canoe.add(beam);
  }
  hi.add(canoe);
  animatedObjects.push({ type: "bob", mesh: canoe, speed: 0.4, baseY: -0.08, amp: 0.012, phase: 5 });

  // ── Jet skis with riders ──
  const jetskiDefs = [
    { cx: HI_X + 1, cz: HI_Z + 4.5, radius: 2.5, speed: 0.5, phase: 0, color: 0xe04040 },
    { cx: HI_X - 3, cz: HI_Z + 3.5, radius: 2.0, speed: 0.6, phase: Math.PI * 0.7, color: 0x3080d0 },
    { cx: HI_X + 2, cz: HI_Z - 3.0, radius: 1.8, speed: 0.55, phase: Math.PI * 1.4, color: 0xf0c020 },
  ];
  jetskiDefs.forEach(jd => {
    const js = new THREE.Group();
    // Hull — sleek wedge shape
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.05, 0.32), mt(jd.color));
    hull.position.y = 0.02; js.add(hull);
    // Nose (tapered front)
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.12, 4), mt(jd.color));
    nose.position.set(0, 0.02, 0.2); nose.rotation.x = Math.PI / 2; js.add(nose);
    // Seat
    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.03, 0.12), mt(0x505050));
    seat.position.set(0, 0.06, -0.02); js.add(seat);
    // Handlebar
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.01, 0.01), mt(METAL));
    bar.position.set(0, 0.1, 0.06); js.add(bar);

    // Rider — simple person
    // Body/torso
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.1, 0.05), mt(0xf0d0a0));
    torso.position.set(0, 0.14, -0.02); js.add(torso);
    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 5, 4), mt(0xf0c8a0));
    head.position.set(0, 0.22, -0.01); js.add(head);
    // Arms reaching to handlebars
    for (const side of [-0.04, 0.04]) {
      const arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.07, 0.015), mt(0xf0d0a0));
      arm.position.set(side, 0.14, 0.03);
      arm.rotation.x = -0.5;
      js.add(arm);
    }

    // Wake spray (white splash behind)
    const wake = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.15, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }));
    wake.position.set(0, 0.01, -0.22);
    wake.rotation.x = -Math.PI / 2;
    wake.scale.set(1.5, 1, 0.4);
    js.add(wake);

    js.position.set(jd.cx, -0.08, jd.cz);
    scene.add(js);
    animatedObjects.push({
      type: "jetski", mesh: js,
      cx: jd.cx, cz: jd.cz, radius: jd.radius,
      speed: jd.speed, phase: jd.phase,
    });
  });

  // ── Sea turtles swimming around island ──
  for (let st = 0; st < 3; st++) {
    const turtle = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), mt(0x3a6e3a));
    shell.scale.set(1, 0.5, 1.2); shell.position.y = 0.05; turtle.add(shell);
    const tHead = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), mt(0x4a7a4a));
    tHead.position.set(0, 0.04, 0.15); turtle.add(tHead);
    for (const fx of [-0.1, 0.1]) {
      for (const fz of [0.06, -0.06]) {
        const flipper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.05), mt(0x3a6e3a));
        flipper.position.set(fx, 0.02, fz); flipper.rotation.z = fx > 0 ? -0.3 : 0.3; turtle.add(flipper);
      }
    }
    const ta = st * Math.PI * 2 / 3;
    turtle.position.set(HI_X + Math.cos(ta) * 4.5, -0.1, HI_Z + Math.sin(ta) * 4.5);
    scene.add(turtle);
    animatedObjects.push({
      type: "jetski", mesh: turtle,
      cx: HI_X + Math.cos(ta) * 1, cz: HI_Z + Math.sin(ta) * 1,
      radius: 4.0 + st * 0.5, speed: 0.08 + st * 0.02, phase: ta,
    });
  }

  // ── Surfboard rack on beach ──
  const surfRack = new THREE.Group();
  const srPost1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4), mt(0x8a6a3a));
  srPost1.position.set(-0.15, 0.2, 0); surfRack.add(srPost1);
  const srPost2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4), mt(0x8a6a3a));
  srPost2.position.set(0.15, 0.2, 0); surfRack.add(srPost2);
  const srBar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.35, 4), mt(0x8a6a3a));
  srBar1.position.set(0, 0.3, 0); srBar1.rotation.z = Math.PI / 2; surfRack.add(srBar1);
  const boardColors = [0xe04040, 0x30a0d0, 0xf0e020];
  boardColors.forEach((bc, bi) => {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.12), mt(bc));
    board.position.set(-0.08 + bi * 0.08, 0.25, 0.02);
    board.rotation.z = 0.15 - bi * 0.05;
    surfRack.add(board);
  });
  surfRack.position.set(2.5, 0.05, 1.5);
  hi.add(surfRack);

  // ── Tiki bar ──
  const tikiBar = new THREE.Group();
  const barCounter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.25), mt(0x8a6a3a));
  barCounter.position.y = 0.2; tikiBar.add(barCounter);
  const barTop = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.02, 0.3), mt(0x6a4a2a));
  barTop.position.y = 0.31; tikiBar.add(barTop);
  // Thatched roof over bar
  const barRoof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.25, 6), mt(0xb89a5a));
  barRoof.position.y = 0.65; tikiBar.add(barRoof);
  for (const px of [-0.25, 0.25]) {
    const barPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 4), mt(0x8a6a3a));
    barPole.position.set(px, 0.38, -0.1); tikiBar.add(barPole);
  }
  // Drink cups on counter
  for (let d = 0; d < 3; d++) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 0.04, 5), mt(0xf08020));
    cup.position.set(-0.15 + d * 0.15, 0.33, 0); tikiBar.add(cup);
  }
  tikiBar.position.set(-2.0, 0.08, -1.0); tikiBar.rotation.y = 0.5;
  hi.add(tikiBar);

  // ── Luau fire dancer ──
  const dancer = new THREE.Group();
  const dBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.06), mt(0xc08050));
  dBody.position.y = 0.2; dancer.add(dBody);
  const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), mt(0xd0a070));
  dHead.position.y = 0.34; dancer.add(dHead);
  // Grass skirt
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.08, 8), mt(0x4a8a2a));
  skirt.position.y = 0.1; dancer.add(skirt);
  // Fire staff
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), mt(0x6a4a2a));
  staff.position.set(0, 0.28, 0); staff.rotation.z = Math.PI / 4; dancer.add(staff);
  const staffFlame1 = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4),
    mt(0xff6600, { emissive: 0xff4400, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 }));
  staffFlame1.position.set(0.18, 0.45, 0); dancer.add(staffFlame1);
  const staffFlame2 = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4),
    mt(0xff6600, { emissive: 0xff4400, emissiveIntensity: 0.8, transparent: true, opacity: 0.85 }));
  staffFlame2.position.set(-0.18, 0.11, 0); dancer.add(staffFlame2);
  dancer.position.set(0.5, 0.08, 2.0); dancer.rotation.y = -0.3;
  hi.add(dancer);
  animatedObjects.push({ type: "spin", mesh: dancer, speed: 1.5 });

  // ── Hammock between palms ──
  const hammock = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.15),
    mt(0xe04040, { side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  hammock.position.set(-1.0, 0.35, 1.8); hammock.rotation.x = -0.2; hammock.rotation.y = 0.8;
  hi.add(hammock);
  animatedObjects.push({ type: "bob", mesh: hammock, speed: 0.5, baseY: 0.35, amp: 0.02, phase: 0 });

  // ── Luau pig roast ──
  const roast = new THREE.Group();
  // Spit poles
  for (const sx of [-0.15, 0.15]) {
    const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.25, 4), mt(0x8a6a3a));
    spit.position.set(sx, 0.12, 0); roast.add(spit);
  }
  const spitBar = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.35, 4), mt(0x8a6a3a));
  spitBar.position.set(0, 0.22, 0); spitBar.rotation.z = Math.PI / 2; roast.add(spitBar);
  // Pig
  const pig = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), mt(0xc08060));
  pig.scale.set(1, 0.8, 1.3); pig.position.y = 0.2; roast.add(pig);
  // Fire underneath
  const roastFire = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.1, 5),
    mt(0xff5500, { emissive: 0xff3300, emissiveIntensity: 0.7, transparent: true, opacity: 0.7 }));
  roastFire.position.y = 0.05; roast.add(roastFire);
  roast.position.set(1.5, 0.08, 0.5);
  hi.add(roast);

  scene.add(hi);

  // ── Bridge to main island ──
  const hiBridgeAngle = Math.atan2(HI_Z, HI_X);
  const hiMainEdge = getIslandRadius(hiBridgeAngle);
  const hb1X = Math.cos(hiBridgeAngle) * (hiMainEdge - 1.0);
  const hb1Z = Math.sin(hiBridgeAngle) * (hiMainEdge - 1.0);
  const hb2X = HI_X + Math.cos(hiBridgeAngle + Math.PI) * 3.2;
  const hb2Z = HI_Z + Math.sin(hiBridgeAngle + Math.PI) * 3.2;
  bridge4MainEnd = { x: hb1X, z: hb1Z };
  bridge4IslandEnd = { x: hb2X, z: hb2Z };

  scene.add(buildRopeBridge(hb1X, hb1Z, hb2X, hb2Z, { baseY: 0.08, ropeColor: 0x8a7a5a }));

  // ── Agents ──
  const hiAgentConfigs = [
    { name: "Kahuna", body: 0xc07030, accent: 0xa06028, roof: 0x885020,
      home: [HI_X - 0.8, 0.5, HI_Z + 0.5], angle: Math.PI * 0.6 },
    { name: "Navigator", body: 0x3080a0, accent: 0x286890, roof: 0x205878,
      home: [HI_X + 0.5, 0.5, HI_Z + 0.8], angle: Math.PI * 1.1 },
  ];
  hiAgentConfigs.forEach((cfg, i) => {
    const agent = createAgent(cfg, i + 9);
    agent.useBridge4 = true;
    scene.add(agent.group);
    agents.push(agent);
  });

  // ── Bridge connecting Catalina (-18,-6) to Hawaii (-16,14) ──
  const catX = -18, catZ = -6;
  const chAng = Math.atan2(HI_Z - catZ, HI_X - catX);
  const ch1X = catX + Math.cos(chAng) * 2.0;
  const ch1Z = catZ + Math.sin(chAng) * 2.0;
  const ch2X = HI_X + Math.cos(chAng + Math.PI) * 2.8;
  const ch2Z = HI_Z + Math.sin(chAng + Math.PI) * 2.8;
  scene.add(buildRopeBridge(ch1X, ch1Z, ch2X, ch2Z, { baseY: 0.08, sag: 0.12 }));
}


/* ═══════════════════════════════════════════════════════════
   Jeju Island — Big Korean volcanic island
   ═══════════════════════════════════════════════════════════ */
function createJejuIsland() {
  const JJ_X = -36, JJ_Z = 30, JJ_R = 6.0;
  const jj = new THREE.Group();
  jj.position.set(JJ_X, 0, JJ_Z);

  // ── Irregular coastline radius ──
  function getJejuR(a) {
    let r = JJ_R;
    r += Math.sin(a * 2) * 0.6 + Math.cos(a * 3) * 0.35 + Math.sin(a * 5) * 0.15;
    const dS = Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI);
    if (dS < 0.6) r += (0.6 - dS) * 2.8;
    const dW = Math.abs(a - Math.PI);
    if (dW < 0.4) r -= (0.4 - dW) * 2.0;
    const dNE = Math.abs(a - 0.7);
    if (dNE < 0.3) r -= (0.3 - dNE) * 1.2;
    return r;
  }

  // ── Shield volcano height — broad gentle slopes (NOT steep cone) ──
  function getJejuH(x, z) {
    const d = Math.sqrt(x * x + z * z);
    // Broad shield shape: wide base, gentle rise
    const halla = Math.max(0, 1.0 - (d / 4.5) * (d / 4.5)) * 0.7;
    // Rolling hills
    const hills = Math.sin(x * 0.8 + 0.5) * 0.08 + Math.cos(z * 0.9) * 0.06
                + Math.sin(x * 1.6 + z * 1.2) * 0.04;
    const eastPlat = x > 2 ? Math.max(0, 0.12 - Math.abs(z) * 0.03) : 0;
    const southRidge = z < -1 ? Math.max(0, 0.15 * (1 - Math.abs(x) / 3)) : 0;
    return halla + hills + eastPlat + southRidge;
  }

  // ── Displaced terrain mesh — GREEN over dark basalt ──
  const jjRes = 80;
  const jjGeo = new THREE.PlaneGeometry(JJ_R * 2.8, JJ_R * 2.8, jjRes, jjRes);
  jjGeo.rotateX(-Math.PI / 2);
  const jjPos = jjGeo.attributes.position;
  const jjColors = new Float32Array(jjPos.count * 3);
  // GREEN palette — not purple/maroon
  const GRASS_JJ = new THREE.Color(0x6FBF4A), DARK_JJ = new THREE.Color(0x65B545);
  const VOLCANIC_JJ = new THREE.Color(0x80A870), SAND_JJ = new THREE.Color(0xf5e8c8);
  const BLACK_SAND = new THREE.Color(0x9A9890);
  const BASALT_JJ = new THREE.Color(0xAAA898);

  for (let i = 0; i < jjPos.count; i++) {
    const x = jjPos.getX(i), z = jjPos.getZ(i);
    const a = Math.atan2(z, x);
    const d = Math.sqrt(x * x + z * z);
    const edgeR = getJejuR(a);
    const edgeFade = 1 - smoothstep(edgeR - 2.0, edgeR, d);
    if (d > edgeR + 0.3) { jjPos.setY(i, -0.5); }
    else if (d > edgeR - 0.3) {
      const beachT = smoothstep(edgeR - 0.3, edgeR + 0.3, d);
      jjPos.setY(i, THREE.MathUtils.lerp(getJejuH(x, z) * edgeFade + 0.15, -0.06, beachT));
    } else {
      jjPos.setY(i, getJejuH(x, z) * edgeFade + 0.15);
    }
    const h = jjPos.getY(i);
    let c;
    if (d > edgeR - 0.6) {
      // Coastal — dark basalt sand with black volcanic pebbles
      const blackT = (Math.sin(a * 4) * 0.5 + 0.5) * 0.7;
      c = SAND_JJ.clone().lerp(BLACK_SAND, blackT);
    } else if (h > 0.55) {
      // High altitude — darker volcanic green
      c = VOLCANIC_JJ.clone().lerp(new THREE.Color(0x80A870), (h - 0.55) / 0.4);
    } else {
      // Main terrain — lush green with variation
      const gm = Math.sin(x * 2.5) * 0.3 + Math.cos(z * 3) * 0.2 + 0.5;
      c = GRASS_JJ.clone().lerp(DARK_JJ, gm);
      // Occasional darker basalt patches showing through
      const basaltT = Math.sin(x * 3.5 + z * 2.0) * Math.cos(x * 1.2 - z * 2.8);
      if (basaltT > 0.6) c.lerp(BASALT_JJ, (basaltT - 0.6) * 0.8);
    }
    jjColors[i * 3] = c.r; jjColors[i * 3 + 1] = c.g; jjColors[i * 3 + 2] = c.b;
  }
  jjGeo.setAttribute("color", new THREE.BufferAttribute(jjColors, 3));
  jjGeo.computeVertexNormals();
  const jjTerrain = new THREE.Mesh(jjGeo, mt(0x6FBF4A, { vertexColors: true }));
  jjTerrain.receiveShadow = true; jj.add(jjTerrain);

  // ── Cliff underside ──
  const cliffSegs = 120;
  const cliffGeo = new THREE.BufferGeometry();
  const cliffV = [], cliffN = [], cliffC = [];
  for (let i = 0; i < cliffSegs; i++) {
    const a0 = (i / cliffSegs) * Math.PI * 2;
    const a1 = ((i + 1) / cliffSegs) * Math.PI * 2;
    const r0 = getJejuR(a0), r1 = getJejuR(a1);
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const topY = 0.0, botY = -0.45, midY = -0.15;
    const bulge = 0.12 + Math.sin(a0 * 5) * 0.04;
    const mx0 = x0 + Math.cos(a0) * bulge, mz0 = z0 + Math.sin(a0) * bulge;
    const mx1 = x1 + Math.cos(a1) * bulge, mz1 = z1 + Math.sin(a1) * bulge;
    // Dark basalt cliff colors
    const basaltUp = [0.78, 0.75, 0.70], basaltLow = [0.68, 0.65, 0.60];
    cliffV.push(x0, topY, z0, mx0, midY, mz0, x1, topY, z1);
    cliffV.push(x1, topY, z1, mx0, midY, mz0, mx1, midY, mz1);
    for (let t = 0; t < 6; t++) { cliffC.push(...basaltUp); cliffN.push(Math.cos(a0), 0, Math.sin(a0)); }
    cliffV.push(mx0, midY, mz0, x0 * 0.95, botY, z0 * 0.95, mx1, midY, mz1);
    cliffV.push(mx1, midY, mz1, x0 * 0.95, botY, z0 * 0.95, x1 * 0.95, botY, z1 * 0.95);
    for (let t = 0; t < 6; t++) { cliffC.push(...basaltLow); cliffN.push(Math.cos(a0), -0.3, Math.sin(a0)); }
  }
  cliffGeo.setAttribute("position", new THREE.Float32BufferAttribute(cliffV, 3));
  cliffGeo.setAttribute("normal", new THREE.Float32BufferAttribute(cliffN, 3));
  cliffGeo.setAttribute("color", new THREE.Float32BufferAttribute(cliffC, 3));
  cliffGeo.computeVertexNormals();
  const cliffMat = mt(0x9A9890, { vertexColors: true });
  cliffMat.polygonOffset = true; cliffMat.polygonOffsetFactor = 1; cliffMat.polygonOffsetUnits = 1;
  jj.add(new THREE.Mesh(cliffGeo, cliffMat));

  // ══════════════════════════════════════════════
  //   HALLASAN — prominent shield volcano, tallest point on island
  // ══════════════════════════════════════════════
  const hallasan = new THREE.Group();

  // Shield volcano — taller, vertex-colored: green base -> rocky mid -> light summit
  const shieldGeo = new THREE.SphereGeometry(3.5, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  const shieldPos = shieldGeo.attributes.position;
  const shieldColors = new Float32Array(shieldPos.count * 3);
  const hallaGreen = new THREE.Color(0x60B848);
  const hallaRock = new THREE.Color(0x9a9080);
  const hallaSnow = new THREE.Color(0xd8d8d0);

  for (let i = 0; i < shieldPos.count; i++) {
    let x = shieldPos.getX(i), y = shieldPos.getY(i), z = shieldPos.getZ(i);
    const a = Math.atan2(z, x);
    const d = Math.sqrt(x * x + z * z);
    // Irregular rocky displacement
    shieldPos.setX(i, x + (Math.random() - 0.5) * 0.1 + Math.sin(a * 5) * 0.06);
    shieldPos.setZ(i, z + (Math.random() - 0.5) * 0.1 + Math.cos(a * 3) * 0.05);
    // Summit bump for more pronounced peak
    if (d < 1.0) shieldPos.setY(i, y + (1.0 - d) * 0.15);
    // Vertex color gradient: green base -> rocky mid -> light summit
    const t = y / 3.5;
    let c;
    if (t > 0.85) {
      c = hallaRock.clone().lerp(hallaSnow, (t - 0.85) / 0.15);
    } else if (t > 0.55) {
      c = hallaGreen.clone().lerp(hallaRock, (t - 0.55) / 0.3);
    } else {
      c = hallaGreen.clone();
      c.r += (Math.random() - 0.5) * 0.03;
      c.g += (Math.random() - 0.5) * 0.04;
    }
    shieldColors[i * 3] = c.r; shieldColors[i * 3 + 1] = c.g; shieldColors[i * 3 + 2] = c.b;
  }
  shieldGeo.setAttribute("color", new THREE.BufferAttribute(shieldColors, 3));
  shieldGeo.computeVertexNormals();
  const shieldMesh = new THREE.Mesh(shieldGeo, mt(0x60B848, { vertexColors: true, roughness: 0.9 }));
  shieldMesh.scale.set(1, 0.55, 1); // Taller shield shape
  shieldMesh.position.y = 0; shieldMesh.castShadow = true; hallasan.add(shieldMesh);

  // Summit crater (Baengnokdam) — larger, visible
  const craterRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.15, 8, 14),
    mt(0x9A9A90, { roughness: 1 }));
  craterRim.rotation.x = -Math.PI / 2; craterRim.position.y = 1.88; hallasan.add(craterRim);

  // Crater lake (Baengnokdam) — vivid blue
  const craterLake = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14),
    mt(0x2068a8, { transparent: true, opacity: 0.8 }));
  craterLake.rotation.x = -Math.PI / 2; craterLake.position.y = 1.82; hallasan.add(craterLake);

  // Rocky summit boulders around crater
  for (let rb = 0; rb < 8; rb++) {
    const rba = rb * Math.PI / 4 + Math.random() * 0.3;
    const rbr = 0.55 + Math.random() * 0.15;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.06 + Math.random() * 0.04, 0),
      mt(0x908878, { roughness: 1 }));
    rock.position.set(Math.cos(rba) * rbr, 1.85, Math.sin(rba) * rbr);
    hallasan.add(rock);
  }

  // Mist wisps around summit
  for (let m = 0; m < 4; m++) {
    const mist = new THREE.Mesh(new THREE.SphereGeometry(0.35 + m * 0.1, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 }));
    const ma = m * Math.PI * 2 / 4;
    mist.position.set(Math.cos(ma) * 1.4, 1.5 + m * 0.12, Math.sin(ma) * 1.4);
    mist.scale.set(1.5, 0.3, 1.0); hallasan.add(mist);
    animatedObjects.push({ type: "bob", mesh: mist, speed: 0.15 + m * 0.05, baseY: mist.position.y, amp: 0.08, phase: m * 2 });
  }
  hallasan.position.set(0, 0.15, 0); jj.add(hallasan);

  // ══════════════════════════════════════════════
  //   OREUM — parasitic volcanic cones (Jeju signature)
  // ══════════════════════════════════════════════
  [{ x: 2.5, z: 2.0, h: 0.35, r: 0.5 }, { x: -3.0, z: 1.5, h: 0.3, r: 0.45 },
   { x: 3.5, z: -1.5, h: 0.28, r: 0.4 }, { x: -2.0, z: -2.5, h: 0.32, r: 0.5 },
   { x: 4.0, z: 0.5, h: 0.25, r: 0.35 }, { x: -1.0, z: 3.5, h: 0.22, r: 0.3 }].forEach(oc => {
    const oreum = new THREE.Group();
    // Grassy cone
    const coneGeo = new THREE.ConeGeometry(oc.r, oc.h, 8);
    const conePos = coneGeo.attributes.position;
    for (let i = 0; i < conePos.count; i++) {
      conePos.setX(i, conePos.getX(i) + (Math.random() - 0.5) * 0.04);
      conePos.setZ(i, conePos.getZ(i) + (Math.random() - 0.5) * 0.04);
    }
    coneGeo.computeVertexNormals();
    const cone = new THREE.Mesh(coneGeo, mt(0x70BF50, { roughness: 0.9 }));
    cone.position.y = oc.h / 2; oreum.add(cone);
    // Small crater depression at top
    const oCrater = new THREE.Mesh(new THREE.CircleGeometry(oc.r * 0.3, 6), mt(0x60A848));
    oCrater.rotation.x = -Math.PI / 2; oCrater.position.y = oc.h - 0.01; oreum.add(oCrater);
    oreum.position.set(oc.x, getJejuH(oc.x, oc.z) + 0.15, oc.z); jj.add(oreum);
  });

  // ══════════════════════════════════════════════
  //   BATDAM — basalt dry-stone walls (THE Jeju visual)
  // ══════════════════════════════════════════════
  function makeBatdam(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);
    const segs = Math.floor(len / 0.08);
    for (let s = 0; s < segs; s++) {
      const t = (s + 0.5) / segs;
      // Slight winding offset
      const wobble = Math.sin(t * Math.PI * 3 + x1) * 0.03;
      const sx = x1 + dx * t + Math.cos(angle + Math.PI / 2) * wobble;
      const sz = z1 + dz * t + Math.sin(angle + Math.PI / 2) * wobble;
      const sy = getJejuH(sx, sz) + 0.15;
      // Individual rough stones stacked
      for (let layer = 0; layer < 2; layer++) {
        const stone = new THREE.Mesh(
          new THREE.BoxGeometry(
            0.04 + Math.random() * 0.03,
            0.03 + Math.random() * 0.015,
            0.05 + Math.random() * 0.03),
          mt(0x7A7A78 + Math.floor(Math.random() * 0x0a0a0a), { roughness: 1 }));
        stone.position.set(sx, sy + 0.015 + layer * 0.035, sz);
        stone.rotation.y = angle + (Math.random() - 0.5) * 0.3;
        stone.rotation.z = (Math.random() - 0.5) * 0.1;
        jj.add(stone);
      }
    }
  }
  // Winding wall network dividing fields into irregular plots
  makeBatdam(-2, 1, 1.5, 1.2);
  makeBatdam(1.5, 1.2, 3.5, -0.5);
  makeBatdam(-3, -1.5, -1, -2.5);
  makeBatdam(-1, -2.5, 0.5, -3);
  makeBatdam(-4, 2, -2, 1);
  makeBatdam(-2, 1, -2, -1.5);
  makeBatdam(1.5, 1.2, 1.5, -1);
  makeBatdam(-4, 2, -4, 0);
  makeBatdam(0.5, -3, 2.5, -2);

  // ══════════════════════════════════════════════
  //   DOLHARUBANG — stone grandfather statues
  // ══════════════════════════════════════════════
  function makeDolharubang(dx, dz, rot, sc) {
    sc = sc || 1;
    const dol = new THREE.Group();
    // Body — rounded pillar
    const dolB = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * sc, 0.13 * sc, 0.32 * sc, 8), mt(0x8a8a80, { roughness: 1 }));
    dolB.position.y = 0.16 * sc; dol.add(dolB);
    // Head — round
    const dolH = new THREE.Mesh(new THREE.SphereGeometry(0.1 * sc, 8, 6), mt(0x909088, { roughness: 1 }));
    dolH.position.y = 0.38 * sc; dol.add(dolH);
    // Mushroom-cap hat (wider and flatter — iconic)
    const dolHat = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * sc, 0.1 * sc, 0.06 * sc, 8), mt(0x7A7A75, { roughness: 1 }));
    dolHat.position.y = 0.48 * sc; dol.add(dolHat);
    const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * sc, 0.14 * sc, 0.02 * sc, 8), mt(0x7A7A75, { roughness: 1 }));
    hatBrim.position.y = 0.45 * sc; dol.add(hatBrim);
    // Bulging eyes
    for (const ex of [-0.04 * sc, 0.04 * sc]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02 * sc, 5, 4), mt(0x8A8A85));
      eye.position.set(ex, 0.39 * sc, 0.08 * sc); dol.add(eye);
    }
    // Big nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025 * sc, 5, 4), mt(0x8a8a80, { roughness: 1 }));
    nose.position.set(0, 0.35 * sc, 0.1 * sc); dol.add(nose);
    // Hands on belly (the iconic pose)
    for (const hx of [-0.09 * sc, 0.09 * sc]) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.03 * sc, 5, 4), mt(0x8a8a80, { roughness: 1 }));
      hand.position.set(hx, 0.15 * sc, 0.1 * sc); dol.add(hand);
    }
    dol.position.set(dx, getJejuH(dx, dz) + 0.15, dz);
    dol.rotation.y = rot; dol.castShadow = true; jj.add(dol);
  }
  makeDolharubang(3.5, 3.5, -0.4, 1.3);
  makeDolharubang(4.2, 3.0, -0.6, 1.3);
  makeDolharubang(-3.0, 2.5, Math.PI * 0.6, 1.0);
  makeDolharubang(1.5, -3.5, Math.PI * 1.2, 1.1);

  // ══════════════════════════════════════════════
  //   TANGERINE ORCHARDS inside walled plots
  // ══════════════════════════════════════════════
  // Orchard areas bounded by batdam walls
  [{ cx: 3.0, cz: 1.5, rows: 4, cols: 5 },
   { cx: -3.5, cz: -1.0, rows: 3, cols: 3 }].forEach(orch => {
    for (let row = 0; row < orch.rows; row++) {
      for (let col = 0; col < orch.cols; col++) {
        const ox = orch.cx - 0.8 + col * 0.45;
        const oz = orch.cz - 0.6 + row * 0.45;
        const tg = new THREE.Group();
        const trH = 0.18 + Math.random() * 0.06;
        const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, trH, 5), mt(0x7a5a3a));
        tk.position.y = trH / 2; tg.add(tk);
        const cn = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), mt(0x40A838));
        cn.position.y = trH + 0.06; tg.add(cn);
        for (let o = 0; o < 5; o++) {
          const oa = o * Math.PI * 2 / 5 + Math.random() * 0.3;
          const or2 = 0.06 + Math.random() * 0.05;
          const org = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 3), mt(0xf08020));
          org.position.set(Math.cos(oa) * or2, trH + Math.random() * 0.05, Math.sin(oa) * or2);
          tg.add(org);
        }
        tg.position.set(ox, getJejuH(ox, oz) + 0.15, oz); jj.add(tg);
      }
    }
  });

  // ── Canola flower fields (vivid yellow) ──
  [{ x: -3.5, z: 3.0, w: 1.8, d: 1.2, r: 0.3 },
   { x: -2.0, z: 4.0, w: 1.4, d: 0.9, r: -0.2 }].forEach(cf => {
    const y = getJejuH(cf.x, cf.z) + 0.16;
    const fld = new THREE.Mesh(new THREE.BoxGeometry(cf.w, 0.04, cf.d),
      mt(0xd8c020, { roughness: 0.85 }));
    fld.position.set(cf.x, y, cf.z); fld.rotation.y = cf.r; jj.add(fld);
    for (let fd = 0; fd < 15; fd++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3), mt(0xf0e030));
      dot.position.set(cf.x + (Math.random() - 0.5) * cf.w * 0.9, y + 0.03,
        cf.z + (Math.random() - 0.5) * cf.d * 0.9);
      jj.add(dot);
    }
  });

  // ── Jusangjeolli columnar basalt cliff (south coast) ──
  const basaltG = new THREE.Group();
  for (let row = 0; row < 3; row++) {
    for (let c = 0; c < 12; c++) {
      const ch = 0.4 + Math.random() * 0.35;
      const cr = 0.04 + Math.random() * 0.015;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(cr, cr, ch, 6),
        mt(0x7A7A78 + Math.floor(Math.random() * 0x101010)));
      col.position.set(c * 0.1 - 0.55, -0.1 + ch / 2, row * 0.08 - 0.08);
      col.castShadow = true; basaltG.add(col);
    }
  }
  basaltG.position.set(1.5, 0, -(getJejuR(Math.PI * 1.5) - 0.8));
  basaltG.rotation.y = 0.1; jj.add(basaltG);

  // ── Village cluster (SW) — thatched houses with basalt walls ──
  [{ x: -3.5, z: -2.5, r: 0.5, w: 0.45, d: 0.35, h: 0.22 },
   { x: -2.8, z: -3.2, r: -0.3, w: 0.5, d: 0.4, h: 0.25 },
   { x: -3.8, z: -3.5, r: 0.8, w: 0.4, d: 0.3, h: 0.2 },
   { x: -2.2, z: -2.2, r: 1.0, w: 0.38, d: 0.32, h: 0.22 },
   { x: -4.2, z: -2.0, r: 0.2, w: 0.35, d: 0.28, h: 0.18 }].forEach(hd => {
    const hs = new THREE.Group();
    const wl = new THREE.Mesh(new THREE.BoxGeometry(hd.w, hd.h, hd.d), mt(0x8A8A85, { roughness: 1 }));
    wl.position.y = hd.h / 2; wl.castShadow = true; hs.add(wl);
    // Rounded thatched roof
    const rf = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(hd.w, hd.d) * 0.75, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(0xa08040, { roughness: 0.95 }));
    rf.position.y = hd.h; rf.scale.set(1, 0.5, 0.85); hs.add(rf);
    // Rope net on roof
    for (let rx = -1; rx <= 1; rx++) {
      const ropeH = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, hd.w + 0.1, 3), mt(0x6a5a3a));
      ropeH.position.set(0, hd.h + 0.06, rx * 0.07); ropeH.rotation.z = Math.PI / 2; hs.add(ropeH);
    }
    const dr = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.01), mt(0x7a5a3a));
    dr.position.set(0, hd.h * 0.3, hd.d / 2 + 0.005); hs.add(dr);
    const wn = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.01),
      mt(0xffeeaa, { emissive: 0xffcc44, emissiveIntensity: 0.3 }));
    wn.position.set(hd.w * 0.3, hd.h * 0.55, hd.d / 2 + 0.005); hs.add(wn);
    hs.position.set(hd.x, getJejuH(hd.x, hd.z) + 0.15, hd.z);
    hs.rotation.y = hd.r; jj.add(hs);
  });

  // ── Jeju ponies (meadow) ──
  function makePony(px, pz, rot, col) {
    const p = new THREE.Group();
    const bd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.16), mt(col));
    bd.position.y = 0.09; p.add(bd);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.07), mt(col));
    hd.position.set(0, 0.14, 0.1); hd.rotation.x = 0.3; p.add(hd);
    for (const lx of [-0.03, 0.03]) {
      for (const lz of [0.05, -0.05]) {
        const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.009, 0.08, 3), mt(col));
        lg.position.set(lx, 0.04, lz); p.add(lg);
      }
    }
    p.position.set(px, getJejuH(px, pz) + 0.15, pz); p.rotation.y = rot; jj.add(p);
  }
  makePony(2.0, -1.5, 0.8, 0xa07040);
  makePony(2.6, -1.2, -0.5, 0x3a3a3a);
  makePony(1.5, -0.8, 1.2, 0xc0a070);

  // ── Wind turbines (eastern ridge) ──
  [{ a: -0.4, r: 4.8, h: 1.8 }, { a: 0.0, r: 5.0, h: 2.0 },
   { a: 0.4, r: 4.6, h: 1.6 }].forEach((td, wt) => {
    const tb = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, td.h, 6), mt(0xf0f0f0));
    pole.position.y = td.h / 2; tb.add(pole);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), mt(0xe8e8e8));
    hub.position.set(0, td.h, 0.04); tb.add(hub);
    const bladeGrp = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.65, 0.015), mt(0xf8f8f8));
      bl.position.y = 0.32;
      const bp = new THREE.Group(); bp.add(bl);
      bp.rotation.z = b * Math.PI * 2 / 3; bladeGrp.add(bp);
    }
    bladeGrp.position.set(0, td.h, 0.06); tb.add(bladeGrp);
    animatedObjects.push({ type: "spin", mesh: bladeGrp, speed: 1.2 + wt * 0.25 });
    const tx = Math.cos(td.a) * td.r, tz = Math.sin(td.a) * td.r;
    tb.position.set(tx, getJejuH(tx, tz) + 0.15, tz); jj.add(tb);
  });

  // ── Haenyeo divers ──
  for (let hdi = 0; hdi < 4; hdi++) {
    const dv = new THREE.Group();
    const dvB = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.09), mt(0x8A8A85));
    dv.add(dvB);
    const dvH = new THREE.Mesh(new THREE.SphereGeometry(0.025, 4, 3), mt(0xd0a080));
    dvH.position.set(0, 0.025, 0.045); dv.add(dvH);
    const twk = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), mt(0xf06020));
    twk.position.set(0.07, 0.015, 0); dv.add(twk);
    const ha = hdi * Math.PI * 2 / 4 + 0.8;
    const dr = getJejuR(ha) + 0.8;
    dv.position.set(Math.cos(ha) * dr, -0.08, Math.sin(ha) * dr);
    dv.rotation.y = ha + Math.PI; jj.add(dv);
    animatedObjects.push({ type: "bob", mesh: dv, speed: 0.5 + hdi * 0.1, baseY: -0.08, amp: 0.025, phase: hdi * 1.5 });
  }

  // ── Green tea terraces ──
  const teaG = new THREE.Group();
  for (let row = 0; row < 7; row++) {
    const rw = 1.6 - row * 0.06;
    const tr = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.05, 0.14),
      mt(row % 2 === 0 ? 0x4a9a3a : 0x2a7a28, { roughness: 0.85 }));
    tr.position.set(0, row * 0.04, row * 0.16); tr.castShadow = true; teaG.add(tr);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.04, 0.02), mt(0x6a5a3a));
    wall.position.set(0, row * 0.04 - 0.02, row * 0.16 - 0.08); teaG.add(wall);
  }
  teaG.position.set(-4.0, getJejuH(-4.0, -0.5) + 0.15, -0.5);
  teaG.rotation.y = 0.4; jj.add(teaG);

  // ── Dense forests ──
  [{ x: -1.5, z: 1.5, h: 0.6, t: "e" }, { x: -0.8, z: 2.0, h: 0.55, t: "e" },
   { x: -2.2, z: 2.0, h: 0.5, t: "e" }, { x: -1.0, z: 1.0, h: 0.45, t: "e" },
   { x: 1.5, z: 1.5, h: 0.45, t: "e" }, { x: 2.0, z: 0.5, h: 0.4, t: "e" },
   { x: 4.5, z: 2.0, h: 0.65, t: "p" }, { x: 5.0, z: 1.0, h: 0.6, t: "p" },
   { x: -4.5, z: 3.5, h: 0.55, t: "p" }, { x: 4.0, z: 3.5, h: 0.5, t: "p" }].forEach(td => {
    const tg = new THREE.Group();
    if (td.t === "e") {
      const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, td.h * 0.4, 4), mt(0x907a6a));
      tk.position.y = td.h * 0.2; tg.add(tk);
      for (let l = 0; l < 4; l++) {
        const ly = new THREE.Mesh(new THREE.ConeGeometry(0.12 - l * 0.02, 0.14, 6),
          mt(0x3a8a3a + Math.floor(Math.random() * 0x0a0a0a)));
        ly.position.y = td.h * 0.35 + l * 0.1; tg.add(ly);
      }
    } else {
      const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, td.h, 5), mt(0x8a6a3a));
      tk.position.y = td.h / 2; tg.add(tk);
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), mt(0x40A838));
      canopy.scale.set(1.2, 0.6, 1.2); canopy.position.y = td.h - 0.02; tg.add(canopy);
    }
    tg.position.set(td.x, getJejuH(td.x, td.z) + 0.15, td.z); jj.add(tg);
  });

  // ── Lighthouse (taller, on headland) ──
  const jjLH = new THREE.Group();
  const lhT = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.7, 8), mt(0xf0f0f0));
  lhT.position.y = 0.35; jjLH.add(lhT);
  for (let stripe = 0; stripe < 2; stripe++) {
    const lhS = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.06, 8), mt(0xe04040));
    lhS.position.y = 0.2 + stripe * 0.3; jjLH.add(lhS);
  }
  const lhC = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.1, 8), mt(0x5a5a5a));
  lhC.position.y = 0.72; jjLH.add(lhC);
  const lhRoof = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.06, 8), mt(0x5a5a5a));
  lhRoof.position.y = 0.78; jjLH.add(lhRoof);
  const lhB = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4),
    mt(0xffffaa, { emissive: 0xffff88, emissiveIntensity: 0.6 }));
  lhB.position.y = 0.7; jjLH.add(lhB);
  const lhGl = new THREE.PointLight(0xffffaa, 0.5, 5);
  lhGl.position.y = 0.7; jjLH.add(lhGl);
  animatedObjects.push({ type: "blink", mesh: lhB, speed: 1.5, phase: 0 });
  animatedObjects.push({ type: "lightFlicker", light: lhGl, baseIntensity: 0.5, phase: 0 });
  jjLH.position.set(4.8, getJejuH(4.8, -3.0) + 0.15, -3.0); jj.add(jjLH);

  // ── Lava tube entrance ──
  const cave = new THREE.Group();
  const cvArch = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 6, 10, Math.PI), mt(0x7A7A78));
  cvArch.position.y = 0.18; cvArch.rotation.z = Math.PI; cave.add(cvArch);
  const cvInner = new THREE.Mesh(new THREE.CircleGeometry(0.18, 10), mt(0x252525));
  cvInner.position.set(0, 0.18, -0.03); cave.add(cvInner);
  cave.position.set(-4.5, getJejuH(-4.5, 0.5) + 0.15, 0.5);
  cave.rotation.y = 0.2; jj.add(cave);

  // ── Waterfall from Hallasan ──
  const wfX = 0.8, wfZ = 2.5;
  const wfTop = getJejuH(wfX, wfZ) + 0.6, wfBot = getJejuH(wfX, wfZ + 0.8) + 0.18;
  const wfall = new THREE.Mesh(new THREE.PlaneGeometry(0.12, wfTop - wfBot),
    mt(0x80c0e0, { transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  wfall.position.set(wfX, wfBot + (wfTop - wfBot) / 2, wfZ + 0.4); jj.add(wfall);
  const wfPool = new THREE.Mesh(new THREE.CircleGeometry(0.2, 8),
    mt(0x4090c0, { transparent: true, opacity: 0.5 }));
  wfPool.rotation.x = -Math.PI / 2; wfPool.position.set(wfX, wfBot + 0.01, wfZ + 0.9); jj.add(wfPool);

  // ── Fishing boats ──
  for (let bi = 0; bi < 3; bi++) {
    const ba = Math.PI * 0.35 + bi * 0.25;
    const br = getJejuR(ba) + 0.4;
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.2), mt(0x3060a0));
    hull.position.y = 0.02; boat.add(hull);
    boat.position.set(Math.cos(ba) * br, -0.06, Math.sin(ba) * br);
    boat.rotation.y = ba + Math.PI / 2; jj.add(boat);
    animatedObjects.push({ type: "bob", mesh: boat, speed: 0.4 + bi * 0.1, baseY: -0.06, amp: 0.015, phase: bi * 2 });
  }

  scene.add(jj);

  // ── Bridge to Hawaii ──
  const _hiX = -22, _hiZ = 18;
  const hjAng = Math.atan2(_hiZ - JJ_Z, _hiX - JJ_X);
  const jb1X = _hiX + Math.cos(hjAng + Math.PI) * 3.2;
  const jb1Z = _hiZ + Math.sin(hjAng + Math.PI) * 3.2;
  const jb2X = JJ_X + Math.cos(hjAng) * (JJ_R - 0.5);
  const jb2Z = JJ_Z + Math.sin(hjAng) * (JJ_R - 0.5);
  scene.add(buildRopeBridge(jb1X, jb1Z, jb2X, jb2Z, { width: 0.35, baseY: 0.08, ropeColor: 0x8a7a5a }));
}

/* ═══════════════════════════════════════════════════════════
   Bora Bora — Tropical paradise with overwater bungalows
   ═══════════════════════════════════════════════════════════ */
function createBoraBora() {
  const BB_X = -48, BB_Z = 38, BB_R = 5.0;
  const bb = new THREE.Group();
  bb.position.set(BB_X, 0, BB_Z);

  // ── Irregular coastline ──
  function getBBR(a) {
    let r = BB_R;
    r += Math.sin(a * 2) * 0.5 + Math.cos(a * 3) * 0.3 + Math.sin(a * 5) * 0.15;
    // Lagoon inlet on east side
    const dE = Math.abs(a);
    if (dE < 0.5) r += (0.5 - dE) * 1.2;
    // Gentle bay on south
    const dS = Math.abs(a - Math.PI * 1.5);
    if (dS < 0.4) r += (0.4 - dS) * 0.8;
    return r;
  }

  // ── Mount Otemanu — dramatic volcanic peak ──
  function getBBH(x, z) {
    // Main peak — offset to west side of island
    const px = x + 1.5, pz = z - 0.5;
    const pd = Math.sqrt(px * px + pz * pz);
    const peak = Math.max(0, 1.0 - pd / 2.5) * 3.5;
    // Craggy ridge
    const ridge = Math.max(0, 1.0 - Math.abs(px) / 1.5) * Math.max(0, 1.0 - pd / 3) * 0.8;
    // Rolling lower terrain
    const hills = Math.sin(x * 1.2) * 0.06 + Math.cos(z * 0.8) * 0.05;
    // Beach slope — flatten near edges
    const d = Math.sqrt(x * x + z * z);
    const edgeFade = Math.max(0, 1 - d / (BB_R - 0.5));
    return (peak + ridge + hills) * edgeFade;
  }

  // ── Terrain mesh ──
  const bbRes = 60;
  const bbGeo = new THREE.PlaneGeometry(BB_R * 2.6, BB_R * 2.6, bbRes, bbRes);
  bbGeo.rotateX(-Math.PI / 2);
  const bbPos = bbGeo.attributes.position;
  const bbColors = new Float32Array(bbPos.count * 3);
  const JUNGLE = new THREE.Color(0x4a9a30);
  const JUNGLE2 = new THREE.Color(0x3d8828);
  const SAND_BB = new THREE.Color(0xf8f0d8);
  const ROCK_BB = new THREE.Color(0x8a8070);
  const tmpBB = new THREE.Color();

  for (let i = 0; i < bbPos.count; i++) {
    const x = bbPos.getX(i), z = bbPos.getZ(i);
    const d = Math.sqrt(x * x + z * z);
    const a = Math.atan2(z, x);
    const edgeR = getBBR(a);
    if (d > edgeR) { bbPos.setY(i, -1.5); bbColors[i*3] = 0.4; bbColors[i*3+1] = 0.38; bbColors[i*3+2] = 0.33; continue; }
    const h = getBBH(x, z);
    bbPos.setY(i, h);
    const edgeFrac = (edgeR - d) / edgeR;
    // Color by height
    if (h > 1.5) tmpBB.copy(ROCK_BB);
    else if (h > 0.3) { const n = Math.sin(x * 2 + z * 3) * 0.5 + 0.5; tmpBB.copy(JUNGLE).lerp(JUNGLE2, n); }
    else if (edgeFrac < 0.12) tmpBB.copy(SAND_BB);
    else tmpBB.copy(JUNGLE);
    if (h < 0.02) tmpBB.copy(SAND_BB);
    bbColors[i*3] = tmpBB.r; bbColors[i*3+1] = tmpBB.g; bbColors[i*3+2] = tmpBB.b;
  }
  bbGeo.computeVertexNormals();
  bbGeo.setAttribute("color", new THREE.Float32BufferAttribute(bbColors, 3));
  const bbTerrain = new THREE.Mesh(bbGeo, mt(0xffffff, { vertexColors: true }));
  bbTerrain.receiveShadow = true; bb.add(bbTerrain);

  // ── Cliff walls ──
  const cSegs = 80, cBands = 4;
  const cVerts = [], cNorms = [], cCols = [], cIdx = [];
  for (let i = 0; i <= cSegs; i++) {
    const a = (i / cSegs) * Math.PI * 2;
    const r = getBBR(a);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const topH = getBBH(x, z);
    for (let j = 0; j <= cBands; j++) {
      const t = j / cBands;
      const y = topH - t * (topH + 0.8);
      const bulge = Math.sin(t * Math.PI) * 0.1;
      cVerts.push(x + Math.cos(a) * bulge, y, z + Math.sin(a) * bulge);
      cNorms.push(Math.cos(a), 0, Math.sin(a));
      const bright = 0.6 + (1 - t) * 0.3;
      cCols.push(bright * 0.95, bright * 0.88, bright * 0.75);
      if (i < cSegs && j < cBands) {
        const c = i * (cBands + 1) + j, n = c + cBands + 1;
        cIdx.push(c, n, c + 1, c + 1, n, n + 1);
      }
    }
  }
  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute("position", new THREE.Float32BufferAttribute(cVerts, 3));
  cGeo.setAttribute("normal", new THREE.Float32BufferAttribute(cNorms, 3));
  cGeo.setAttribute("color", new THREE.Float32BufferAttribute(cCols, 3));
  cGeo.setIndex(cIdx);
  const cliffBB = new THREE.Mesh(cGeo, mt(0xffffff, { vertexColors: true }));
  bb.add(cliffBB);

  // ── Mount Otemanu peak — dramatic rocky spire ──
  const peakGeo = new THREE.ConeGeometry(1.2, 3.5, 8, 4);
  peakGeo.translate(0, 0, 0);
  const peakColors = new Float32Array(peakGeo.attributes.position.count * 3);
  for (let i = 0; i < peakGeo.attributes.position.count; i++) {
    const y = peakGeo.attributes.position.getY(i);
    const t = (y + 1.75) / 3.5;
    peakColors[i*3] = 0.45 + t * 0.15; peakColors[i*3+1] = 0.55 + t * 0.1; peakColors[i*3+2] = 0.3 + t * 0.05;
  }
  peakGeo.setAttribute("color", new THREE.Float32BufferAttribute(peakColors, 3));
  const peak = new THREE.Mesh(peakGeo, mt(0xffffff, { vertexColors: true }));
  peak.position.set(-1.5, 3.2, 0.5);
  peak.rotation.y = 0.3;
  bb.add(peak);

  // Secondary peak
  const peak2 = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.0, 6, 3), mt(0x6a8a50));
  peak2.position.set(-0.5, 2.2, -0.8);
  bb.add(peak2);

  // ── Palm trees — scattered across beach and lower terrain ──
  const palmPositions = [
    [2.5, 0.5], [3.0, -1.0], [3.5, 1.5], [2.0, -2.0], [1.5, 2.5],
    [-0.5, 3.5], [0.5, -3.5], [3.8, 0.0], [-1.0, 3.0], [2.8, -2.5],
    [0.0, 4.0], [-2.0, 3.0], [1.0, -3.8], [3.2, 2.0], [-0.5, -3.2],
    [4.0, 1.0], [3.5, -0.5], [2.0, 3.0], [-1.5, 3.5], [0.8, 3.8],
    [2.2, -1.5], [-0.3, -4.0], [1.8, 3.5], [3.0, 2.5], [-1.0, -3.0],
  ];
  palmPositions.forEach(([px, pz]) => {
    const d = Math.sqrt(px * px + pz * pz);
    const a = Math.atan2(pz, px);
    if (d > getBBR(a) - 0.3) return;
    const h = getBBH(px, pz);
    if (h > 1.0) return; // no palms on peak
    const pg = new THREE.Group();
    // Trunk — slightly curved
    const trunkH = 0.6 + Math.random() * 0.5;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.035, trunkH, 5),
      mt(0xb8a070));
    trunk.position.y = trunkH / 2;
    trunk.rotation.z = (Math.random() - 0.5) * 0.15;
    trunk.rotation.x = (Math.random() - 0.5) * 0.15;
    pg.add(trunk);
    // Fronds — fan of elongated green planes
    for (let f = 0; f < 6; f++) {
      const fa = (f / 6) * Math.PI * 2 + Math.random() * 0.3;
      const frond = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, 0.08),
        mt(0x3a9030, { side: THREE.DoubleSide }));
      frond.position.set(
        Math.cos(fa) * 0.15,
        trunkH - 0.05,
        Math.sin(fa) * 0.15);
      frond.rotation.set(-0.6, fa, 0.2);
      pg.add(frond);
    }
    pg.position.set(px, h, pz);
    bb.add(pg);
  });

  // ── White sand beach ring ──
  const beachGeo = new THREE.RingGeometry(BB_R - 0.6, BB_R + 0.3, 48, 1);
  beachGeo.rotateX(-Math.PI / 2);
  const beach = new THREE.Mesh(beachGeo, mt(0xf8f0d8, { transparent: true, opacity: 0.7 }));
  beach.position.y = 0.01;
  bb.add(beach);

  // ── Overwater bungalows — signature Bora Bora feature ──
  // Main jetty extending from shore
  const jettyAng = 0.3; // east-northeast
  const jettyStartR = BB_R - 0.3;
  const jettyEndR = BB_R + 4.5;
  const jettyX1 = Math.cos(jettyAng) * jettyStartR;
  const jettyZ1 = Math.sin(jettyAng) * jettyStartR;
  const jettyX2 = Math.cos(jettyAng) * jettyEndR;
  const jettyZ2 = Math.sin(jettyAng) * jettyEndR;

  // Wooden jetty/walkway
  const jettyLen = jettyEndR - jettyStartR;
  const jettySegs = 20;
  for (let i = 0; i < jettySegs; i++) {
    const t = i / jettySegs;
    const jx = jettyX1 + (jettyX2 - jettyX1) * t;
    const jz = jettyZ1 + (jettyZ2 - jettyZ1) * t;
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.025, 0.35),
      mt(i % 2 === 0 ? 0xc8b080 : 0xb8a070));
    plank.position.set(jx, 0.04, jz);
    plank.rotation.y = jettyAng;
    bb.add(plank);
    // Stilts
    for (const s of [-0.12, 0.12]) {
      const perpX = -Math.sin(jettyAng) * s;
      const perpZ = Math.cos(jettyAng) * s;
      const stilt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.015, 0.4, 4),
        mt(0x8a7050));
      stilt.position.set(jx + perpX, -0.16, jz + perpZ);
      bb.add(stilt);
    }
  }

  // Curved arc of overwater bungalows
  const bungalowCount = 14;
  const arcStart = jettyAng - 0.8;
  const arcEnd = jettyAng + 0.9;
  const arcR = BB_R + 3.5;

  for (let i = 0; i < bungalowCount; i++) {
    const t = i / (bungalowCount - 1);
    const ba = arcStart + (arcEnd - arcStart) * t;
    const br = arcR + Math.sin(t * Math.PI) * 0.8;
    const bx = Math.cos(ba) * br;
    const bz = Math.sin(ba) * br;
    const bg = new THREE.Group();

    // Platform on stilts
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.03, 0.35),
      mt(0xc8b080));
    platform.position.y = 0.05; bg.add(platform);

    // Walls
    const wallH = 0.18;
    const wall1 = new THREE.Mesh(new THREE.BoxGeometry(0.38, wallH, 0.02), mt(0xe8dcc0));
    wall1.position.set(0, wallH / 2 + 0.06, 0.16); bg.add(wall1);
    const wall2 = new THREE.Mesh(new THREE.BoxGeometry(0.38, wallH, 0.02), mt(0xe8dcc0));
    wall2.position.set(0, wallH / 2 + 0.06, -0.16); bg.add(wall2);
    const wall3 = new THREE.Mesh(new THREE.BoxGeometry(0.02, wallH, 0.3), mt(0xd8ccb0));
    wall3.position.set(0.19, wallH / 2 + 0.06, 0); bg.add(wall3);

    // Thatched roof — A-frame
    const roofL = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.28),
      mt(0xa89060, { side: THREE.DoubleSide }));
    roofL.position.set(0, 0.3, 0.05);
    roofL.rotation.x = -0.45;
    bg.add(roofL);
    const roofR = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.28),
      mt(0x98804a, { side: THREE.DoubleSide }));
    roofR.position.set(0, 0.3, -0.05);
    roofR.rotation.x = 0.45;
    bg.add(roofR);

    // Stilts into water
    for (const sx of [-0.15, 0.15]) {
      for (const sz of [-0.13, 0.13]) {
        const stilt = new THREE.Mesh(
          new THREE.CylinderGeometry(0.01, 0.015, 0.5, 4),
          mt(0x8a7050));
        stilt.position.set(sx, -0.2, sz);
        bg.add(stilt);
      }
    }

    // Small deck/balcony over water
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.02, 0.15),
      mt(0xb8a060));
    deck.position.set(-0.25, 0.04, 0);
    bg.add(deck);

    bg.position.set(bx, 0, bz);
    bg.rotation.y = ba + Math.PI / 2;
    bb.add(bg);

    // Connecting walkway from arc to each bungalow
    if (i > 0) {
      const prevBa = arcStart + ((i - 1) / (bungalowCount - 1)) * (arcEnd - arcStart);
      const prevBr = arcR + Math.sin(((i - 1) / (bungalowCount - 1)) * Math.PI) * 0.8;
      const prevBx = Math.cos(prevBa) * prevBr;
      const prevBz = Math.sin(prevBa) * prevBr;
      const walkLen = Math.sqrt((bx - prevBx) ** 2 + (bz - prevBz) ** 2);
      const walkAng = Math.atan2(bz - prevBz, bx - prevBx);
      const walkSegs = Math.max(2, Math.floor(walkLen / 0.2));
      for (let w = 0; w < walkSegs; w++) {
        const wt = (w + 0.5) / walkSegs;
        const wx = prevBx + (bx - prevBx) * wt;
        const wz = prevBz + (bz - prevBz) * wt;
        const wp = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.02, 0.2),
          mt(w % 2 === 0 ? 0xc0a870 : 0xb09860));
        wp.position.set(wx, 0.035, wz);
        wp.rotation.y = walkAng;
        bb.add(wp);
      }
    }
  }

  // Connect jetty to the arc midpoint
  const arcMidAng = (arcStart + arcEnd) / 2;
  const arcMidR = arcR + Math.sin(0.5 * Math.PI) * 0.8;
  const arcMidX = Math.cos(arcMidAng) * arcMidR;
  const arcMidZ = Math.sin(arcMidAng) * arcMidR;
  const connSegs = 6;
  for (let i = 0; i < connSegs; i++) {
    const t = (i + 0.5) / connSegs;
    const cx = jettyX2 + (arcMidX - jettyX2) * t;
    const cz = jettyZ2 + (arcMidZ - jettyZ2) * t;
    const connAng = Math.atan2(arcMidZ - jettyZ2, arcMidX - jettyX2);
    const cp = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.02, 0.3),
      mt(i % 2 === 0 ? 0xc0a870 : 0xb09860));
    cp.position.set(cx, 0.035, cz);
    cp.rotation.y = connAng;
    bb.add(cp);
  }

  // ── Resort pool on the beach ──
  const poolX = 2.0, poolZ = -1.5;
  const poolH = getBBH(poolX, poolZ);
  const poolBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.04, 0.5), mt(0xe0d8c8));
  poolBase.position.set(poolX, poolH + 0.02, poolZ); bb.add(poolBase);
  const poolWater = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.4),
    mt(0x60d0e8, { transparent: true, opacity: 0.7 }));
  poolWater.position.set(poolX, poolH + 0.05, poolZ); bb.add(poolWater);
  // Pool loungers
  for (let i = 0; i < 4; i++) {
    const lx = poolX - 0.3 + i * 0.2;
    const lounger = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.01, 0.2), mt(0xf8f0e0));
    lounger.position.set(lx, poolH + 0.045, poolZ + 0.4); bb.add(lounger);
  }

  // ── Beach umbrellas ──
  const umbrellaSpots = [[3.0, 1.5], [3.5, -0.5], [2.5, -2.0], [4.0, 0.5]];
  umbrellaSpots.forEach(([ux, uz]) => {
    const d = Math.sqrt(ux * ux + uz * uz);
    const a = Math.atan2(uz, ux);
    if (d > getBBR(a) - 0.2) return;
    const uh = getBBH(ux, uz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), mt(0xc8b080));
    pole.position.set(ux, uh + 0.15, uz); bb.add(pole);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.06, 6), mt(0xe8d8a0));
    canopy.position.set(ux, uh + 0.32, uz); bb.add(canopy);
  });

  // ── Small tiki huts on beach ──
  for (let i = 0; i < 3; i++) {
    const ta = Math.PI * 0.6 + i * 0.4;
    const tr = BB_R - 0.8;
    const tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr;
    const th = getBBH(tx, tz);
    const tg = new THREE.Group();
    // 4 poles
    for (const sx of [-0.08, 0.08]) {
      for (const sz of [-0.06, 0.06]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.25, 4), mt(0xa08850));
        pole.position.set(sx, 0.125, sz); tg.add(pole);
      }
    }
    // Thatched roof
    const tRoof = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.1, 4), mt(0x9a8040));
    tRoof.position.y = 0.28; tRoof.rotation.y = Math.PI / 4; tg.add(tRoof);
    tg.position.set(tx, th, tz);
    tg.rotation.y = ta;
    bb.add(tg);
  }

  // ── Boats in lagoon ──
  for (let i = 0; i < 3; i++) {
    const ba = 0.5 + i * 0.7;
    const br = BB_R + 1.5 + Math.random();
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.18), mt(0xf0e8d0));
    hull.position.y = 0.015; boat.add(hull);
    if (i === 1) {
      // Outrigger canoe
      const outrigger = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.15, 4), mt(0xa08850));
      outrigger.position.set(0.08, 0.01, 0); outrigger.rotation.z = Math.PI / 2; boat.add(outrigger);
    }
    boat.position.set(Math.cos(ba) * br, -0.04, Math.sin(ba) * br);
    boat.rotation.y = ba + Math.PI / 2;
    bb.add(boat);
    animatedObjects.push({ type: "bob", mesh: boat, speed: 0.3 + i * 0.1, baseY: -0.04, amp: 0.01, phase: i * 2.5 });
  }

  // ── Resort directory signpost ──
  const dirY = getBBH(2.5, 0.5);
  const dirG = new THREE.Group();
  dirG.position.set(2.5, dirY, 0.5);
  dirG.rotation.y = -0.4;
  // Main post
  const dirPost = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.6, 5), mt(0xa08850));
  dirPost.position.y = 0.3; dirG.add(dirPost);
  // Signs — wooden planks pointing to attractions
  const dirSigns = [
    { label: "Bungalows", color: 0xc8a860, y: 0.52, rot: 0.3 },
    { label: "Beach", color: 0xd8c880, y: 0.45, rot: -0.5 },
    { label: "Otemanu", color: 0xb89850, y: 0.38, rot: 0.8 },
    { label: "Pool", color: 0xc0b070, y: 0.31, rot: -0.2 },
    { label: "Lagoon", color: 0xb8a060, y: 0.24, rot: 1.1 },
  ];
  dirSigns.forEach(s => {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.04, 0.01),
      mt(s.color));
    plank.position.set(0.08, s.y, 0);
    plank.rotation.y = s.rot;
    dirG.add(plank);
    // Arrow tip
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.04, 3),
      mt(s.color));
    arrow.position.set(0.08 + Math.cos(s.rot) * 0.14, s.y, -Math.sin(s.rot) * 0.14);
    arrow.rotation.z = -Math.PI / 2;
    arrow.rotation.y = s.rot;
    dirG.add(arrow);
  });
  // Top decoration — small thatched cap
  const dirCap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.04, 5), mt(0x8a7040));
  dirCap.position.y = 0.56; dirG.add(dirCap);
  bb.add(dirG);

  // ── Welcome arch at bridge landing ──
  const archAng = Math.atan2(BB_Z - (-36), BB_X - (-36)) + Math.PI;
  const archR = BB_R - 0.5;
  const archX = Math.cos(archAng) * archR, archZ = Math.sin(archAng) * archR;
  const archH = getBBH(archX, archZ);
  const archG = new THREE.Group();
  archG.position.set(archX, archH, archZ);
  archG.rotation.y = archAng;
  // Two bamboo posts
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.5, 5), mt(0xa08850));
    post.position.set(side * 0.2, 0.25, 0); archG.add(post);
  }
  // Cross beam
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), mt(0xb89850));
  beam.position.y = 0.48; archG.add(beam);
  // Thatched top
  const archRoof = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.15), mt(0x8a7040));
  archRoof.position.y = 0.52; archG.add(archRoof);
  // Welcome sign board
  const welcomeBoard = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.1, 0.015), mt(0xd8c080));
  welcomeBoard.position.y = 0.38; archG.add(welcomeBoard);
  bb.add(archG);

  scene.add(bb);

  // ── Bridge connecting Jeju (-36,30) to Bora Bora (-48,38) ──
  const JJ_X2 = -36, JJ_Z2 = 30, JJ_R2 = 6.0;
  const bbAng = Math.atan2(BB_Z - JJ_Z2, BB_X - JJ_X2);
  // Jeju edge point
  const jbX = JJ_X2 + Math.cos(bbAng) * (JJ_R2 - 0.5);
  const jbZ = JJ_Z2 + Math.sin(bbAng) * (JJ_R2 - 0.5);
  // Bora Bora edge point
  const bbEdgeAng = bbAng + Math.PI;
  const bbEdgeR = getBBR(bbEdgeAng);
  const bbX = BB_X + Math.cos(bbEdgeAng) * (bbEdgeR - 0.3);
  const bbZ = BB_Z + Math.sin(bbEdgeAng) * (bbEdgeR - 0.3);
  // Rattan-style wooden bridge
  scene.add(buildRopeBridge(jbX, jbZ, bbX, bbZ, {
    width: 0.3, baseY: 0.06, sag: 0.1,
    color: 0xc8a860, colorD: 0xb89850,
    ropeColor: 0xa08040
  }));
}


/* ═══════════════════════════════════════════════════════════
   Hermit's Isle — Remote mystical island at the edge of the world
   ═══════════════════════════════════════════════════════════ */
function createHermitIsland() {
  const HM_X = 75, HM_Z = -30, HM_R = 12.0;
  const hm = new THREE.Group();
  hm.position.set(HM_X, 0, HM_Z);

  // ── Irregular coastline ──
  function getHermitR(a) {
    let r = HM_R;
    r += Math.sin(a * 2) * 0.8 + Math.cos(a * 3) * 0.5 + Math.sin(a * 5) * 0.3;
    const dE = Math.abs(a);
    if (dE < 0.5) r += (0.5 - dE) * 3.0;
    const dW = Math.abs(a - Math.PI);
    if (dW < 0.4) r -= (0.4 - dW) * 2.5;
    const dN = Math.abs(a - Math.PI / 2);
    if (dN < 0.3) r += (0.3 - dN) * 2.0;
    return r;
  }

  // ── Terrain height — mossy mounds ──
  function getHermitH(x, z) {
    const d = Math.sqrt(x * x + z * z);
    const central = Math.max(0, 1.0 - d / 6.0) * 1.2;
    const hills = Math.sin(x * 0.5 + 0.3) * 0.2 + Math.cos(z * 0.6) * 0.15;
    // Soft mossy mounds
    const mounds = Math.sin(x * 1.5) * Math.cos(z * 1.5) * 0.08;
    const ridgeN = z > 2 ? Math.max(0, 0.3 * (1 - Math.abs(x) / 5)) : 0;
    const valley = (Math.abs(x - 2) < 1.5 && z > 0 && z < 5) ? -0.12 : 0;
    return central + hills + mounds + ridgeN + valley;
  }

  // ── Terrain mesh — deep green/blue mossy palette ──
  const hmRes = 100;
  const hmGeo = new THREE.PlaneGeometry(HM_R * 2.8, HM_R * 2.8, hmRes, hmRes);
  hmGeo.rotateX(-Math.PI / 2);
  const hmPos = hmGeo.attributes.position;
  const hmColors = new Float32Array(hmPos.count * 3);
  const MOSS = new THREE.Color(0xa580d8);
  const DEEP_MOSS = new THREE.Color(0x8a65bb);
  const BLUE_MOSS = new THREE.Color(0x9a7acc);
  const SHORE = new THREE.Color(0xd0c0e8);

  for (let i = 0; i < hmPos.count; i++) {
    const x = hmPos.getX(i), z = hmPos.getZ(i);
    const a = Math.atan2(z, x);
    const d = Math.sqrt(x * x + z * z);
    const edgeR = getHermitR(a);
    const edgeFade = 1 - smoothstep(edgeR - 3.0, edgeR, d);
    if (d > edgeR + 0.4) { hmPos.setY(i, -0.5); }
    else if (d > edgeR - 0.5) {
      const beachT = smoothstep(edgeR - 0.5, edgeR + 0.4, d);
      hmPos.setY(i, THREE.MathUtils.lerp(getHermitH(x, z) * edgeFade + 0.15, -0.06, beachT));
    } else {
      hmPos.setY(i, getHermitH(x, z) * edgeFade + 0.15);
    }
    const h = hmPos.getY(i);
    let c;
    if (d > edgeR - 0.8) {
      c = SHORE.clone();
    } else if (h > 0.8) {
      c = BLUE_MOSS.clone().lerp(DEEP_MOSS, (h - 0.8) / 0.5);
    } else {
      const gm = Math.sin(x * 1.2) * 0.3 + Math.cos(z * 1.5) * 0.2 + 0.5;
      c = MOSS.clone().lerp(DEEP_MOSS, gm);
      // Blue-green patches
      const blueT = Math.sin(x * 2.5 + z * 1.8) * 0.5 + 0.5;
      if (blueT > 0.7) c.lerp(BLUE_MOSS, (blueT - 0.7) * 2.0);
    }
    hmColors[i * 3] = c.r; hmColors[i * 3 + 1] = c.g; hmColors[i * 3 + 2] = c.b;
  }
  hmGeo.setAttribute("color", new THREE.BufferAttribute(hmColors, 3));
  hmGeo.computeVertexNormals();
  const hmTerrain = new THREE.Mesh(hmGeo, mt(0xa580d8, { vertexColors: true, roughness: 0.9, emissive: 0x403050, emissiveIntensity: 0.12 }));
  hmTerrain.receiveShadow = true; hm.add(hmTerrain);

  // ── Cliff underside ──
  const cSegs = 120;
  const cGeo = new THREE.BufferGeometry();
  const cV = [], cN = [], cC = [];
  for (let i = 0; i < cSegs; i++) {
    const a0 = (i / cSegs) * Math.PI * 2;
    const a1 = ((i + 1) / cSegs) * Math.PI * 2;
    const r0 = getHermitR(a0), r1 = getHermitR(a1);
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const bulge = 0.12 + Math.sin(a0 * 4) * 0.04;
    const mx0 = x0 + Math.cos(a0) * bulge, mz0 = z0 + Math.sin(a0) * bulge;
    const mx1 = x1 + Math.cos(a1) * bulge, mz1 = z1 + Math.sin(a1) * bulge;
    const sCol = [0.65, 0.55, 0.78], rCol = [0.50, 0.40, 0.62];
    cV.push(x0, -0.1, z0, mx0, -0.28, mz0, x1, -0.1, z1);
    cV.push(x1, -0.1, z1, mx0, -0.28, mz0, mx1, -0.28, mz1);
    for (let t = 0; t < 6; t++) { cC.push(...sCol); cN.push(Math.cos(a0), 0, Math.sin(a0)); }
    cV.push(mx0, -0.2, mz0, x0 * 0.95, -0.5, z0 * 0.95, mx1, -0.2, mz1);
    cV.push(mx1, -0.2, mz1, x0 * 0.95, -0.5, z0 * 0.95, x1 * 0.95, -0.5, z1 * 0.95);
    for (let t = 0; t < 6; t++) { cC.push(...rCol); cN.push(Math.cos(a0), -0.3, Math.sin(a0)); }
  }
  cGeo.setAttribute("position", new THREE.Float32BufferAttribute(cV, 3));
  cGeo.setAttribute("normal", new THREE.Float32BufferAttribute(cN, 3));
  cGeo.setAttribute("color", new THREE.Float32BufferAttribute(cC, 3));
  cGeo.computeVertexNormals();
  hm.add(new THREE.Mesh(cGeo, mt(0x8a6aaa, { vertexColors: true, roughness: 1 })));

  // ══════════════════════════════════════════════
  //   THE GREAT TREE — layered canopy, twisted roots, hollow trunk
  // ══════════════════════════════════════════════
  const tree = new THREE.Group();
  // Main trunk (twisted, thick)
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 5.0, 12), mt(0x4a3018, { roughness: 0.95 }));
  trunk.position.y = 2.5; tree.add(trunk);
  // Gnarled secondary trunks
  for (let st = 0; st < 4; st++) {
    const sa = st * Math.PI / 2 + 0.3;
    const sTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 3.0, 6), mt(0x4a3018, { roughness: 0.95 }));
    sTrunk.position.set(Math.cos(sa) * 0.5, 1.5, Math.sin(sa) * 0.5);
    sTrunk.rotation.z = Math.cos(sa) * 0.25; tree.add(sTrunk);
  }
  // Massive exposed root system (twisting)
  for (let r = 0; r < 10; r++) {
    const ra = r * Math.PI / 5;
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.18, 2.2, 5), mt(0x4a3018, { roughness: 0.95 }));
    root.position.set(Math.cos(ra) * 0.6, 0.3, Math.sin(ra) * 0.6);
    root.rotation.z = Math.cos(ra) * 0.7; root.rotation.y = ra; tree.add(root);
  }
  // Hollow doorway at base (dark opening with warm glow)
  const hollow = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.06, 6, 8, Math.PI), mt(0x3a2010));
  hollow.position.set(0, 0.25, 0.55); hollow.rotation.z = Math.PI; tree.add(hollow);
  const hollowInner = new THREE.Mesh(new THREE.CircleGeometry(0.15, 8),
    mt(0xcc88ff, { emissive: 0xaa55dd, emissiveIntensity: 0.6, transparent: true, opacity: 0.4 }));
  hollowInner.position.set(0, 0.25, 0.52); tree.add(hollowInner);

  // Small lit windows in trunk
  [{y: 1.5, a: 0.5}, {y: 2.2, a: 2.0}, {y: 3.0, a: 4.0}].forEach(wp => {
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.03, 5),
      mt(0xcc99ff, { emissive: 0xaa66dd, emissiveIntensity: 0.7 }));
    win.position.set(Math.cos(wp.a) * 0.38, wp.y, Math.sin(wp.a) * 0.38);
    win.rotation.y = wp.a + Math.PI; tree.add(win);
  });

  // LAYERED CANOPY (clumps, not one blob)
  const canopyColors = [0x9a6acc, 0xaa77dd, 0x8a5abb, 0xbb88ee, 0x9a60cc];
  [{y: 4.0, s: 2.2, sy: 0.6, x: 0, z: 0},
   {y: 4.5, s: 1.8, sy: 0.55, x: 0.8, z: 0.4},
   {y: 3.8, s: 1.6, sy: 0.6, x: -0.9, z: 0.6},
   {y: 4.8, s: 1.4, sy: 0.5, x: 0.4, z: -0.6},
   {y: 3.5, s: 1.5, sy: 0.55, x: -0.5, z: -0.8},
   {y: 5.0, s: 1.2, sy: 0.45, x: 0.6, z: 0.8},
   {y: 4.3, s: 1.3, sy: 0.5, x: -1.0, z: -0.3},
   {y: 5.2, s: 1.0, sy: 0.4, x: 0, z: 0.5}].forEach((cp, ci) => {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(cp.s, 10, 8),
      mt(canopyColors[ci % canopyColors.length], { roughness: 0.85 }));
    leaf.position.set(cp.x, cp.y, cp.z); leaf.scale.set(1.2, cp.sy, 1.2); tree.add(leaf);
  });

  // Hanging vines from canopy
  for (let v = 0; v < 20; v++) {
    const va = v * Math.PI / 10;
    const vr = 1.0 + Math.sin(v * 2) * 0.5;
    const vLen = 1.0 + Math.sin(v * 1.5) * 0.8;
    const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, vLen, 3), mt(0x8a5aaa));
    vine.position.set(Math.cos(va) * vr, 3.5 - vLen / 2, Math.sin(va) * vr); tree.add(vine);
  }

  // ── GLOWING ORBS in the tree (many, bright) ──
  for (let go = 0; go < 12; go++) {
    const ga = go * Math.PI / 6;
    const gr = 0.5 + Math.sin(go) * 0.4;
    const gy = 3.0 + Math.sin(go * 2) * 1.0;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4),
      mt(go % 3 === 0 ? 0xffaaff : go % 3 === 1 ? 0xaaffdd : 0xddbbff, {
        emissive: go % 3 === 0 ? 0xdd66dd : go % 3 === 1 ? 0x66ddaa : 0xaa77dd,
        emissiveIntensity: 1.2, transparent: true, opacity: 0.75 }));
    orb.position.set(Math.cos(ga) * gr, gy, Math.sin(ga) * gr);
    tree.add(orb);
    animatedObjects.push({ type: "blink", mesh: orb, speed: 0.15 + go * 0.03, phase: go * 1.5 });
  }

  // Strong warm glow at tree base
  // [perf] removed: const treeGlow = new THREE.PointLight(0xcc88ff, 1.5, 12);
  // [perf] removed: treeGlow.position.set(0, 1.0, 0); tree.add(treeGlow);


  tree.position.set(0, 0.15, 0); hm.add(tree);

  // ══════════════════════════════════════════════
  //   GLOWING MUSHROOM CLUSTERS (dense, bright)
  // ══════════════════════════════════════════════
  const mushColors = [
    {c: 0xff4444, e: 0xdd2222}, {c: 0xffaa44, e: 0xdd8822},
    {c: 0xcc66ff, e: 0xaa44dd}, {c: 0x44ddaa, e: 0x22bb88},
    {c: 0xff66aa, e: 0xdd4488}, {c: 0x44ccff, e: 0x22aadd},
  ];
  // Small mushrooms — LOTS of them
  for (let m = 0; m < 50; m++) {
    const ma = m * Math.PI * 2 / 50 + Math.sin(m) * 0.5;
    const mr = 2.0 + Math.sin(m * 1.7) * 3.0 + 3.0;
    const mc = mushColors[m % mushColors.length];
    const mush = new THREE.Group();
    const mStem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.04 + Math.random() * 0.03, 4), mt(0xf0e8d0));
    mStem.position.y = 0.02; mush.add(mStem);
    const mCap = new THREE.Mesh(new THREE.SphereGeometry(0.015 + Math.random() * 0.01, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(mc.c, { emissive: mc.e, emissiveIntensity: 0.6 }));
    mCap.position.y = 0.04 + Math.random() * 0.02; mush.add(mCap);
    mush.position.set(Math.cos(ma) * mr, 0.17, Math.sin(ma) * mr); hm.add(mush);
  }

  // Giant mushrooms (bigger, brighter)
  [{x: -6, z: -1, h: 0.8, r: 0.2, c: 0xdd88ff, e: 0xbb55dd},
   {x: 4, z: 6, h: 0.65, r: 0.16, c: 0xbb77ff, e: 0x9955dd},
   {x: -4, z: -7, h: 0.55, r: 0.14, c: 0xff55aa, e: 0xdd3388},
   {x: 7, z: -3, h: 0.7, r: 0.18, c: 0x55ddcc, e: 0x33bb99},
   {x: -8, z: 4, h: 0.6, r: 0.15, c: 0xffaa55, e: 0xdd8833}].forEach(gm => {
    const big = new THREE.Group();
    const bStem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, gm.h, 8), mt(0xe8dcc0));
    bStem.position.y = gm.h / 2; big.add(bStem);
    const bCap = new THREE.Mesh(new THREE.SphereGeometry(gm.r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(gm.c, { emissive: gm.e, emissiveIntensity: 0.5 }));
    bCap.position.y = gm.h; big.add(bCap);
    // Spots
    for (let sp = 0; sp < 5; sp++) {
      const spa = sp * Math.PI * 2 / 5;
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 5),
        mt(0xffffff, { transparent: true, opacity: 0.5 }));
      spot.position.set(Math.cos(spa) * gm.r * 0.5, gm.h + 0.01, Math.sin(spa) * gm.r * 0.5);
      spot.rotation.x = -Math.PI / 2; big.add(spot);
    }
    // mushrooms self-lit via emissive, no point light needed
    big.position.set(gm.x, 0.18, gm.z); hm.add(big);
  });

  // ── Fairy rings (toadstools in circles) ──
  [{x: -3, z: -3, r: 1.0}, {x: 5, z: 3, r: 0.8}, {x: -6, z: 5, r: 0.7}].forEach(fr => {
    for (let ft = 0; ft < 8; ft++) {
      const fa = ft * Math.PI / 4;
      const mush = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.04, 4), mt(0xf0e8d0));
      stem.position.y = 0.02; mush.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.015, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2),
        mt(0xff4444, { emissive: 0xdd2222, emissiveIntensity: 0.4 }));
      cap.position.y = 0.04; mush.add(cap);
      mush.position.set(fr.x + Math.cos(fa) * fr.r, 0.17, fr.z + Math.sin(fa) * fr.r);
      hm.add(mush);
    }
  });

  // ══════════════════════════════════════════════
  //   BIOLUMINESCENT POOLS (brighter)
  // ══════════════════════════════════════════════
  [{x: -2, z: -2, r: 0.7}, {x: 3, z: 5, r: 0.55}, {x: -5, z: -6, r: 0.5},
   {x: 6, z: -4, r: 0.4}].forEach((pp, pi) => {
    const pool = new THREE.Group();
    const poolW = new THREE.Mesh(new THREE.CircleGeometry(pp.r, 16),
      mt(0x7a55cc, { transparent: true, opacity: 0.6, emissive: 0x5533aa, emissiveIntensity: 0.8 }));
    poolW.rotation.x = -Math.PI / 2; poolW.position.y = 0.01; pool.add(poolW);
    // Rock border
    for (let pr = 0; pr < 10; pr++) {
      const pa = pr * Math.PI / 5;
      const pRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), mt(0x8a6a9a, { roughness: 1 }));
      pRock.position.set(Math.cos(pa) * (pp.r + 0.06), 0.03, Math.sin(pa) * (pp.r + 0.06));
      pool.add(pRock);
    }
    // Bright bio dots
    for (let gp = 0; gp < 10; gp++) {
      const ga = gp * Math.PI / 5;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3),
        mt(0xcc88ff, { emissive: 0xaa55dd, emissiveIntensity: 1.2 }));
      dot.position.set(Math.cos(ga) * pp.r * 0.5, 0.02, Math.sin(ga) * pp.r * 0.5);
      pool.add(dot);
      animatedObjects.push({ type: "blink", mesh: dot, speed: 0.25 + gp * 0.06, phase: gp * 1.0 + pi * 3 });
    }
    // pools self-lit via emissive
    pool.position.set(pp.x, 0.15, pp.z); hm.add(pool);
  });

  // ══════════════════════════════════════════════
  //   GLOWING CRYSTAL FORMATIONS
  // ══════════════════════════════════════════════
  const crColors = [0x66aaff, 0x88ccff, 0xaa88ff, 0x77bbee, 0x66ddcc, 0xff88dd];
  [{x: 4, z: 2}, {x: -3, z: -4}, {x: 7, z: -1}, {x: -5, z: 6},
   {x: 2, z: -7}, {x: -7, z: -2}, {x: 8, z: 4}, {x: -2, z: 8}].forEach((cp, ci) => {
    const cg = new THREE.Group();
    const numC = 3 + (ci % 4);
    for (let cr = 0; cr < numC; cr++) {
      const ch = 0.2 + Math.sin(ci + cr) * 0.12;
      const cw = 0.025 + Math.sin(cr * 2) * 0.01;
      const crCol = crColors[(ci + cr) % crColors.length];
      const crystal = new THREE.Mesh(new THREE.ConeGeometry(cw, ch, 5),
        mt(crCol, { emissive: crCol, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }));
      crystal.position.set(cr * 0.06 - 0.09, ch / 2, Math.sin(cr) * 0.04);
      crystal.rotation.z = Math.sin(cr + ci) * 0.2; cg.add(crystal);
    }
    // crystals self-lit via emissive, no point light needed
    cg.position.set(cp.x, 0.2, cp.z); hm.add(cg);
  });

  // ══════════════════════════════════════════════
  //   SPIRIT GATEWAY — glowing portal
  // ══════════════════════════════════════════════
  const gateway = new THREE.Group();
  const gateL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 0.15), mt(0x9a8ab0, { roughness: 1 }));
  gateL.position.set(-0.5, 0.9, 0); gateway.add(gateL);
  const gateR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.8, 0.15), mt(0x9a8ab0, { roughness: 1 }));
  gateR.position.set(0.5, 0.9, 0); gateway.add(gateR);
  const gateArch = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 12, Math.PI), mt(0x9a8ab0, { roughness: 1 }));
  gateArch.position.y = 1.8; gateArch.rotation.z = Math.PI; gateway.add(gateArch);
  const portalFill = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16),
    mt(0xcc88ff, { emissive: 0x9955dd, emissiveIntensity: 1.2, transparent: true, opacity: 0.4, side: 2 }));
  portalFill.position.y = 1.1; gateway.add(portalFill);

  gateway.position.set(5, 0.2, -3); gateway.rotation.y = -0.6; hm.add(gateway);

  // ══════════════════════════════════════════════
  //   STANDING STONES (ancient circle)
  // ══════════════════════════════════════════════
  for (let s = 0; s < 12; s++) {
    const sa = s * Math.PI / 6;
    const sr = 5.0;
    const stoneH = 0.8 + Math.sin(s * 1.7) * 0.25;
    const stone = new THREE.Mesh(new THREE.BoxGeometry(0.15, stoneH, 0.1), mt(0x9a8ab0, { roughness: 1 }));
    stone.position.set(Math.cos(sa) * sr, 0.2 + stoneH / 2, Math.sin(sa) * sr);
    stone.rotation.y = sa + Math.PI / 2; hm.add(stone);
    // Glowing runes on stones
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.002),
      mt(0xcc88ff, { emissive: 0x8844cc, emissiveIntensity: 0.6 }));
    rune.position.set(Math.cos(sa) * sr, 0.2 + stoneH * 0.6, Math.sin(sa) * sr + 0.052);
    rune.rotation.y = sa + Math.PI / 2; hm.add(rune);
  }

  // ══════════════════════════════════════════════
  //   FIREFLIES / SPIRIT LIGHTS (dense swarms)
  // ══════════════════════════════════════════════
  for (let sl = 0; sl < 40; sl++) {
    const sa2 = sl * Math.PI / 20 + Math.sin(sl) * 0.3;
    const spr = 1.5 + sl * 0.25;
    const fy = 0.5 + Math.sin(sl * 1.3) * 0.8 + Math.random() * 0.5;
    const fCol = sl % 4 === 0 ? 0xffddff : sl % 4 === 1 ? 0xddffdd : sl % 4 === 2 ? 0xffddaa : 0xaaddff;
    const fEmi = sl % 4 === 0 ? 0xdd88dd : sl % 4 === 1 ? 0x88dd88 : sl % 4 === 2 ? 0xdd8844 : 0x6688dd;
    const spirit = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3),
      mt(fCol, { emissive: fEmi, emissiveIntensity: 1.0, transparent: true, opacity: 0.7 }));
    spirit.position.set(Math.cos(sa2) * spr, fy, Math.sin(sa2) * spr);
    hm.add(spirit);
    animatedObjects.push({ type: "bob", mesh: spirit, speed: 0.1 + (sl % 7) * 0.04,
      baseY: fy, amp: 0.15, phase: sl * 1.2 });
  }

  // ── Floating light motes rising continuously ──
  for (let fm = 0; fm < 20; fm++) {
    const fma = fm * Math.PI / 10;
    const fmr = 2.0 + Math.sin(fm * 1.5) * 4.0;
    const mote = new THREE.Mesh(new THREE.SphereGeometry(0.008, 3, 2),
      mt(0xddbbff, { emissive: 0xbb88dd, emissiveIntensity: 1.5, transparent: true, opacity: 0.5 }));
    mote.position.set(Math.cos(fma) * fmr, 0.3 + Math.random() * 2.0, Math.sin(fma) * fmr);
    hm.add(mote);
    animatedObjects.push({ type: "bob", mesh: mote, speed: 0.05 + fm * 0.01,
      baseY: mote.position.y, amp: 0.3, phase: fm * 2.0 });
  }

  // ── Secondary trees with vines ──
  [{x: -7, z: -1, h: 2.0}, {x: 6, z: 5, h: 1.8}, {x: -3, z: 7, h: 1.5},
   {x: 8, z: -3, h: 1.6}, {x: -8, z: 5, h: 1.4}].forEach(td => {
    const tg = new THREE.Group();
    const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, td.h, 6), mt(0x4a3018, { roughness: 0.95 }));
    tk.position.y = td.h / 2; tg.add(tk);
    const cn1 = new THREE.Mesh(new THREE.SphereGeometry(0.35, 7, 5), mt(0x9a6abb));
    cn1.position.y = td.h; cn1.scale.set(1.2, 0.7, 1.2); tg.add(cn1);
    for (let v = 0; v < 3; v++) {
      const va = v * Math.PI * 2 / 3;
      const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 3), mt(0x8a5aaa));
      vine.position.set(Math.cos(va) * 0.2, td.h * 0.6, Math.sin(va) * 0.2); tg.add(vine);
    }
    tg.position.set(td.x, 0.18, td.z); hm.add(tg);
  });

  // ── Ferns (dense ground cover) ──
  for (let f = 0; f < 40; f++) {
    const fa = f * Math.PI * 2 / 40 + Math.sin(f) * 0.5;
    const fr = 2.0 + Math.sin(f * 1.9) * 3.0 + 2.5;
    const fern = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 4), mt(0xaa75dd));
    fern.position.set(Math.cos(fa) * fr, 0.2, Math.sin(fa) * fr); hm.add(fern);
  }

  // ── Moss-covered boulders ──
  for (let b = 0; b < 16; b++) {
    const ba = b * Math.PI / 8 + 0.15;
    const br = 3.0 + Math.sin(b * 2.3) * 3.5 + 2.0;
    const boulder = new THREE.Group();
    const bRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 + Math.sin(b) * 0.06, 1),
      mt(0x7a6a90, { roughness: 1 }));
    bRock.position.y = 0.06; bRock.scale.set(1, 0.6, 1); boulder.add(bRock);
    const bMoss = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(0x8a6aaa, { roughness: 1 }));
    bMoss.position.y = 0.06; bMoss.scale.set(1.1, 0.25, 1.1); boulder.add(bMoss);
    boulder.position.set(Math.cos(ba) * br, 0.15, Math.sin(ba) * br); hm.add(boulder);
  }

  // ── Spiral mossy path ──
  for (let ps = 0; ps < 16; ps++) {
    const pa = ps * Math.PI / 8 + 0.15;
    const pr = 3.0 + ps * 0.2;
    const pStone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 6), mt(0x8a7a9a, { roughness: 1 }));
    pStone.position.set(Math.cos(pa) * pr, 0.19, Math.sin(pa) * pr); hm.add(pStone);
    const rune = new THREE.Mesh(new THREE.CircleGeometry(0.03, 5),
      mt(0xcc88ff, { emissive: 0x8844cc, emissiveIntensity: 0.5, transparent: true, opacity: 0.6 }));
    rune.rotation.x = -Math.PI / 2;
    rune.position.set(Math.cos(pa) * pr, 0.21, Math.sin(pa) * pr); hm.add(rune);
  }

  // ── Soft fog patches (less opaque, magical tint) ──
  [{x: -5, z: 0, s: 2.5}, {x: 3, z: -6, s: 2.0}, {x: 7, z: 5, s: 1.8}].forEach(fp => {
    const fog = new THREE.Mesh(new THREE.SphereGeometry(fp.s, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xddccff, transparent: true, opacity: 0.06 }));
    fog.position.set(fp.x, 0.6, fp.z); fog.scale.set(1, 0.3, 1); hm.add(fog);
  });

  // ══════════════════════════════════════════════
  //   AMBIENT LIGHTING (single strong overhead)
  // ══════════════════════════════════════════════
  // [perf] removed: const ambi0 = new THREE.PointLight(0xccaaff, 4.0, 40);
  // [perf] removed: ambi0.position.set(0, 12, 0); hm.add(ambi0);

  scene.add(hm);
}


/* ═══════════════════════════════════════════════════════════
   Glacier Island — Frozen arctic outpost at the far north
   ═══════════════════════════════════════════════════════════ */
function createGlacierIsland() {
  const GL_X = -65, GL_Z = -55, GL_R = 11.0;
  const gl = new THREE.Group();
  gl.position.set(GL_X, 0, GL_Z);

  // ── Irregular icy coastline ──
  function getGlacierR(a) {
    let r = GL_R;
    r += Math.sin(a * 2) * 0.7 + Math.cos(a * 3) * 0.5 + Math.sin(a * 6) * 0.2;
    // Ice shelf extension to the south
    const dS = Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI);
    if (dS < 0.5) r += (0.5 - dS) * 3.5;
    // Fjord indent to the east
    const dE = Math.abs(a - 0.3);
    if (dE < 0.3) r -= (0.3 - dE) * 2.5;
    return r;
  }

  // ── Terrain height ──
  function getGlacierH(x, z) {
    const d = Math.sqrt(x * x + z * z);
    const central = Math.max(0, 1.0 - d / 5.0) * 1.5;
    const ridge = Math.max(0, 0.4 - Math.abs(x + 2) * 0.15) * (z < 2 ? 1 : 0.3);
    const hills = Math.sin(x * 0.4) * 0.15 + Math.cos(z * 0.5) * 0.12;
    return central + ridge + hills;
  }

  // ── Terrain mesh ──
  const glRes = 100;
  const glGeo = new THREE.PlaneGeometry(GL_R * 2.8, GL_R * 2.8, glRes, glRes);
  glGeo.rotateX(-Math.PI / 2);
  const glPos = glGeo.attributes.position;
  const glColors = new Float32Array(glPos.count * 3);
  const SNOW = new THREE.Color(0xeef4f8);
  const ICE = new THREE.Color(0xc8dde8);
  const DEEP_ICE = new THREE.Color(0x8ab0c8);
  const ROCK = new THREE.Color(0x6a7a80);

  for (let i = 0; i < glPos.count; i++) {
    const x = glPos.getX(i), z = glPos.getZ(i);
    const a = Math.atan2(z, x);
    const d = Math.sqrt(x * x + z * z);
    const edgeR = getGlacierR(a);
    const edgeFade = 1 - smoothstep(edgeR - 2.5, edgeR, d);
    if (d > edgeR + 0.4) { glPos.setY(i, -0.5); }
    else if (d > edgeR - 0.5) {
      const iceT = smoothstep(edgeR - 0.5, edgeR + 0.4, d);
      glPos.setY(i, THREE.MathUtils.lerp(getGlacierH(x, z) * edgeFade + 0.15, -0.06, iceT));
    } else {
      glPos.setY(i, getGlacierH(x, z) * edgeFade + 0.15);
    }
    const h = glPos.getY(i);
    let c;
    if (d > edgeR - 0.8) {
      c = ICE.clone().lerp(DEEP_ICE, 0.5);
    } else if (h > 1.0) {
      c = ROCK.clone().lerp(SNOW, smoothstep(1.0, 1.5, h));
    } else {
      const snowVar = Math.sin(x * 1.5) * 0.15 + Math.cos(z * 1.8) * 0.1 + 0.5;
      c = SNOW.clone().lerp(ICE, snowVar);
    }
    glColors[i * 3] = c.r; glColors[i * 3 + 1] = c.g; glColors[i * 3 + 2] = c.b;
  }
  glGeo.setAttribute("color", new THREE.BufferAttribute(glColors, 3));
  glGeo.computeVertexNormals();
  const glTerrain = new THREE.Mesh(glGeo, mt(0xeef4f8, { vertexColors: true, roughness: 0.7, emissive: 0x405060, emissiveIntensity: 0.12 }));
  glTerrain.receiveShadow = true; gl.add(glTerrain);

  // ── Cliff underside (icy blue) ──
  const icSegs = 120;
  const icGeo = new THREE.BufferGeometry();
  const icV = [], icN = [], icC = [];
  for (let i = 0; i < icSegs; i++) {
    const a0 = (i / icSegs) * Math.PI * 2;
    const a1 = ((i + 1) / icSegs) * Math.PI * 2;
    const r0 = getGlacierR(a0), r1 = getGlacierR(a1);
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const bulge = 0.1 + Math.sin(a0 * 4) * 0.04;
    const mx0 = x0 + Math.cos(a0) * bulge, mz0 = z0 + Math.sin(a0) * bulge;
    const mx1 = x1 + Math.cos(a1) * bulge, mz1 = z1 + Math.sin(a1) * bulge;
    const sCol = [0.78, 0.85, 0.90], rCol = [0.50, 0.65, 0.75];
    icV.push(x0, -0.1, z0, mx0, -0.28, mz0, x1, -0.1, z1);
    icV.push(x1, -0.1, z1, mx0, -0.28, mz0, mx1, -0.28, mz1);
    for (let t = 0; t < 6; t++) { icC.push(...sCol); icN.push(Math.cos(a0), 0, Math.sin(a0)); }
    icV.push(mx0, -0.2, mz0, x0 * 0.95, -0.5, z0 * 0.95, mx1, -0.2, mz1);
    icV.push(mx1, -0.2, mz1, x0 * 0.95, -0.5, z0 * 0.95, x1 * 0.95, -0.5, z1 * 0.95);
    for (let t = 0; t < 6; t++) { icC.push(...rCol); icN.push(Math.cos(a0), -0.3, Math.sin(a0)); }
  }
  icGeo.setAttribute("position", new THREE.Float32BufferAttribute(icV, 3));
  icGeo.setAttribute("normal", new THREE.Float32BufferAttribute(icN, 3));
  icGeo.setAttribute("color", new THREE.Float32BufferAttribute(icC, 3));
  icGeo.computeVertexNormals();
  gl.add(new THREE.Mesh(icGeo, mt(0x8ab0c8, { vertexColors: true, roughness: 0.6 })));

  // ═══ GLACIER MOUNTAINS ═══
  const mountains = [
    { x: -2, z: -1, r: 2.5, h: 4.0 },
    { x: 1, z: -3, r: 1.8, h: 3.0 },
    { x: -4, z: 1, r: 1.5, h: 2.5 },
    { x: 0, z: 2, r: 1.2, h: 2.0 },
    { x: 3, z: 0, r: 1.0, h: 1.8 },
  ];
  mountains.forEach(m => {
    const peak = new THREE.Mesh(new THREE.ConeGeometry(m.r, m.h, 10), mt(0xd0dce5, { roughness: 0.6 }));
    peak.position.set(m.x, 0.15 + m.h / 2, m.z); gl.add(peak);
    // Snow cap (brighter white)
    const cap = new THREE.Mesh(new THREE.ConeGeometry(m.r * 0.4, m.h * 0.25, 8), mt(0xf8fcff));
    cap.position.set(m.x, 0.15 + m.h * 0.85, m.z); gl.add(cap);
    // Rocky patches on lower slopes
    for (let rp = 0; rp < 3; rp++) {
      const ra = rp * Math.PI * 2 / 3 + m.x;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.08, 0), mt(0x5a6a70, { roughness: 1 }));
      rock.position.set(m.x + Math.cos(ra) * m.r * 0.6, 0.3, m.z + Math.sin(ra) * m.r * 0.6);
      gl.add(rock);
    }
  });

  // ═══ GLACIER CASTLE — ice palace ═══
  const castle = new THREE.Group();
  // Main keep
  const keep = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.0, 1.2),
    mt(0xc8e0f0, { transparent: true, opacity: 0.85, roughness: 0.3, metalness: 0.1 }));
  keep.position.y = 1.0; castle.add(keep);
  // Tall ice towers at corners
  [{x: -0.7, z: -0.55}, {x: 0.7, z: -0.55}, {x: -0.7, z: 0.55}, {x: 0.7, z: 0.55}].forEach(tp => {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2.8, 8),
      mt(0xd0e8f5, { transparent: true, opacity: 0.8, roughness: 0.3 }));
    tower.position.set(tp.x, 1.4, tp.z); castle.add(tower);
    const turret = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), mt(0xb8d0e8, { roughness: 0.4 }));
    turret.position.set(tp.x, 2.95, tp.z); castle.add(turret);
  });
  // Central tall spire
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 3.5, 8),
    mt(0xd8eaf5, { transparent: true, opacity: 0.75, roughness: 0.2 }));
  spire.position.y = 1.75; castle.add(spire);
  const spireTop = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 6), mt(0xe0f0ff, { roughness: 0.3 }));
  spireTop.position.y = 3.7; castle.add(spireTop);
  // Gate / archway
  const gateL2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.15), mt(0xb0c8d8, { roughness: 0.4 }));
  gateL2.position.set(-0.2, 0.3, -0.62); castle.add(gateL2);
  const gateR2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.15), mt(0xb0c8d8, { roughness: 0.4 }));
  gateR2.position.set(0.2, 0.3, -0.62); castle.add(gateR2);
  const gateTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.15), mt(0xb0c8d8, { roughness: 0.4 }));
  gateTop.position.set(0, 0.62, -0.62); castle.add(gateTop);
  // Warm windows
  [{x: -0.3, y: 0.8, z: -0.61}, {x: 0.3, y: 0.8, z: -0.61}, {x: -0.3, y: 1.3, z: -0.61}, {x: 0.3, y: 1.3, z: -0.61}].forEach(wp => {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.01),
      mt(0xffeeaa, { emissive: 0xffcc44, emissiveIntensity: 0.5 }));
    win.position.set(wp.x, wp.y, wp.z); castle.add(win);
  });
  // Castle glow
  // [perf] removed: const castleLight = new THREE.PointLight(0xaaccff, 0.5, 8);
  // [perf] removed: castleLight.position.y = 2; castle.add(castleLight);
  // Ice wall / battlements
  for (let bm = 0; bm < 12; bm++) {
    const ba = bm * Math.PI / 6;
    const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.1),
      mt(0xc0d8e8, { transparent: true, opacity: 0.7, roughness: 0.4 }));
    merlon.position.set(Math.cos(ba) * 1.2, 0.1, Math.sin(ba) * 1.2);
    merlon.rotation.y = ba; castle.add(merlon);
  }
  castle.position.set(3, 0.25, -3); castle.rotation.y = 0.3; gl.add(castle);

  // ═══ IGLOOS ═══
  [{x: -5, z: 3, s: 1}, {x: -6.5, z: 4.5, s: 0.7}, {x: -4, z: 5, s: 0.85}, {x: -7, z: 2, s: 0.6}].forEach(ig => {
    const igloo = new THREE.Group();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.35 * ig.s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(0xf0f4f8, { roughness: 0.8 }));
    dome.position.y = 0.0; igloo.add(dome);
    // Entry tunnel
    const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * ig.s, 0.12 * ig.s, 0.25 * ig.s, 6),
      mt(0xe8ecf0, { roughness: 0.8 }));
    tunnel.rotation.z = Math.PI / 2;
    tunnel.position.set(0.35 * ig.s, 0.06 * ig.s, 0); igloo.add(tunnel);
    // Dark entrance
    const entry = new THREE.Mesh(new THREE.CircleGeometry(0.08 * ig.s, 6), mt(0x506070));
    entry.position.set(0.47 * ig.s, 0.06 * ig.s, 0); entry.rotation.y = Math.PI / 2; igloo.add(entry);
    // Warm glow from inside
    if (ig.s > 0.8) {
    }
    // Snow blocks visible
    for (let sb = 0; sb < 8; sb++) {
      const sba = sb * Math.PI / 4;
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.1 * ig.s, 0.04 * ig.s, 0.08 * ig.s), mt(0xf4f8fc, { roughness: 0.9 }));
      block.position.set(Math.cos(sba) * 0.3 * ig.s, 0.02, Math.sin(sba) * 0.3 * ig.s);
      block.rotation.y = sba; igloo.add(block);
    }
    igloo.position.set(ig.x, 0.18, ig.z); igloo.rotation.y = Math.sin(ig.x) * 0.5; gl.add(igloo);
  });

  // ═══ PENGUINS ═══
  function makePenguin(px, pz, rot, variant) {
    const pg = new THREE.Group();
    // Body (black back, white belly)
    const pBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.06, 5, 6), mt(0x4a4a5a));
    pBody.position.y = 0.06; pg.add(pBody);
    // White belly patch
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.04, 4, 5), mt(0xf0f0f0));
    belly.position.set(0, 0.06, 0.012); pg.add(belly);
    // Head
    const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), mt(0x4a4a5a));
    pHead.position.y = 0.12; pg.add(pHead);
    // White face patches
    for (const ex of [-0.01, 0.01]) {
      const patch = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 3), mt(0xf0f0f0));
      patch.position.set(ex, 0.12, 0.018); pg.add(patch);
    }
    // Orange beak
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.015, 3), mt(0xf0a030));
    beak.position.set(0, 0.115, 0.025); beak.rotation.x = Math.PI / 2; pg.add(beak);
    // Eyes
    for (const ex of [-0.008, 0.008]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.003, 4, 3), mt(0x6a6a6a));
      eye.position.set(ex, 0.125, 0.023); pg.add(eye);
    }
    // Flippers
    for (const fx of [-0.032, 0.032]) {
      const flip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.02), mt(0x4a4a5a));
      flip.position.set(fx, 0.06, 0); flip.rotation.z = fx > 0 ? -0.3 : 0.3; pg.add(flip);
    }
    // Orange feet
    for (const fx of [-0.012, 0.012]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.004, 0.015), mt(0xf0a030));
      foot.position.set(fx, 0.005, 0.005); pg.add(foot);
    }
    // Emperor penguins get yellow chest patch
    if (variant === "emperor") {
      const chest = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3), mt(0xf0d040));
      chest.position.set(0, 0.09, 0.02); pg.add(chest);
    }
    pg.position.set(px, 0.18, pz); pg.rotation.y = rot; gl.add(pg);
    return pg;
  }
  // Colony of penguins
  makePenguin(-5, 5.5, 0.2, "emperor");
  makePenguin(-4.5, 6, -0.3, "emperor");
  makePenguin(-5.5, 6.2, 0.8, "emperor");
  makePenguin(-4.8, 5.8, -0.5, "normal");
  makePenguin(-5.2, 6.5, 0.1, "normal");
  makePenguin(-4.3, 5.5, 1.0, "normal");
  makePenguin(-5.8, 5.5, -0.8, "normal");
  makePenguin(-4.6, 6.5, 0.4, "emperor");
  // Baby penguins (fluffy grey)
  for (let bp = 0; bp < 4; bp++) {
    const baby = makePenguin(-5 + bp * 0.35, 6.0 + Math.sin(bp) * 0.3, bp * 0.8, "normal");
    baby.scale.set(0.55, 0.55, 0.55);
    // Override body color to grey fluff
    baby.children[0].material = mt(0x6a6a7a);
    baby.children[2].material = mt(0x6a6a7a);
  }

  // ═══ POLAR BEAR ═══
  function makePolarBear(bx, bz, rot) {
    const bear = new THREE.Group();
    // Massive body
    const bBody = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mt(0xf0ece0));
    bBody.scale.set(1.2, 0.85, 1.5); bBody.position.y = 0.1; bear.add(bBody);
    // Head
    const bHead = new THREE.Mesh(new THREE.SphereGeometry(0.06, 7, 5), mt(0xf0ece0));
    bHead.position.set(0, 0.14, 0.15); bHead.scale.set(1, 0.9, 1.1); bear.add(bHead);
    // Snout
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 4), mt(0xf0ece0));
    snout.position.set(0, 0.12, 0.2); snout.scale.set(1, 0.7, 1.2); bear.add(snout);
    // Nose
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.01, 4, 3), mt(0x6a6a6a));
    nose.position.set(0, 0.13, 0.24); bear.add(nose);
    // Ears
    for (const ex of [-0.03, 0.03]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.015, 5, 4), mt(0xe8e0d8));
      ear.position.set(ex, 0.19, 0.12); bear.add(ear);
    }
    // Eyes
    for (const ex of [-0.02, 0.02]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.006, 4, 3), mt(0x6a6a6a));
      eye.position.set(ex, 0.15, 0.19); bear.add(eye);
    }
    // Legs (thick)
    [{x: -0.06, z: 0.08}, {x: 0.06, z: 0.08}, {x: -0.06, z: -0.08}, {x: 0.06, z: -0.08}].forEach(lp => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.022, 0.08, 5), mt(0xf0ece0));
      leg.position.set(lp.x, 0.01, lp.z); bear.add(leg);
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0xe0d8d0));
      paw.position.set(lp.x, -0.02, lp.z); paw.scale.set(1, 0.5, 1.2); bear.add(paw);
    });
    // Short tail
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3), mt(0xf0ece0));
    tail.position.set(0, 0.1, -0.16); bear.add(tail);
    bear.position.set(bx, 0.18, bz); bear.rotation.y = rot; gl.add(bear);
    return bear;
  }
  makePolarBear(6, 4, -1.2);
  // Mother and cub
  makePolarBear(-8, -2, 0.8);
  const cub = makePolarBear(-7.5, -1.5, 0.6);
  cub.scale.set(0.5, 0.5, 0.5);

  // ═══ ICE FORMATIONS / ICEBERGS ═══
  [{x: 8, z: -2, s: 0.8}, {x: -9, z: -5, s: 0.6}, {x: 5, z: 7, s: 0.7},
   {x: -3, z: -8, s: 0.5}, {x: 10, z: 2, s: 0.9}, {x: -7, z: -7, s: 0.55}].forEach(ib => {
    const berg = new THREE.Group();
    const main = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 * ib.s, 1),
      mt(0xc0e0f0, { transparent: true, opacity: 0.75, roughness: 0.3 }));
    main.position.y = 0.15 * ib.s; main.scale.set(1.3, 0.8, 1); berg.add(main);
    const top = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15 * ib.s, 0),
      mt(0xe0f0ff, { transparent: true, opacity: 0.8, roughness: 0.4 }));
    top.position.set(0.05, 0.3 * ib.s, 0); berg.add(top);
    berg.position.set(ib.x, 0.15, ib.z); berg.rotation.y = Math.sin(ib.x) * 2; gl.add(berg);
  });

  // ═══ FROZEN LAKE ═══
  const lake = new THREE.Group();
  const lakeIce = new THREE.Mesh(new THREE.CircleGeometry(1.5, 16),
    mt(0xb8d8e8, { transparent: true, opacity: 0.6, roughness: 0.2, metalness: 0.1 }));
  lakeIce.rotation.x = -Math.PI / 2; lakeIce.position.y = 0.17; lake.add(lakeIce);
  // Cracks in ice
  for (let cr = 0; cr < 6; cr++) {
    const ca = cr * Math.PI / 3;
    const crack = new THREE.Mesh(new THREE.BoxGeometry(0.8 + Math.sin(cr) * 0.3, 0.002, 0.01), mt(0x90b8d0));
    crack.position.set(Math.cos(ca) * 0.3, 0.175, Math.sin(ca) * 0.3);
    crack.rotation.y = ca + 0.5; lake.add(crack);
  }
  lake.position.set(-2, 0, 5); gl.add(lake);

  // ═══ AURORA BOREALIS POLES (tall crystalline pillars) ═══
  for (let ap = 0; ap < 4; ap++) {
    const aa = ap * Math.PI / 2 + 0.3;
    const ar = 7;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.5, 6),
      mt(0x88ddaa, { emissive: 0x44aa66, emissiveIntensity: 0.3, transparent: true, opacity: 0.6 }));
    pillar.position.set(Math.cos(aa) * ar, 0.93, Math.sin(aa) * ar); gl.add(pillar);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4),
      mt(0xaaffcc, { emissive: 0x66dd88, emissiveIntensity: 0.6 }));
    tip.position.set(Math.cos(aa) * ar, 1.7, Math.sin(aa) * ar); gl.add(tip);
    animatedObjects.push({ type: "blink", mesh: tip, speed: 0.1 + ap * 0.03, phase: ap * 2 });
  }

  // ═══ SNOW-COVERED EVERGREEN TREES ═══
  [{x: -3, z: -4, h: 0.8}, {x: 1, z: -6, h: 0.7}, {x: -6, z: -3, h: 0.65},
   {x: 4, z: -5, h: 0.75}, {x: -1, z: -7, h: 0.6}, {x: 7, z: -4, h: 0.55},
   {x: -5, z: -6, h: 0.7}, {x: 3, z: -7, h: 0.5}, {x: -8, z: -4, h: 0.6},
   {x: 6, z: -6, h: 0.65}, {x: -4, z: -5, h: 0.72}, {x: 2, z: -4, h: 0.58}].forEach(td => {
    const tg = new THREE.Group();
    const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, td.h * 0.35, 4), mt(0x705848));
    tk.position.y = td.h * 0.18; tg.add(tk);
    for (let l = 0; l < 3; l++) {
      const ly = new THREE.Mesh(new THREE.ConeGeometry(0.12 - l * 0.025, 0.2, 6), mt(0x1a4a1a));
      ly.position.y = td.h * 0.3 + l * 0.12; tg.add(ly);
      // Snow on branches
      const snow = new THREE.Mesh(new THREE.ConeGeometry(0.1 - l * 0.02, 0.04, 6), mt(0xf0f4f8));
      snow.position.y = td.h * 0.32 + l * 0.12; tg.add(snow);
    }
    tg.position.set(td.x, 0.18, td.z); gl.add(tg);
  });

  // ═══ SEAL on ice ═══
  const seal = new THREE.Group();
  const sBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.1, 5, 6), mt(0x7a7a80));
  sBody.rotation.z = Math.PI / 2; sBody.position.y = 0.02; seal.add(sBody);
  const sHead = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), mt(0x7a7a80));
  sHead.position.set(0, 0.03, 0.06); seal.add(sHead);
  const sNose = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 3), mt(0x555555));
  sNose.position.set(0, 0.03, 0.085); seal.add(sNose);
  for (const ex of [-0.01, 0.01]) {
    const sEye = new THREE.Mesh(new THREE.SphereGeometry(0.004, 4, 3), mt(0x6a6a6a));
    sEye.position.set(ex, 0.04, 0.075); seal.add(sEye);
  }
  // Flippers
  for (const fx of [-0.03, 0.03]) {
    const flip = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.005, 0.015), mt(0x6a6a70));
    flip.position.set(fx, 0.01, -0.02); flip.rotation.z = fx > 0 ? -0.3 : 0.3; seal.add(flip);
  }
  seal.position.set(-1.5, 0.2, 5.5); seal.rotation.y = 0.5; gl.add(seal);

  // ═══ SNOWMAN ═══
  const snowman = new THREE.Group();
  const smBot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mt(0xf8fcff));
  smBot.position.y = 0.08; snowman.add(smBot);
  const smMid = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), mt(0xf8fcff));
  smMid.position.y = 0.2; snowman.add(smMid);
  const smTop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), mt(0xf8fcff));
  smTop.position.y = 0.3; snowman.add(smTop);
  // Carrot nose
  const carrot = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.04, 4), mt(0xf08020));
  carrot.position.set(0, 0.3, 0.05); carrot.rotation.x = Math.PI / 2; snowman.add(carrot);
  // Coal eyes
  for (const ex of [-0.015, 0.015]) {
    const coal = new THREE.Mesh(new THREE.SphereGeometry(0.005, 4, 3), mt(0x6a6a6a));
    coal.position.set(ex, 0.32, 0.04); snowman.add(coal);
  }
  // Stick arms
  for (const ax of [-0.08, 0.08]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 3), mt(0x5a3a18));
    arm.position.set(ax, 0.2, 0); arm.rotation.z = ax > 0 ? -0.8 : 0.8; snowman.add(arm);
  }
  // Scarf
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 4, 8), mt(0xd03030));
  scarf.rotation.x = -Math.PI / 2; scarf.position.y = 0.24; snowman.add(scarf);
  snowman.position.set(-4, 0.18, 4); gl.add(snowman);

  // ═══ SNOW DRIFTS ═══
  for (let sd = 0; sd < 15; sd++) {
    const da = sd * Math.PI * 2 / 15;
    const dr = 4 + Math.sin(sd * 2.1) * 3;
    const drift = new THREE.Mesh(new THREE.SphereGeometry(0.3 + Math.sin(sd) * 0.1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(0xf0f4f8, { roughness: 0.8 }));
    drift.position.set(Math.cos(da) * dr, 0.18, Math.sin(da) * dr);
    drift.scale.set(1.5, 0.3, 1); drift.rotation.y = da; gl.add(drift);
  }

  // ═══ FISHING HOLE IN ICE ═══
  const hole = new THREE.Group();
  const holeRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 4, 8), mt(0xd8e8f0, { roughness: 0.5 }));
  holeRing.rotation.x = -Math.PI / 2; holeRing.position.y = 0.19; hole.add(holeRing);
  const holeWater = new THREE.Mesh(new THREE.CircleGeometry(0.1, 8),
    mt(0x2070a0, { transparent: true, opacity: 0.5 }));
  holeWater.rotation.x = -Math.PI / 2; holeWater.position.y = 0.15; hole.add(holeWater);
  // Fishing rod
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.4, 3), mt(0x6a4a2a));
  rod.position.set(0.1, 0.35, 0); rod.rotation.z = 0.5; hole.add(rod);
  hole.position.set(0, 0, 6); gl.add(hole);

  scene.add(gl);
}


/* ═══════════════════════════════════════════════════════════
   Mont-Saint-Michel — Stacked-box medieval abbey island
   ═══════════════════════════════════════════════════════════ */
function createMontSaintMichel() {
  const MS_X = 22, MS_Z = -18;
  const msm = new THREE.Group();
  msm.position.set(MS_X, 0, MS_Z);

  // Colors per spec
  const CREAM  = 0xd8cfc0;   // pale cream stone walls
  const GRAY   = 0x8b8b85;   // medium gray rock
  const SLATE  = 0x4a4e5a;   // dark slate roofs
  const GOLD   = 0xd4af37;   // spire tip

  // ══════════════════════════════════════════════
  //   STEP 1 — ROCK BASE (rough dome, mostly hidden)
  // ══════════════════════════════════════════════
  const baseGeo = new THREE.ConeGeometry(3, 2.5, 12);
  const basePos = baseGeo.attributes.position;
  for (let i = 0; i < basePos.count; i++) {
    const x = basePos.getX(i), z = basePos.getZ(i);
    basePos.setX(i, x + (Math.random() - 0.5) * 0.25);
    basePos.setZ(i, z + (Math.random() - 0.5) * 0.25);
  }
  baseGeo.computeVertexNormals();
  const baseMesh = new THREE.Mesh(baseGeo, mt(GRAY, { roughness: 0.95, emissive: 0x504838, emissiveIntensity: 0.15 }));
  baseMesh.position.y = 1.25; msm.add(baseMesh);

  // ══════════════════════════════════════════════
  //   STEP 2 — CURTAIN WALL (irregular polygon)
  // ══════════════════════════════════════════════
  const wallR = 3.2, wallH = 0.6, wallThick = 0.15;
  const wallPts = 14;
  for (let w = 0; w < wallPts; w++) {
    const a0 = (w / wallPts) * Math.PI * 2;
    const a1 = ((w + 1) / wallPts) * Math.PI * 2;
    const r0 = wallR + Math.sin(a0 * 3) * 0.2 + Math.cos(a0 * 5) * 0.1;
    const r1 = wallR + Math.sin(a1 * 3) * 0.2 + Math.cos(a1 * 5) * 0.1;
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    const ang = Math.atan2(dz, dx);
    const seg = new THREE.Mesh(
      new THREE.BoxGeometry(len, wallH, wallThick), mt(CREAM, { roughness: 0.9 }));
    seg.position.set((x0 + x1) / 2, wallH / 2 + 0.1, (z0 + z1) / 2);
    seg.rotation.y = -ang; msm.add(seg);
  }

  // 6 cylindrical towers along the wall
  const towerAngles = [0.3, 1.3, 2.3, 3.3, 4.3, 5.3];
  towerAngles.forEach(ta => {
    const tr = wallR + Math.sin(ta * 3) * 0.2;
    const tx = Math.cos(ta) * tr, tz = Math.sin(ta) * tr;
    const tH = 0.9;
    const tBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.28, tH, 8), mt(CREAM, { roughness: 0.9 }));
    tBody.position.set(tx, tH / 2 + 0.1, tz); msm.add(tBody);
    const tRoof = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.35, 8), mt(SLATE));
    tRoof.position.set(tx, tH + 0.27, tz); msm.add(tRoof);
  });

  // ══════════════════════════════════════════════
  //   STEP 3 — THE VILLAGE (50 small box buildings)
  // ══════════════════════════════════════════════
  // The rock is ConeGeometry(radius=3, height=2.5) at position.y=1.25
  // So the cone surface at horizontal distance r from center is:
  //   y = 2.5 * (1 - r/3)
  // We add a small offset so buildings sit ON the surface, not inside it.
  function getRockY(r) {
    return 2.5 * (1 - Math.min(r / 3.0, 1)) + 0.08;
  }

  // 50 village buildings between r=1.8 (near abbey) and r=3.0 (near wall)
  for (let i = 0; i < 50; i++) {
    const r = 1.8 + Math.random() * 1.2;           // radius 1.8 to 3.0
    const a = Math.random() * Math.PI * 2;          // full circle
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const by = getRockY(r);

    const bw = 0.25 + Math.random() * 0.15;        // width  0.25-0.40
    const bd = 0.25 + Math.random() * 0.15;        // depth  0.25-0.40
    const bh = 0.4 + Math.random() * 0.5;          // height 0.40-0.90
    const roofH = 0.25 + Math.random() * 0.15;     // roof   0.25-0.40

    const house = new THREE.Group();
    // Cream stone walls
    const walls = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd),
      mt(CREAM, { roughness: 0.9 }));
    walls.position.y = bh / 2; house.add(walls);
    // Dark slate pitched roof (4-sided cone = pyramid)
    const roofW = Math.max(bw, bd);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(roofW * 0.72, roofH, 4), mt(SLATE));
    roof.position.y = bh + roofH / 2 - 0.02;
    roof.rotation.y = Math.PI / 4; house.add(roof);
    // Small glowing window
    if (Math.random() > 0.3) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.01),
        mt(0xffeeaa, { emissive: 0xffcc44, emissiveIntensity: 0.15 }));
      win.position.set(0, bh * 0.5, bd / 2 + 0.006); house.add(win);
    }

    house.position.set(bx, by, bz);
    house.rotation.y = (Math.random() - 0.5) * 0.7;  // random 0-40deg
    msm.add(house);
  }

  // ══════════════════════════════════════════════
  //   STEP 4 — MIDDLE TERRACE (inner wall + buildings + trees)
  // ══════════════════════════════════════════════
  const midR = 1.6, midWH = 0.4;
  const midWall = new THREE.Mesh(
    new THREE.TorusGeometry(midR, 0.06, 6, 16), mt(CREAM, { roughness: 0.9 }));
  midWall.rotation.x = -Math.PI / 2;
  midWall.position.y = getRockY(midR) + midWH / 2;
  msm.add(midWall);

  // 8 mid-tier buildings
  for (let mb = 0; mb < 8; mb++) {
    const ma = (mb / 8) * Math.PI * 2 + 0.25;
    const mr = 0.8 + Math.random() * 0.8;
    const mh = 0.5 + Math.random() * 0.4;
    const mw = 0.3 + Math.random() * 0.1;
    const md = 0.25 + Math.random() * 0.1;
    const mx = Math.cos(ma) * mr, mz = Math.sin(ma) * mr;
    const my = getRockY(mr);

    const bldg = new THREE.Group();
    const bw = new THREE.Mesh(new THREE.BoxGeometry(mw, mh, md),
      mt(CREAM, { roughness: 0.85 }));
    bw.position.y = mh / 2; bldg.add(bw);
    const rH = 0.3;
    const br = new THREE.Mesh(
      new THREE.ConeGeometry(Math.max(mw, md) * 0.65, rH, 4), mt(SLATE));
    br.position.y = mh + rH / 2 - 0.02;
    br.rotation.y = Math.PI / 4; bldg.add(br);
    bldg.position.set(mx, my, mz);
    bldg.rotation.y = ma + Math.PI + Math.random() * 0.5; msm.add(bldg);
  }

  // 6 dark green tree spheres
  for (let t = 0; t < 6; t++) {
    const ta = t * Math.PI / 3 + Math.random() * 0.5;
    const tr = 0.9 + Math.random() * 0.6;
    const tree = new THREE.Mesh(
      new THREE.SphereGeometry(0.08 + Math.random() * 0.04, 5, 4),
      mt(0x3a7a30, { roughness: 0.9 }));
    tree.scale.y = 1.2;
    tree.position.set(Math.cos(ta) * tr, getRockY(tr) + 0.08, Math.sin(ta) * tr);
    msm.add(tree);
  }

  // ══════════════════════════════════════════════
  //   STEP 5 — ABBEY (large box at summit)
  // ══════════════════════════════════════════════
  const abbey = new THREE.Group();
  const abbeyW = 1.2, abbeyD = 0.8, abbeyH = 1.4;
  const abbeyY = getRockY(0) + 0.1;

  // Main nave
  const nave = new THREE.Mesh(new THREE.BoxGeometry(abbeyW, abbeyH, abbeyD),
    mt(CREAM, { roughness: 0.8 }));
  nave.position.y = abbeyH / 2; abbey.add(nave);

  // Pitched roof
  const nRoofH = 0.5;
  const nRoof = new THREE.Mesh(
    new THREE.ConeGeometry(abbeyW * 0.55, nRoofH, 4), mt(SLATE));
  nRoof.position.y = abbeyH + nRoofH / 2 - 0.02;
  nRoof.rotation.y = Math.PI / 4; abbey.add(nRoof);

  // 6 flying buttresses along both long sides
  for (let bi = 0; bi < 6; bi++) {
    const bSide = bi < 3 ? -1 : 1;
    const bOff = (bi % 3 - 1) * 0.35;
    // Vertical pier
    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, abbeyH * 0.8, 0.12), mt(CREAM, { roughness: 0.9 }));
    pier.position.set(bOff, abbeyH * 0.4, bSide * (abbeyD / 2 + 0.18));
    abbey.add(pier);
    // Angled strut connecting pier to nave wall
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.45, 0.06), mt(CREAM, { roughness: 0.9 }));
    strut.position.set(bOff, abbeyH * 0.65, bSide * (abbeyD / 2 + 0.09));
    strut.rotation.x = bSide * 0.5; abbey.add(strut);
    // Small pinnacle on top of pier
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 4), mt(SLATE));
    pin.position.set(bOff, abbeyH * 0.8 + 0.08, bSide * (abbeyD / 2 + 0.18));
    abbey.add(pin);
  }

  // Rose window
  const roseWin = new THREE.Mesh(new THREE.CircleGeometry(0.08, 10),
    mt(0x4060a0, { emissive: 0x2040a0, emissiveIntensity: 0.4 }));
  roseWin.position.set(abbeyW / 2 + 0.01, abbeyH * 0.65, 0);
  roseWin.rotation.y = Math.PI / 2; abbey.add(roseWin);

  abbey.position.y = abbeyY; msm.add(abbey);

  // ══════════════════════════════════════════════
  //   STEP 6 — SPIRE
  // ══════════════════════════════════════════════
  const spireBaseY = abbeyY + abbeyH + nRoofH - 0.1;

  // Small square tower base
  const spireTower = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.5, 0.35), mt(CREAM));
  spireTower.position.set(0, spireBaseY + 0.25, 0);
  msm.add(spireTower);

  // Spire — proportional to tower, not needle-thin
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(0.15, 1.1, 8), mt(SLATE));
  spire.position.set(0, spireBaseY + 0.5 + 0.55, 0);
  msm.add(spire);

  // Gold sphere at apex
  const goldTip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4),
    mt(GOLD, { roughness: 0.2, metalness: 0.8 }));
  goldTip.position.set(0, spireBaseY + 0.5 + 1.1 + 0.05, 0); msm.add(goldTip);

  // Vegetation around base
  for (let v = 0; v < 10; v++) {
    const va = Math.random() * Math.PI * 2;
    const vr = 2.5 + Math.random() * 0.8;
    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(0.04 + Math.random() * 0.03, 4, 3), mt(0x3a6a2a));
    bush.scale.y = 0.5;
    bush.position.set(Math.cos(va) * vr, getRockY(vr) - 0.02, Math.sin(va) * vr);
    msm.add(bush);
  }

  // Warm abbey glow
  const abbeyGlow = new THREE.PointLight(0xffe8c0, 0.5, 6);
  abbeyGlow.position.set(0, abbeyY + abbeyH, 0); msm.add(abbeyGlow);

  // Fill light to prevent dark faces
  // [perf] removed: const msFill = new THREE.PointLight(0xd8d0c0, 0.4, 8);
  // [perf] removed: msFill.position.set(0, 1.5, 0); msm.add(msFill);

  scene.add(msm);

  // ══════════════════════════════════════════════
  //   NARROW STONE CAUSEWAY
  // ══════════════════════════════════════════════
  const msBA = Math.atan2(MS_Z, MS_X);
  const mainEdge = getIslandRadius(msBA);
  const cb1X = Math.cos(msBA) * (mainEdge - 0.8);
  const cb1Z = Math.sin(msBA) * (mainEdge - 0.8);
  const cb2X = MS_X + Math.cos(msBA + Math.PI) * 4.0;
  const cb2Z = MS_Z + Math.sin(msBA + Math.PI) * 4.0;

  const cwG = new THREE.Group();
  const cwDx = cb2X - cb1X, cwDz = cb2Z - cb1Z;
  const cwLen = Math.sqrt(cwDx * cwDx + cwDz * cwDz);
  const cwAng = Math.atan2(cwDz, cwDx);
  const cwSegs = Math.floor(cwLen / 0.25);

  const CW_STONE = 0xc0b8a8;
  for (let i = 0; i < cwSegs; i++) {
    const t = (i + 0.5) / cwSegs;
    const cx = cb1X + cwDx * t, cz = cb1Z + cwDz * t;
    const archH = 0.025 * Math.sin(t * Math.PI);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 0.18),
      mt(i % 2 === 0 ? CREAM : CW_STONE, { roughness: 1 }));
    slab.position.set(cx, archH + 0.005, cz);
    slab.rotation.y = -cwAng; cwG.add(slab);
    if (i % 4 === 0) {
      const perpX = -Math.sin(cwAng), perpZ = Math.cos(cwAng);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.04, 0.025),
          mt(CW_STONE, { roughness: 1 }));
        post.position.set(cx + perpX * 0.08 * side, archH + 0.03, cz + perpZ * 0.08 * side);
        cwG.add(post);
      }
    }
  }
  const pillarCount = Math.floor(cwLen / 2.5);
  for (let p = 0; p < pillarCount; p++) {
    const t = (p + 1) / (pillarCount + 1);
    const px = cb1X + cwDx * t, pz = cb1Z + cwDz * t;
    const archH = 0.025 * Math.sin(t * Math.PI);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.22, 6),
      mt(CW_STONE, { roughness: 1 }));
    pillar.position.set(px, archH - 0.09, pz); cwG.add(pillar);
  }
  scene.add(cwG);
}




/* ═══════════════════════════════════════════════════════════
   Cherry Blossom Island — Pink flower paradise with waterfalls
   ═══════════════════════════════════════════════════════════ */
function createFlowerIsland() {
  const FL_X = -12, FL_Z = -22;
  const fl = new THREE.Group();
  fl.position.set(FL_X, 0, FL_Z);

  // ── Elongated coastline radius ──
  function getFlowerR(a) {
    let r = 3.5 + Math.cos(a) * 2.0;
    r += Math.sin(a * 3) * 0.4 + Math.cos(a * 5) * 0.2 + Math.sin(a * 7) * 0.1;
    const dS = Math.abs(a - Math.PI * 1.5);
    if (dS < 0.35) r -= (0.35 - dS) * 1.5;
    const dE = Math.abs(a - 0.2);
    if (dE < 0.3) r += (0.3 - dE) * 1.8;
    const dNW = Math.abs(a - Math.PI * 0.75);
    if (dNW < 0.25) r -= (0.25 - dNW) * 1.0;
    return Math.max(1.5, r);
  }

  function getFlowerH(x, z) {
    const d = Math.sqrt(x * x + z * z);
    const ridge = Math.max(0, 0.5 - Math.abs(z) * 0.3) * (1 - d * 0.06);
    const hills = Math.sin(x * 0.6 + 0.3) * 0.15 + Math.cos(z * 0.8) * 0.1
                + Math.sin(x * 1.4 + z) * 0.06;
    const cliff = z < -1.5 ? Math.max(0, 0.35 * (1 - (z + 1.5) / -1.5)) : 0;
    const edgeFade = Math.max(0, 1 - d / 4.5);
    return (ridge + hills + cliff) * edgeFade;
  }

  // ── Terrain — bright MeshStandardMaterial with self-glow ──
  const flRes = 72;
  const flSize = 14;
  const flGeo = new THREE.PlaneGeometry(flSize, flSize, flRes, flRes);
  flGeo.rotateX(-Math.PI / 2);
  const flPos = flGeo.attributes.position;
  const flColors = new Float32Array(flPos.count * 3);
  const FL_GREEN  = new THREE.Color(0x88dd66);
  const FL_GREEN2 = new THREE.Color(0x99ee77);
  const SAND_FL   = new THREE.Color(0xf5eedd);
  const ROCK_FL   = new THREE.Color(0xaabb88);

  for (let i = 0; i < flPos.count; i++) {
    const x = flPos.getX(i), z = flPos.getZ(i);
    const a = Math.atan2(z, x);
    const d = Math.sqrt(x * x + z * z);
    const edgeR = getFlowerR(a);
    if (d > edgeR + 0.3) { flPos.setY(i, -0.5); }
    else if (d > edgeR - 0.4) {
      const beachT = smoothstep(edgeR - 0.4, edgeR + 0.3, d);
      flPos.setY(i, THREE.MathUtils.lerp(getFlowerH(x, z) + 0.15, -0.06, beachT));
    } else {
      flPos.setY(i, getFlowerH(x, z) + 0.15);
    }
    const h = flPos.getY(i);
    let c;
    if (d > edgeR - 0.5) {
      c = SAND_FL.clone();
    } else if (h > 0.4) {
      c = ROCK_FL.clone();
    } else {
      const n = Math.sin(x * 2.0 + z * 1.5) * 0.5 + 0.5;
      c = FL_GREEN.clone().lerp(FL_GREEN2, n);
    }
    flColors[i * 3] = c.r; flColors[i * 3 + 1] = c.g; flColors[i * 3 + 2] = c.b;
  }
  flGeo.setAttribute("color", new THREE.BufferAttribute(flColors, 3));
  flGeo.computeVertexNormals();
  const flTerrain = new THREE.Mesh(flGeo, new THREE.MeshStandardMaterial({
    color: 0x88dd66, vertexColors: true, roughness: 0.7, flatShading: true,
    emissive: 0x446630, emissiveIntensity: 0.5,
  }));
  flTerrain.receiveShadow = true; fl.add(flTerrain);

  // ── Cliff underside — bright warm stone ──
  const cSegs = 100;
  const cGeo2 = new THREE.BufferGeometry();
  const cV = [], cN = [], cC = [];
  for (let i = 0; i < cSegs; i++) {
    const a0 = (i / cSegs) * Math.PI * 2;
    const a1 = ((i + 1) / cSegs) * Math.PI * 2;
    const r0 = getFlowerR(a0), r1 = getFlowerR(a1);
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const bulge = 0.1 + Math.sin(a0 * 4) * 0.03;
    const mx0 = x0 + Math.cos(a0) * bulge, mz0 = z0 + Math.sin(a0) * bulge;
    const mx1 = x1 + Math.cos(a1) * bulge, mz1 = z1 + Math.sin(a1) * bulge;
    const sand = [0.92, 0.88, 0.78], rock = [0.65, 0.60, 0.52];
    cV.push(x0, 0, z0, mx0, -0.12, mz0, x1, 0, z1);
    cV.push(x1, 0, z1, mx0, -0.12, mz0, mx1, -0.12, mz1);
    for (let t = 0; t < 6; t++) { cC.push(...sand); cN.push(Math.cos(a0), 0, Math.sin(a0)); }
    cV.push(mx0, -0.12, mz0, x0 * 0.95, -0.4, z0 * 0.95, mx1, -0.12, mz1);
    cV.push(mx1, -0.12, mz1, x0 * 0.95, -0.4, z0 * 0.95, x1 * 0.95, -0.4, z1 * 0.95);
    for (let t = 0; t < 6; t++) { cC.push(...rock); cN.push(Math.cos(a0), -0.3, Math.sin(a0)); }
  }
  cGeo2.setAttribute("position", new THREE.Float32BufferAttribute(cV, 3));
  cGeo2.setAttribute("normal", new THREE.Float32BufferAttribute(cN, 3));
  cGeo2.setAttribute("color", new THREE.Float32BufferAttribute(cC, 3));
  cGeo2.computeVertexNormals();
  fl.add(new THREE.Mesh(cGeo2, new THREE.MeshStandardMaterial({
    color: 0xc0b8a0, vertexColors: true, roughness: 0.9, flatShading: true,
    emissive: 0x504838, emissiveIntensity: 0.35,
  })));

  // ── Cherry blossom trees — soft pastel pink, ethereal ──
  function makeBlossomTree(tx, tz, h, spread) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.035, h, 5),
      new THREE.MeshStandardMaterial({ color: 0xb09080, flatShading: true, emissive: 0x504030, emissiveIntensity: 0.3 }));
    trunk.position.y = h / 2; tree.add(trunk);
    for (let br = 0; br < 3; br++) {
      const ba = br * Math.PI * 2 / 3 + Math.random() * 0.5;
      const brL = h * 0.3 + Math.random() * 0.1;
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.015, brL, 3),
        new THREE.MeshStandardMaterial({ color: 0xb09080, flatShading: true, emissive: 0x504030, emissiveIntensity: 0.3 }));
      branch.position.set(Math.cos(ba) * 0.04, h * 0.7, Math.sin(ba) * 0.04);
      branch.rotation.z = 0.4 + Math.random() * 0.3;
      branch.rotation.y = ba; tree.add(branch);
    }
    // Soft pastel blossom canopy — self-illuminated
    const pinks = [0xffccdd, 0xffc0d8, 0xffd0e0, 0xffddee, 0xffc8e0];
    for (let b = 0; b < 5; b++) {
      const ba = b * Math.PI * 2 / 5 + Math.random() * 0.4;
      const br2 = spread * (0.4 + Math.random() * 0.3);
      const blobR = spread * (0.3 + Math.random() * 0.15);
      const blob = new THREE.Mesh(
        new THREE.SphereGeometry(blobR, 6, 4),
        new THREE.MeshStandardMaterial({
          color: pinks[b % pinks.length], flatShading: true,
          emissive: pinks[b % pinks.length], emissiveIntensity: 0.4,
          roughness: 0.6,
        }));
      blob.position.set(Math.cos(ba) * br2, h - 0.02 + Math.random() * 0.06, Math.sin(ba) * br2);
      blob.scale.y = 0.55; tree.add(blob);
    }
    const center = new THREE.Mesh(
      new THREE.SphereGeometry(spread * 0.35, 6, 4),
      new THREE.MeshStandardMaterial({
        color: 0xffd0e0, flatShading: true,
        emissive: 0xffd0e0, emissiveIntensity: 0.4, roughness: 0.6,
      }));
    center.position.y = h + 0.02; center.scale.y = 0.5; tree.add(center);
    const y = getFlowerH(tx, tz) + 0.15;
    tree.position.set(tx, y, tz); fl.add(tree);
  }

  // Dense coverage
  for (let ta = 0; ta < 60; ta++) {
    const ang = ta * 2.399 + 0.5;
    const rad = 0.6 + (ta / 60) * 4.2;
    const tx = Math.cos(ang) * rad;
    const tz = Math.sin(ang) * rad;
    const td = Math.sqrt(tx * tx + tz * tz);
    const tAng = Math.atan2(tz, tx);
    if (td > getFlowerR(tAng) - 1.0) continue;
    const h = 0.35 + Math.random() * 0.45;
    const s = 0.15 + Math.random() * 0.18;
    makeBlossomTree(tx, tz, h, s);
  }
  makeBlossomTree(0, 0.5, 0.85, 0.38);
  makeBlossomTree(-1.5, -0.3, 0.75, 0.34);
  makeBlossomTree(2.0, 0.8, 0.8, 0.36);
  makeBlossomTree(-2.5, 1.0, 0.7, 0.32);
  makeBlossomTree(1.0, -1.0, 0.7, 0.3);
  makeBlossomTree(3.5, 0, 0.6, 0.28);
  makeBlossomTree(-3.0, -0.5, 0.6, 0.26);

  // ── Falling petals ──
  for (let p = 0; p < 150; p++) {
    const pa = Math.random() * Math.PI * 2;
    const pr = Math.random() * 4.5;
    const px = Math.cos(pa) * pr, pz = Math.sin(pa) * pr;
    const pd = Math.sqrt(px * px + pz * pz);
    if (pd > getFlowerR(pa) - 0.5) continue;
    const petalColors = [0xffccdd, 0xffd8e8, 0xffc0d0, 0xffe8f0];
    const petal = new THREE.Mesh(
      new THREE.CircleGeometry(0.012 + Math.random() * 0.008, 4),
      new THREE.MeshStandardMaterial({
        color: petalColors[Math.floor(Math.random() * 4)],
        emissive: 0xffbbcc, emissiveIntensity: 0.3,
        side: THREE.DoubleSide, flatShading: true,
      }));
    petal.rotation.x = -Math.PI / 2 + Math.random() * 0.3;
    petal.rotation.z = Math.random() * Math.PI;
    petal.position.set(px, getFlowerH(px, pz) + 0.16, pz);
    fl.add(petal);
  }

  // ── Waterfalls ──
  const wf1Top = getFlowerH(0, -2.0) + 0.5;
  const wf1Bot = -0.05;
  const wf1H = wf1Top - wf1Bot;
  const wf1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, wf1H),
    new THREE.MeshStandardMaterial({ color: 0xc0e8f8, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, emissive: 0x80c0e0, emissiveIntensity: 0.3 }));
  wf1.position.set(0, wf1Bot + wf1H / 2, -2.5); fl.add(wf1);
  const mist1 = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }));
  mist1.scale.set(1.5, 0.4, 1); mist1.position.set(0, 0.05, -2.6); fl.add(mist1);
  animatedObjects.push({ type: "bob", mesh: mist1, speed: 0.2, baseY: 0.05, amp: 0.03, phase: 0 });
  const pool1 = new THREE.Mesh(new THREE.CircleGeometry(0.35, 10),
    new THREE.MeshStandardMaterial({ color: 0x80d0e8, transparent: true, opacity: 0.5,
      emissive: 0x4090a0, emissiveIntensity: 0.3 }));
  pool1.rotation.x = -Math.PI / 2; pool1.position.set(0, 0.0, -2.8); fl.add(pool1);

  const wf2Top = getFlowerH(-1.8, -1.8) + 0.35;
  const wf2Bot = 0.0;
  const wf2H = wf2Top - wf2Bot;
  const wf2 = new THREE.Mesh(new THREE.PlaneGeometry(0.1, wf2H),
    new THREE.MeshStandardMaterial({ color: 0xc0e8f8, transparent: true, opacity: 0.5,
      side: THREE.DoubleSide, emissive: 0x80c0e0, emissiveIntensity: 0.3 }));
  wf2.position.set(-1.8, wf2Bot + wf2H / 2, -2.2); wf2.rotation.y = 0.3; fl.add(wf2);
  const pool2 = new THREE.Mesh(new THREE.CircleGeometry(0.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x80d0e8, transparent: true, opacity: 0.4,
      emissive: 0x4090a0, emissiveIntensity: 0.3 }));
  pool2.rotation.x = -Math.PI / 2; pool2.position.set(-1.8, 0.01, -2.5); fl.add(pool2);

  const wf3Top = getFlowerH(1.5, -1.5) + 0.3;
  const wf3Bot = 0.02;
  const wf3H = wf3Top - wf3Bot;
  const wf3 = new THREE.Mesh(new THREE.PlaneGeometry(0.08, wf3H),
    new THREE.MeshStandardMaterial({ color: 0xc0e8f8, transparent: true, opacity: 0.45,
      side: THREE.DoubleSide, emissive: 0x80c0e0, emissiveIntensity: 0.3 }));
  wf3.position.set(1.5, wf3Bot + wf3H / 2, -2.0); wf3.rotation.y = -0.2; fl.add(wf3);

  // ── Stream ──
  const streamPts = [
    { x: 0, z: -2.8 }, { x: -0.5, z: -2.5 }, { x: -1.0, z: -2.3 },
    { x: -1.5, z: -2.4 }, { x: -1.8, z: -2.5 },
  ];
  for (let i = 0; i < streamPts.length - 1; i++) {
    const p0 = streamPts[i], p1 = streamPts[i + 1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const ang = Math.atan2(dz, dx);
    const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
    const stream = new THREE.Mesh(new THREE.BoxGeometry(len, 0.005, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x90d8e8, transparent: true, opacity: 0.4,
        emissive: 0x5090a0, emissiveIntensity: 0.3 }));
    stream.position.set(mx, 0.01, mz); stream.rotation.y = -ang; fl.add(stream);
  }

  // ── Soft flower ground cover (no harsh rectangles) ──
  for (let fg = 0; fg < 80; fg++) {
    const fa = Math.random() * Math.PI * 2;
    const fr = Math.random() * 3.5 + 0.5;
    const fx = Math.cos(fa) * fr, fz = Math.sin(fa) * fr;
    const fd = Math.sqrt(fx * fx + fz * fz);
    if (fd > getFlowerR(Math.atan2(fz, fx)) - 1.0) continue;
    const colors = [0xffccdd, 0xffd8e8, 0xffc0d8, 0xffe0ee, 0xffb8d0, 0xffd0e8];
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.015 + Math.random() * 0.015, 4, 3),
      new THREE.MeshStandardMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        emissive: 0xffbbcc, emissiveIntensity: 0.35, flatShading: true,
      }));
    dot.position.set(fx, getFlowerH(fx, fz) + 0.17, fz);
    fl.add(dot);
  }

  // ── Korean-style arched bridge ──
  const archBridge = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const t = (i + 0.5) / 12;
    const archY = Math.sin(t * Math.PI) * 0.1;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.22),
      mt(0xc04040, { roughness: 0.8 }));
    plank.position.set(t * 0.7 - 0.35, archY + 0.05, 0);
    archBridge.add(plank);
  }
  for (const side of [-0.1, 0.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.008, 0.008), mt(0xc04040));
    rail.position.set(0, 0.15, side); archBridge.add(rail);
    for (let rp = 0; rp < 5; rp++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 3), mt(0xc04040));
      post.position.set(-0.28 + rp * 0.14, 0.1, side); archBridge.add(post);
    }
  }
  archBridge.position.set(-0.8, getFlowerH(-0.8, -2.4) + 0.12, -2.4);
  archBridge.rotation.y = 0.3; fl.add(archBridge);

  // ── Stone lanterns ──
  function makeToro(tx, tz, rot) {
    const toro = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.06), mt(0xa0a090));
    base.position.y = 0.015; toro.add(base);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.12, 5), mt(0xa0a090));
    shaft.position.y = 0.09; toro.add(shaft);
    const firebox = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), mt(0x909080));
    firebox.position.y = 0.17; toro.add(firebox);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.03, 4), mt(0x808078));
    roof.position.y = 0.21; roof.rotation.y = Math.PI / 4; toro.add(roof);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3),
      mt(0xfff0cc, { emissive: 0xffdd88, emissiveIntensity: 0.8 }));
    glow.position.y = 0.17; toro.add(glow);

    const y = getFlowerH(tx, tz) + 0.15;
    toro.position.set(tx, y, tz); toro.rotation.y = rot; fl.add(toro);
  }
  makeToro(-1.5, 0.5, 0.3);
  makeToro(1.0, 0.8, -0.5);
  makeToro(-0.3, -1.5, 0.8);
  makeToro(2.5, 0.2, 0);
  makeToro(-2.8, 0, 1.2);

  // ── Shrine / pavilion ──
  const shrine = new THREE.Group();
  for (const sx of [-0.12, 0.12]) {
    for (const sz of [-0.1, 0.1]) {
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.25, 5), mt(0xc04040));
      pil.position.set(sx, 0.125, sz); shrine.add(pil);
    }
  }
  const platform = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.24), mt(0xa0a090));
  platform.position.y = 0.01; shrine.add(platform);
  const sRoof = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.28), mt(0x777772));
  sRoof.position.y = 0.26; shrine.add(sRoof);
  const sRoofTop = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.06, 4), mt(0x777772));
  sRoofTop.position.y = 0.3; sRoofTop.rotation.y = Math.PI / 4; shrine.add(sRoofTop);
  const torii = new THREE.Group();
  for (const tx of [-0.08, 0.08]) {
    const tp = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.2, 4), mt(0xc04040));
    tp.position.set(tx, 0.1, 0); torii.add(tp);
  }
  const tBeam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.012), mt(0xc04040));
  tBeam.position.y = 0.19; torii.add(tBeam);
  const tBeam2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.008), mt(0xc04040));
  tBeam2.position.y = 0.15; torii.add(tBeam2);
  torii.position.set(0, 0, 0.18); shrine.add(torii);
  const shrineY = getFlowerH(0.5, 0.5) + 0.15;
  shrine.position.set(0.5, shrineY, 0.5); shrine.rotation.y = -0.3; fl.add(shrine);

  // ── Stepping stones ──
  const stepPath = [
    { x: -3.5, z: 0 }, { x: -3.0, z: 0.1 }, { x: -2.5, z: -0.1 },
    { x: -2.0, z: 0.15 }, { x: -1.5, z: 0 }, { x: -1.0, z: 0.1 },
    { x: -0.5, z: -0.05 }, { x: 0, z: 0.1 }, { x: 0.5, z: 0 },
    { x: 1.0, z: 0.15 }, { x: 1.5, z: 0 }, { x: 2.0, z: -0.1 },
    { x: 2.5, z: 0.05 }, { x: 3.0, z: 0 },
  ];
  stepPath.forEach(sp => {
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.02, 6),
      mt(0xb0a898, { roughness: 1 }));
    stone.position.set(sp.x, getFlowerH(sp.x, sp.z) + 0.16, sp.z); fl.add(stone);
  });

  // ── Butterflies ──
  for (let bf = 0; bf < 6; bf++) {
    const bfly = new THREE.Group();
    const wingColors = [0xffbbcc, 0xf0c0e0, 0xffd0dd, 0xc0d0f0, 0xf8e080, 0xf8f8f8];
    for (const wx of [-0.015, 0.015]) {
      const wing = new THREE.Mesh(new THREE.CircleGeometry(0.015, 4),
        new THREE.MeshStandardMaterial({
          color: wingColors[bf], side: THREE.DoubleSide,
          emissive: wingColors[bf], emissiveIntensity: 0.3, flatShading: true,
        }));
      wing.position.x = wx; wing.rotation.y = wx > 0 ? 0.4 : -0.4; bfly.add(wing);
    }
    const ba = Math.random() * Math.PI * 2;
    const br2 = 1.0 + Math.random() * 2.5;
    const bx = Math.cos(ba) * br2, bz = Math.sin(ba) * br2;
    bfly.position.set(bx, getFlowerH(bx, bz) + 0.4 + Math.random() * 0.3, bz);
    fl.add(bfly);
    animatedObjects.push({ type: "bob", mesh: bfly, speed: 1.5 + Math.random(), baseY: bfly.position.y, amp: 0.06, phase: bf * 1.5 });
  }

  // ── Koi pond ──
  const pond = new THREE.Mesh(new THREE.CircleGeometry(0.3, 10),
    new THREE.MeshStandardMaterial({ color: 0x70c0d0, transparent: true, opacity: 0.5,
      emissive: 0x4090a0, emissiveIntensity: 0.3 }));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(-1.0, getFlowerH(-1.0, 1.0) + 0.14, 1.0); fl.add(pond);
  for (let lp = 0; lp < 4; lp++) {
    const la = lp * Math.PI / 2 + 0.3;
    const lily = new THREE.Mesh(new THREE.CircleGeometry(0.03, 6),
      new THREE.MeshStandardMaterial({ color: 0x55bb55, flatShading: true,
        emissive: 0x338833, emissiveIntensity: 0.3 }));
    lily.rotation.x = -Math.PI / 2;
    lily.position.set(-1.0 + Math.cos(la) * 0.18, getFlowerH(-1.0, 1.0) + 0.145, 1.0 + Math.sin(la) * 0.18);
    fl.add(lily);
  }
  for (let k = 0; k < 3; k++) {
    const koi = new THREE.Mesh(new THREE.SphereGeometry(0.012, 3, 2),
      mt(k === 0 ? 0xf08030 : k === 1 ? 0xf0f0f0 : 0xf04040));
    koi.scale.z = 1.8;
    const ka = k * Math.PI * 2 / 3;
    koi.position.set(-1.0 + Math.cos(ka) * 0.12, getFlowerH(-1.0, 1.0) + 0.14, 1.0 + Math.sin(ka) * 0.12);
    fl.add(koi);
  }

  // ── Ethereal mist patches ──
  [{x: 0, z: 0, s: 2.0}, {x: -2, z: 1, s: 1.5}, {x: 2, z: -1, s: 1.5},
   {x: -1, z: -2, s: 1.2}, {x: 3, z: 1, s: 1.0}].forEach(fp => {
    const fog = new THREE.Mesh(new THREE.SphereGeometry(fp.s, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffeef5, transparent: true, opacity: 0.06 }));
    fog.position.set(fp.x, 0.4, fp.z); fog.scale.set(1, 0.2, 1); fl.add(fog);
  });

  // ── Ethereal lighting (single overhead) ──
  // [perf] removed: const flLight1 = new THREE.PointLight(0xfff5f5, 5.0, 25);
  // [perf] removed: flLight1.position.set(0, 10, 0); fl.add(flLight1);

  scene.add(fl);

  // ── Bridge to main island ──
  const flBA = Math.atan2(FL_Z, FL_X);
  const flMainEdge = getIslandRadius(flBA);
  const fb1X = Math.cos(flBA) * (flMainEdge - 0.8);
  const fb1Z = Math.sin(flBA) * (flMainEdge - 0.8);
  const fb2X = FL_X + Math.cos(flBA + Math.PI) * (getFlowerR(flBA + Math.PI) - 0.5);
  const fb2Z = FL_Z + Math.sin(flBA + Math.PI) * (getFlowerR(flBA + Math.PI) - 0.5);
  scene.add(buildRopeBridge(fb1X, fb1Z, fb2X, fb2Z, {
    baseY: 0.06, color: 0xa06040, colorD: 0x8a5030,
    ropeColor: 0xc08080, sag: 0.08,
  }));
}


function createSkyIsland() {
  const SK_X = 40, SK_Z = 40;
  const sk = new THREE.Group();
  sk.position.set(SK_X, 0, SK_Z);

  const FLOAT_Y = 4.5; // hovering height

  // ── Rocky underside (inverted dome, visible from below) ──
  const underGeo = new THREE.SphereGeometry(3.2, 12, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
  const underPos = underGeo.attributes.position;
  for (let i = 0; i < underPos.count; i++) {
    const x = underPos.getX(i), y = underPos.getY(i), z = underPos.getZ(i);
    const a = Math.atan2(z, x);
    underPos.setX(i, x * (1 + Math.sin(a * 5) * 0.06));
    underPos.setZ(i, z * (1 + Math.cos(a * 7) * 0.04));
    underPos.setY(i, y + Math.sin(a * 3 + x) * 0.15);
  }
  underGeo.computeVertexNormals();
  const underMat = mt(0x8a7a68, { roughness: 0.95 });
  const underMesh = new THREE.Mesh(underGeo, underMat);
  underMesh.position.y = FLOAT_Y - 0.5;
  underMesh.castShadow = true;
  sk.add(underMesh);

  // ── Flat grassy top ──
  const topGeo = new THREE.CylinderGeometry(3.0, 3.2, 0.25, 14);
  const topP = topGeo.attributes.position;
  for (let i = 0; i < topP.count; i++) {
    const x = topP.getX(i), z = topP.getZ(i);
    const a = Math.atan2(z, x);
    topP.setX(i, x * (1 + Math.sin(a * 4) * 0.08));
    topP.setZ(i, z * (1 + Math.cos(a * 6) * 0.05));
  }
  topGeo.computeVertexNormals();
  const topMesh = new THREE.Mesh(topGeo, mt(0x80c060, { emissive: 0x304020, emissiveIntensity: 0.15 }));
  topMesh.position.y = FLOAT_Y + 0.8; topMesh.receiveShadow = true; sk.add(topMesh);

  // ── Rocky cliff band around the edge ──
  const cliffBand = new THREE.Mesh(
    new THREE.CylinderGeometry(2.8, 3.3, 1.2, 14),
    mt(0x9a8a78, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.15 }));
  cliffBand.position.y = FLOAT_Y + 0.2; sk.add(cliffBand);

  // ── Gentle hills on top ──
  const hill1 = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 5), mt(0x80c060, { emissive: 0x304020, emissiveIntensity: 0.15 }));
  hill1.scale.y = 0.25; hill1.position.set(0.5, FLOAT_Y + 1.0, -0.3); sk.add(hill1);
  const hill2 = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 4), mt(0x68a858));
  hill2.scale.y = 0.2; hill2.position.set(-1.0, FLOAT_Y + 0.95, 0.8); sk.add(hill2);

  // ── Large tree on the hilltop ──
  const treeTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.8, 5), mt(0x6a5040));
  treeTrunk.position.set(0.5, FLOAT_Y + 1.4, -0.3); sk.add(treeTrunk);
  const treeCanopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), mt(0x3a8a3a));
  treeCanopy.position.set(0.5, FLOAT_Y + 2.0, -0.3); treeCanopy.scale.y = 0.7; sk.add(treeCanopy);
  const treeCanopy2 = new THREE.Mesh(new THREE.SphereGeometry(0.35, 5, 4), mt(0x4a9a4a));
  treeCanopy2.position.set(0.7, FLOAT_Y + 2.1, -0.1); sk.add(treeCanopy2);

  // ── Small stone ruins on top ──
  const ruinWall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.06), mt(0xa09888));
  ruinWall.position.set(-0.8, FLOAT_Y + 1.1, 0.5); ruinWall.rotation.y = 0.4; sk.add(ruinWall);
  const ruinPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 5), mt(0xa09888));
  ruinPillar.position.set(-0.5, FLOAT_Y + 1.15, 0.7); sk.add(ruinPillar);
  const ruinPillar2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.35, 5), mt(0xa09888));
  ruinPillar2.position.set(-1.1, FLOAT_Y + 1.12, 0.3); sk.add(ruinPillar2);

  // ── Grass tufts ──
  for (let gt = 0; gt < 10; gt++) {
    const ga = Math.random() * Math.PI * 2;
    const gr = Math.random() * 2.0;
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 3), mt(0x88cc58));
    tuft.position.set(Math.cos(ga) * gr, FLOAT_Y + 0.95, Math.sin(ga) * gr);
    sk.add(tuft);
  }

  // ── Chains anchoring island to sea floor (4 chains) ──
  const chainAnchors = [
    { x: -2.5, z: -2.0, lean: 0.3 },
    { x: 2.5, z: -1.5, lean: -0.25 },
    { x: -2.0, z: 2.5, lean: 0.2 },
    { x: 2.0, z: 2.0, lean: -0.35 },
  ];
  chainAnchors.forEach(ca => {
    const chainLinks = 18;
    const chainH = FLOAT_Y + 0.5;
    for (let cl = 0; cl < chainLinks; cl++) {
      const t = cl / chainLinks;
      const linkY = chainH * (1 - t) - 0.3;
      const sway = Math.sin(t * Math.PI) * ca.lean;
      const link = new THREE.Mesh(
        new THREE.TorusGeometry(0.04, 0.012, 4, 6),
        mt(0x6a6a6a, { roughness: 0.7 }));
      link.position.set(ca.x + sway, linkY, ca.z + sway * 0.5);
      link.rotation.x = cl % 2 === 0 ? Math.PI / 2 : 0;
      link.rotation.y = Math.atan2(ca.z, ca.x);
      sk.add(link);
    }
    // Anchor stone at water level
    const anchor = new THREE.Mesh(new THREE.DodecahedronGeometry(0.15, 0), mt(0x7a7a70));
    anchor.position.set(ca.x + ca.lean * 1.2, -0.2, ca.z + ca.lean * 0.6);
    anchor.scale.y = 0.5; sk.add(anchor);
  });

  // ── Waterfalls pouring off the edges ──
  const wfDefs = [
    { x: 2.5, z: 0, w: 0.25, rot: 0 },
    { x: -1.5, z: 2.2, w: 0.15, rot: 0.8 },
    { x: 0, z: -2.8, w: 0.2, rot: -0.3 },
  ];
  wfDefs.forEach(wf => {
    const wfH = FLOAT_Y + 0.5;
    // Water stream
    const stream = new THREE.Mesh(
      new THREE.PlaneGeometry(wf.w, wfH + 0.3),
      mt(0x80c8e8, { transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    stream.position.set(wf.x, wfH / 2 - 0.2, wf.z);
    stream.rotation.y = wf.rot;
    sk.add(stream);
    // Splash mist at water level
    const mist = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 }));
    mist.scale.set(1.5, 0.4, 1);
    mist.position.set(wf.x, 0.05, wf.z);
    sk.add(mist);
    animatedObjects.push({ type: "bob", mesh: mist, speed: 0.3, baseY: 0.05, amp: 0.04, phase: wf.x });
    // Pool ring at water level
    const pool = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.45, 8),
      mt(0x70b8d0, { transparent: true, opacity: 0.3 }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(wf.x, -0.1, wf.z); sk.add(pool);
  });

  // ── Small floating rocks around the island ──
  for (let fr = 0; fr < 6; fr++) {
    const fa = fr * Math.PI * 2 / 6 + 0.5;
    const fd = 3.5 + Math.random() * 1.5;
    const frock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.15 + Math.random() * 0.15, 0),
      mt(0x8a8070));
    frock.position.set(Math.cos(fa) * fd, FLOAT_Y * 0.4 + Math.random() * 2, Math.sin(fa) * fd);
    frock.rotation.set(Math.random(), Math.random(), Math.random());
    sk.add(frock);
    animatedObjects.push({ type: "bob", mesh: frock, speed: 0.15 + Math.random() * 0.1, baseY: frock.position.y, amp: 0.08, phase: fr * 2 });
  }

  // Bob the whole island gently
  animatedObjects.push({ type: "bob", mesh: sk, speed: 0.08, baseY: 0, amp: 0.15, phase: 0 });

  scene.add(sk);

  // ── Bridge — rope bridge from main island direction ──
  const skBA = Math.atan2(SK_Z, SK_X);
  const skMainEdge = getIslandRadius(skBA);
  const sb1X = Math.cos(skBA) * (skMainEdge - 0.5);
  const sb1Z = Math.sin(skBA) * (skMainEdge - 0.5);
  const sb2X = SK_X + Math.cos(skBA + Math.PI) * 4.0;
  const sb2Z = SK_Z + Math.sin(skBA + Math.PI) * 4.0;
  scene.add(buildRopeBridge(sb1X, sb1Z, sb2X, sb2Z, { baseY: 0.08, sag: 0.15 }));
}


/* ═══════════════════════════════════════════════════════════
   Cinque Terre Island — stacked colorful cliffside fishing village
   ═══════════════════════════════════════════════════════════ */
function createCinqueTerre() {
  const CT_X = -45, CT_Z = -20;
  const ct = new THREE.Group();
  ct.position.set(CT_X, 0, CT_Z);

  // ── Steep rocky cliff base ──
  const cliffGeo = new THREE.CylinderGeometry(2.0, 3.0, 3.5, 10);
  const clP = cliffGeo.attributes.position;
  for (let i = 0; i < clP.count; i++) {
    const x = clP.getX(i), y = clP.getY(i), z = clP.getZ(i);
    const a = Math.atan2(z, x);
    const w = 1 + Math.sin(a * 3) * 0.12 + Math.cos(a * 7) * 0.05;
    clP.setX(i, x * w); clP.setZ(i, z * w);
    if (y > 0) clP.setY(i, y + Math.sin(a * 5 + x * 2) * 0.15);
  }
  cliffGeo.computeVertexNormals();
  const cliffColors = new Float32Array(clP.count * 3);
  const cliffSand = new THREE.Color(0xd8c8a8);
  const cliffRock = new THREE.Color(0xa09080);
  const cliffDark = new THREE.Color(0x8a7a68);
  for (let i = 0; i < clP.count; i++) {
    const y = clP.getY(i);
    const t = (y + 1.75) / 3.5;
    const c = cliffDark.clone().lerp(cliffSand, t);
    c.r += (Math.random() - 0.5) * 0.04;
    c.g += (Math.random() - 0.5) * 0.04;
    c.b += (Math.random() - 0.5) * 0.04;
    cliffColors[i * 3] = c.r; cliffColors[i * 3 + 1] = c.g; cliffColors[i * 3 + 2] = c.b;
  }
  cliffGeo.setAttribute("color", new THREE.Float32BufferAttribute(cliffColors, 3));
  const cliffMesh = new THREE.Mesh(cliffGeo, mt(0xa09080, { vertexColors: true, roughness: 0.95 }));
  cliffMesh.position.y = 0.0; ct.add(cliffMesh);

  // ── Flat top (grassy terrace) ──
  const topPlat = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.0, 0.15, 10), mt(0x6a9a50));
  topPlat.position.y = 1.8; ct.add(topPlat);

  // ── Colorful stacked houses climbing the cliff ──
  const houseColors = [
    0xe86040, // terracotta red
    0xf0c848, // sunny yellow
    0xe8a050, // warm orange
    0xf0b8a0, // salmon pink
    0xa0d0a0, // sage green
    0x78b8d0, // sea blue
    0xd898b0, // dusty rose
    0xf0e8c0, // cream
    0xb8d8e8, // light blue
    0xe0c090, // sand
  ];

  // Lower tier houses (at water level, on the cliff face)
  const lowerHouses = [
    { x: -1.6, z: 1.8, w: 0.35, h: 0.5, d: 0.3, y: -0.5, r: 0.3 },
    { x: -1.2, z: 2.0, w: 0.3, h: 0.6, d: 0.28, y: -0.3, r: 0.2 },
    { x: -0.7, z: 2.2, w: 0.32, h: 0.55, d: 0.3, y: -0.1, r: 0.15 },
    { x: -0.2, z: 2.3, w: 0.28, h: 0.65, d: 0.26, y: 0.0, r: 0.1 },
    { x: 0.3, z: 2.2, w: 0.3, h: 0.5, d: 0.28, y: -0.2, r: 0.05 },
    { x: 0.8, z: 2.0, w: 0.35, h: 0.6, d: 0.3, y: -0.4, r: -0.1 },
    { x: 1.3, z: 1.7, w: 0.3, h: 0.45, d: 0.28, y: -0.5, r: -0.2 },
  ];
  lowerHouses.forEach((lh, i) => {
    const house = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(lh.w, lh.h, lh.d),
      mt(houseColors[i % houseColors.length]));
    body.position.y = lh.h / 2; house.add(body);
    // Roof
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(lh.w + 0.04, 0.03, lh.d + 0.04), mt(0xc0704a));
    roof.position.y = lh.h + 0.015; house.add(roof);
    // Windows
    for (let wi = 0; wi < 2; wi++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.01),
        mt(0x90c8e0, { emissive: 0x405060, emissiveIntensity: 0.2 }));
      win.position.set(-0.06 + wi * 0.12, lh.h * 0.6, lh.d / 2 + 0.005);
      house.add(win);
      // Shutters
      for (const sx of [-0.03, 0.03]) {
        const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.06, 0.005),
          mt(0x5a8a5a));
        shutter.position.set(-0.06 + wi * 0.12 + sx, lh.h * 0.6, lh.d / 2 + 0.008);
        house.add(shutter);
      }
    }
    // Door on lower houses
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.01), mt(0x7a5a3a));
    door.position.set(0, 0.05, lh.d / 2 + 0.005); house.add(door);

    house.position.set(lh.x, lh.y, lh.z);
    house.rotation.y = lh.r;
    ct.add(house);
  });

  // Mid tier houses (on ledges)
  const midHouses = [
    { x: -1.3, z: 1.2, w: 0.3, h: 0.5, d: 0.28, y: 0.3, r: 0.25 },
    { x: -0.6, z: 1.5, w: 0.35, h: 0.6, d: 0.3, y: 0.5, r: 0.15 },
    { x: 0.1, z: 1.6, w: 0.28, h: 0.55, d: 0.26, y: 0.6, r: 0.0 },
    { x: 0.7, z: 1.4, w: 0.32, h: 0.5, d: 0.3, y: 0.4, r: -0.15 },
    { x: 1.2, z: 1.0, w: 0.3, h: 0.6, d: 0.28, y: 0.2, r: -0.25 },
  ];
  midHouses.forEach((mh, i) => {
    const house = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(mh.w, mh.h, mh.d),
      mt(houseColors[(i + 3) % houseColors.length]));
    body.position.y = mh.h / 2; house.add(body);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(mh.w + 0.04, 0.03, mh.d + 0.04), mt(0xb86040));
    roof.position.y = mh.h + 0.015; house.add(roof);
    for (let wi = 0; wi < 2; wi++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.01),
        mt(0x90c8e0, { emissive: 0x405060, emissiveIntensity: 0.2 }));
      win.position.set(-0.06 + wi * 0.12, mh.h * 0.6, mh.d / 2 + 0.005);
      house.add(win);
    }
    house.position.set(mh.x, mh.y, mh.z);
    house.rotation.y = mh.r;
    ct.add(house);
  });

  // Upper tier (smaller houses near the top)
  const upperHouses = [
    { x: -0.8, z: 0.5, w: 0.25, h: 0.45, d: 0.25, y: 1.0, r: 0.2 },
    { x: 0.0, z: 0.8, w: 0.3, h: 0.5, d: 0.28, y: 1.2, r: 0.0 },
    { x: 0.7, z: 0.4, w: 0.28, h: 0.45, d: 0.25, y: 1.0, r: -0.2 },
  ];
  upperHouses.forEach((uh, i) => {
    const house = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(uh.w, uh.h, uh.d),
      mt(houseColors[(i + 6) % houseColors.length]));
    body.position.y = uh.h / 2; house.add(body);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(uh.w + 0.04, 0.03, uh.d + 0.04), mt(0xc0704a));
    roof.position.y = uh.h + 0.015; house.add(roof);
    house.position.set(uh.x, uh.y, uh.z);
    house.rotation.y = uh.r;
    ct.add(house);
  });

  // ── Church tower (at the top) ──
  const church = new THREE.Group();
  const cBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.35), mt(0xf0e8d0));
  cBody.position.y = 0.3; church.add(cBody);
  const cTower = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), mt(0xf0e8d0));
  cTower.position.y = 0.85; church.add(cTower);
  const cSpire = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), mt(0xc0a078));
  cSpire.position.y = 1.2; cSpire.rotation.y = Math.PI / 4; church.add(cSpire);
  const cRoof = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.15, 4), mt(0xb06848));
  cRoof.position.y = 0.67; cRoof.rotation.y = Math.PI / 4; church.add(cRoof);
  // Bell
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0xc8a850));
  bell.position.y = 1.0; bell.scale.y = 1.3; church.add(bell);
  church.position.set(0.0, 1.6, 0.0); ct.add(church);

  // ── Winding staircase (zigzag path up the cliff) ──
  const stairSteps = 20;
  for (let st = 0; st < stairSteps; st++) {
    const t = st / stairSteps;
    const sx = Math.sin(t * Math.PI * 2.5) * 0.8;
    const sz = 1.5 + Math.cos(t * Math.PI * 2.5) * 0.6;
    const sy = -0.8 + t * 2.8;
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.08), mt(0xb0a090));
    step.position.set(sx, sy, sz); ct.add(step);
  }

  // ── Harbor with boats ──
  const harborWall = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 0.1), mt(0x908070));
  harborWall.position.set(0, -0.8, 2.8); ct.add(harborWall);
  // Fishing boats
  for (let fb = 0; fb < 3; fb++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.3),
      mt([0xe04040, 0x4080c0, 0xf0c040][fb]));
    hull.position.y = 0.02; boat.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.08, 3),
      mt([0xe04040, 0x4080c0, 0xf0c040][fb]));
    bow.rotation.x = Math.PI / 2; bow.position.set(0, 0.02, 0.18); boat.add(bow);
    boat.position.set(-0.5 + fb * 0.5, -0.85, 3.2);
    boat.rotation.y = Math.random() * 0.3 - 0.15;
    ct.add(boat);
    animatedObjects.push({ type: "bob", mesh: boat, speed: 0.3 + fb * 0.05, baseY: -0.85, amp: 0.02, phase: fb * 2 });
  }

  // ── Terraced garden (olive trees) ──
  for (let og = 0; og < 4; og++) {
    const oa = -0.5 + og * 0.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.15, 4), mt(0x7a6a50));
    trunk.position.set(-1.5 + og * 0.4, 1.5 + og * 0.08, -0.3);
    ct.add(trunk);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 3), mt(0x6a8a50));
    canopy.position.set(-1.5 + og * 0.4, 1.65 + og * 0.08, -0.3);
    canopy.scale.y = 0.6; ct.add(canopy);
  }

  // ── Laundry lines between houses ──
  for (let ll = 0; ll < 3; ll++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.003, 0.003), mt(0xa0a0a0));
    line.position.set(-0.5 + ll * 0.5, 0.3 + ll * 0.15, 1.8);
    ct.add(line);
    // Hanging clothes
    for (let cl = 0; cl < 3; cl++) {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.06),
        mt([0xf0f0f0, 0xe04040, 0x4080c0, 0xf0c040][Math.floor(Math.random() * 4)],
          { side: THREE.DoubleSide }));
      cloth.position.set(-0.7 + ll * 0.5 + cl * 0.12, 0.25 + ll * 0.15, 1.8);
      ct.add(cloth);
    }
  }

  scene.add(ct);

  // ── Bridge to nearest island ──
  const ctBA = Math.atan2(CT_Z, CT_X);
  const ctMainEdge = getIslandRadius(ctBA);
  const cb1X = Math.cos(ctBA) * (ctMainEdge - 0.5);
  const cb1Z = Math.sin(ctBA) * (ctMainEdge - 0.5);
  const cb2X = CT_X + Math.cos(ctBA + Math.PI) * 3.5;
  const cb2Z = CT_Z + Math.sin(ctBA + Math.PI) * 3.5;
  scene.add(buildRopeBridge(cb1X, cb1Z, cb2X, cb2Z, { baseY: 0.08, sag: 0.12 }));
}


/* ═══════════════════════════════════════════════════════════
   Korean Island (Damyang-inspired) — dense bamboo grove with
   hanok pavilion, stone pagoda, jangseung, and winding stone path
   ═══════════════════════════════════════════════════════════ */
function createBambooIsland() {
  const BM_X = 45, BM_Z = -40;
  const bm = new THREE.Group();
  bm.position.set(BM_X, 0, BM_Z);

  // ── Color palette ──
  const BAMBOO_STALK = 0xa0c060;   // yellow-green culm
  const BAMBOO_NODE  = 0x88a848;   // darker node ring
  const BAMBOO_LEAF  = 0x70a838;   // deep green leaf
  const MOSS_GREEN   = 0x5a8a3a;   // deep mossy ground
  const MOSS_LIGHT   = 0x78a858;   // lighter moss
  const STONE_GRAY   = 0x909888;   // gray stone
  const STONE_DARK   = 0x707870;   // dark stone
  const ROOF_TILE    = 0x5a5a58;   // dark gray giwa tiles
  const WHITE_WALL   = 0xf0ece4;   // white plaster
  const DARK_WOOD    = 0x5a4030;   // dark wood beams
  const VERMILLION   = 0xc84040;   // red accent

  // ══════════════════════════════════════════════
  //   ISLAND BASE — smooth organic shape with terrain
  // ══════════════════════════════════════════════
  const islandRes = 28;
  const baseGeo = new THREE.CylinderGeometry(3.8, 4.5, 1.0, islandRes);
  const bmP = baseGeo.attributes.position;
  for (let i = 0; i < bmP.count; i++) {
    const x = bmP.getX(i), z = bmP.getZ(i), y = bmP.getY(i);
    const a = Math.atan2(z, x);
    const d = Math.sqrt(x * x + z * z);
    // Smooth irregular coastline
    const w = 1 + Math.sin(a * 2.3) * 0.08 + Math.cos(a * 3.7) * 0.06
            + Math.sin(a * 5.1) * 0.03;
    bmP.setX(i, x * w); bmP.setZ(i, z * w);
    // Gentle central rise on top face
    if (y > 0.2) {
      const rise = Math.max(0, 1 - d / 3.5) * 0.35;
      bmP.setY(i, y + rise + Math.sin(x * 1.5) * 0.04 + Math.cos(z * 1.3) * 0.03);
    }
  }
  baseGeo.computeVertexNormals();
  const baseMesh = new THREE.Mesh(baseGeo, mt(0x8a7a60, { roughness: 0.95, emissive: 0x504030, emissiveIntensity: 0.15 }));
  baseMesh.position.y = -0.1; bm.add(baseMesh);

  // ── Mossy terrain top with color variation ──
  const topGeo = new THREE.PlaneGeometry(9, 9, 40, 40);
  topGeo.rotateX(-Math.PI / 2);
  const topPos = topGeo.attributes.position;
  const topColors = new Float32Array(topPos.count * 3);
  const mossA = new THREE.Color(MOSS_GREEN);
  const mossB = new THREE.Color(MOSS_LIGHT);
  const mossC = new THREE.Color(0x6a9a4a);

  function getIslandR(a) {
    return 3.8 * (1 + Math.sin(a * 2.3) * 0.08 + Math.cos(a * 3.7) * 0.06
           + Math.sin(a * 5.1) * 0.03);
  }

  for (let i = 0; i < topPos.count; i++) {
    const x = topPos.getX(i), z = topPos.getZ(i);
    const d = Math.sqrt(x * x + z * z);
    const a = Math.atan2(z, x);
    const edgeR = getIslandR(a);
    if (d > edgeR + 0.1) {
      topPos.setY(i, -1);
    } else if (d > edgeR - 0.4) {
      topPos.setY(i, THREE.MathUtils.lerp(0.42, -0.1, (d - edgeR + 0.4) / 0.5));
    } else {
      const rise = Math.max(0, 1 - d / 3.5) * 0.35;
      topPos.setY(i, 0.42 + rise + Math.sin(x * 1.5) * 0.04 + Math.cos(z * 1.3) * 0.03);
    }
    // Color variation
    const mix = Math.sin(x * 3 + z * 2) * 0.3 + 0.5;
    const c = mossA.clone().lerp(mossB, mix);
    if (Math.sin(x * 7 + z * 5) > 0.5) c.lerp(mossC, 0.3);
    topColors[i * 3] = c.r; topColors[i * 3 + 1] = c.g; topColors[i * 3 + 2] = c.b;
  }
  topGeo.setAttribute("color", new THREE.BufferAttribute(topColors, 3));
  topGeo.computeVertexNormals();
  const topMesh = new THREE.Mesh(topGeo, mt(MOSS_GREEN, { vertexColors: true, roughness: 0.95, emissive: 0x304020, emissiveIntensity: 0.12 }));
  topMesh.receiveShadow = true; bm.add(topMesh);

  // ── Cliff underside ring ──
  const cSegs = 50;
  const cGeo = new THREE.BufferGeometry();
  const cV = [], cN = [], cC = [];
  for (let i = 0; i < cSegs; i++) {
    const a0 = (i / cSegs) * Math.PI * 2;
    const a1 = ((i + 1) / cSegs) * Math.PI * 2;
    const r0 = getIslandR(a0), r1 = getIslandR(a1);
    const x0 = Math.cos(a0) * r0, z0 = Math.sin(a0) * r0;
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const col = [0.50, 0.45, 0.35];
    cV.push(x0, 0.05, z0, x0 * 1.02, -0.25, z0 * 1.02, x1, 0.05, z1);
    cV.push(x1, 0.05, z1, x0 * 1.02, -0.25, z0 * 1.02, x1 * 1.02, -0.25, z1 * 1.02);
    cV.push(x0 * 1.02, -0.25, z0 * 1.02, x0 * 0.96, -0.55, z0 * 0.96, x1 * 1.02, -0.25, z1 * 1.02);
    cV.push(x1 * 1.02, -0.25, z1 * 1.02, x0 * 0.96, -0.55, z0 * 0.96, x1 * 0.96, -0.55, z1 * 0.96);
    for (let t = 0; t < 12; t++) {
      cC.push(col[0] + Math.random() * 0.05, col[1] + Math.random() * 0.05, col[2] + Math.random() * 0.03);
      cN.push(Math.cos(a0), -0.3, Math.sin(a0));
    }
  }
  cGeo.setAttribute("position", new THREE.Float32BufferAttribute(cV, 3));
  cGeo.setAttribute("normal", new THREE.Float32BufferAttribute(cN, 3));
  cGeo.setAttribute("color", new THREE.Float32BufferAttribute(cC, 3));
  cGeo.computeVertexNormals();
  bm.add(new THREE.Mesh(cGeo, mt(0x8a7a60, { vertexColors: true, roughness: 1 })));

  // ══════════════════════════════════════════════
  //   DENSE BAMBOO FOREST — 500 stalks via InstancedMesh
  // ══════════════════════════════════════════════

  // Helper: terrain height at position
  function getTerrainY(x, z) {
    const d = Math.sqrt(x * x + z * z);
    if (d > 3.5) return 0.4;
    const rise = Math.max(0, 1 - d / 3.5) * 0.35;
    return 0.42 + rise + Math.sin(x * 1.5) * 0.04 + Math.cos(z * 1.3) * 0.03;
  }

  // Pre-compute stalk positions and heights
  const STALK_COUNT = 200;
  const stalkData = [];

  // Define clearing zones (where structures go)
  function inClearing(x, z) {
    // Pavilion area (center)
    if (x * x + z * z < 0.9 * 0.9) return true;
    // Path corridor (from south to center)
    if (Math.abs(x) < 0.45 && z > 0 && z < 3.2) return true;
    // Lotus pond (east side)
    if ((x - 1.8) * (x - 1.8) + (z + 0.5) * (z + 0.5) < 0.9 * 0.9) return true;
    // Pagoda area
    if ((x + 1.5) * (x + 1.5) + (z + 0.3) * (z + 0.3) < 0.7 * 0.7) return true;
    // Jangdok terrace
    if ((x - 1.5) * (x - 1.5) + (z + 1.8) * (z + 1.8) < 0.6 * 0.6) return true;
    return false;
  }

  // Generate stalk positions in dense groves
  for (let i = 0; i < STALK_COUNT; i++) {
    let x, z, attempts = 0;
    do {
      const a = Math.random() * Math.PI * 2;
      const d = 0.5 + Math.random() * 3.4;
      x = Math.cos(a) * d;
      z = Math.sin(a) * d;
      attempts++;
    } while ((inClearing(x, z) || Math.sqrt(x * x + z * z) > getIslandR(Math.atan2(z, x)) - 0.6
               || (Math.sqrt(x * x + z * z) > 2.5 && Math.random() < 0.4))
             && attempts < 20);
    if (attempts >= 20) continue;
    const h = 1.0 + Math.random() * 0.8; // 1.0-1.8 units tall (~2-3x character height)
    const r = 0.025 + Math.random() * 0.02; // radius 0.025-0.045 (thinner)
    const lean = (Math.random() - 0.5) * 0.06;
    const leanZ = (Math.random() - 0.5) * 0.06;
    stalkData.push({ x, z, h, r, lean, leanZ });
  }

  // ── Bamboo culms (InstancedMesh) ──
  const culmGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  const culmMat = mt(BAMBOO_STALK, { roughness: 0.55 });
  const culmMesh = new THREE.InstancedMesh(culmGeo, culmMat, stalkData.length);
  culmMesh.castShadow = true;
  const dm = new THREE.Matrix4();

  stalkData.forEach((s, i) => {
    const y = getTerrainY(s.x, s.z);
    dm.identity();
    dm.makeScale(s.r, s.h, s.r);
    dm.setPosition(s.x, y + s.h / 2, s.z);
    // Apply lean via rotation
    const rotM = new THREE.Matrix4();
    rotM.makeRotationX(s.lean);
    const rotZ = new THREE.Matrix4();
    rotZ.makeRotationZ(s.leanZ);
    dm.multiply(rotM).multiply(rotZ);
    dm.setPosition(s.x, y + s.h / 2, s.z);
    culmMesh.setMatrixAt(i, dm);
    // Slight color variation per stalk
    const hue = 0.22 + (Math.random() - 0.5) * 0.04;
    const sat = 0.45 + Math.random() * 0.15;
    const lit = 0.5 + Math.random() * 0.15;
    const col = new THREE.Color().setHSL(hue, sat, lit);
    culmMesh.setColorAt(i, col);
  });
  culmMesh.instanceMatrix.needsUpdate = true;
  if (culmMesh.instanceColor) culmMesh.instanceColor.needsUpdate = true;
  bm.add(culmMesh);

  // ── Node rings — darker bands at segment joints ──
  const nodeGeo = new THREE.TorusGeometry(1, 0.2, 4, 6);
  const nodeMat = mt(BAMBOO_NODE, { roughness: 0.5 });
  // Count nodes: each stalk has floor(h / 0.8) nodes
  let totalNodes = 0;
  stalkData.forEach(s => { totalNodes += Math.floor(s.h / 0.3); });
  const nodeMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, totalNodes);
  const nm = new THREE.Matrix4();
  let nodeIdx = 0;
  stalkData.forEach(s => {
    const y = getTerrainY(s.x, s.z);
    const segs = Math.floor(s.h / 0.3);
    for (let j = 1; j < segs; j++) {
      const ny = y + j * 0.3;
      nm.identity();
      nm.makeScale(s.r * 1.15, s.r * 1.15, s.r * 1.15);
      const rotX = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      nm.multiply(rotX);
      nm.setPosition(s.x, ny, s.z);
      nodeMesh.setMatrixAt(nodeIdx, nm);
      nodeIdx++;
    }
  });
  nodeMesh.instanceMatrix.needsUpdate = true;
  nodeMesh.count = nodeIdx;
  bm.add(nodeMesh);

  // ── Leaf clusters — small planes in upper third ──
  const leafGeo = new THREE.PlaneGeometry(0.15, 0.06);
  const leafMat = mt(BAMBOO_LEAF, { side: THREE.DoubleSide, roughness: 0.8 });
  const leafCount = stalkData.length * 3;
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, leafCount);
  leafMesh.castShadow = true;
  const lm = new THREE.Matrix4();
  let leafIdx = 0;
  stalkData.forEach(s => {
    const y = getTerrainY(s.x, s.z);
    // 3 leaf clusters per stalk in upper portion
    for (let lf = 0; lf < 3; lf++) {
      const ly = y + s.h * (0.6 + lf * 0.13) + (Math.random() - 0.5) * 0.3;
      const la = Math.random() * Math.PI * 2;
      const lr = s.r + 0.05 + Math.random() * 0.08;
      const lx = s.x + Math.cos(la) * lr;
      const lz = s.z + Math.sin(la) * lr;
      lm.identity();
      const scale = 0.8 + Math.random() * 0.5;
      lm.makeScale(scale, scale, scale);
      const rotY = new THREE.Matrix4().makeRotationY(la);
      const rotX = new THREE.Matrix4().makeRotationX(-0.3 + Math.random() * 0.6);
      const rotZ = new THREE.Matrix4().makeRotationZ(-0.4 + Math.random() * 0.4);
      lm.multiply(rotY).multiply(rotX).multiply(rotZ);
      lm.setPosition(lx, ly, lz);
      leafMesh.setMatrixAt(leafIdx, lm);
      // Leaf color variation
      const lCol = new THREE.Color().setHSL(0.28 + Math.random() * 0.06, 0.55 + Math.random() * 0.2, 0.35 + Math.random() * 0.15);
      leafMesh.setColorAt(leafIdx, lCol);
      leafIdx++;
    }
  });
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  leafMesh.count = leafIdx;
  bm.add(leafMesh);

  // ══════════════════════════════════════════════
  //   KOREAN STRUCTURES
  // ══════════════════════════════════════════════

  // ── Hongsalmun gate (Korean red gate at path entrance) ──
  const gate = new THREE.Group();
  const gateY = getTerrainY(0, 2.8);
  // Two tall red pillars
  for (const gx of [-0.22, 0.22]) {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.04, 0.9, 6), mt(VERMILLION, { roughness: 0.7 }));
    pillar.position.set(gx, 0.45, 0); gate.add(pillar);
    // Stone base
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.08), mt(STONE_GRAY));
    base.position.set(gx, 0.02, 0); gate.add(base);
  }
  // Two red crossbeams
  const beam1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.03), mt(VERMILLION));
  beam1.position.y = 0.85; gate.add(beam1);
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.025, 0.025), mt(VERMILLION));
  beam2.position.y = 0.75; gate.add(beam2);
  // Small spikes on top beam (salchang)
  for (let sp = -2; sp <= 2; sp++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.06, 4), mt(VERMILLION));
    spike.position.set(sp * 0.12, 0.90, 0); gate.add(spike);
  }
  gate.position.set(0, gateY, 2.8); bm.add(gate);

  // ── Jangseung (carved wooden totem poles) — pair at path entrance ──
  for (const jx of [-0.35, 0.35]) {
    const jang = new THREE.Group();
    // Tall wooden pole
    const pole = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.7, 0.04), mt(DARK_WOOD, { roughness: 0.95 }));
    pole.position.y = 0.35; jang.add(pole);
    // Face carved at top (simplified: lighter block with features)
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.05), mt(0x8a7050));
    face.position.y = 0.62; jang.add(face);
    // Eyes
    for (const ex of [-0.015, 0.015]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4), mt(0x303030));
      eye.position.set(ex, 0.65, 0.025); jang.add(eye);
    }
    // Mouth
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.01), mt(0x303030));
    mouth.position.set(0, 0.59, 0.025); jang.add(mouth);
    // Hat/cap
    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.07), mt(DARK_WOOD));
    hat.position.y = 0.70; jang.add(hat);
    jang.position.set(jx, getTerrainY(jx, 2.4), 2.4);
    bm.add(jang);
  }

  // ── Hanok Pavilion (jeongja) — open octagonal pavilion at center ──
  const pavilion = new THREE.Group();
  const pavY = getTerrainY(0, 0);
  // Raised wooden floor (octagonal approximation via cylinder)
  const pavFloor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 0.06, 8), mt(DARK_WOOD, { roughness: 0.8 }));
  pavFloor.position.y = 0.25; pavilion.add(pavFloor);
  // Stone foundation
  const pavBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.8, 0.2, 8), mt(STONE_GRAY, { roughness: 0.95 }));
  pavBase.position.y = 0.12; pavilion.add(pavBase);
  // 8 wooden pillars
  for (let pi = 0; pi < 8; pi++) {
    const pa = (pi / 8) * Math.PI * 2;
    const px = Math.cos(pa) * 0.6, pz = Math.sin(pa) * 0.6;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, 0.8, 6), mt(DARK_WOOD));
    pillar.position.set(px, 0.68, pz); pavilion.add(pillar);
  }
  // Curved tiled roof with upswept eaves — key Korean silhouette
  // Main roof body (wide cone, squashed)
  const roofMain = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 0.4, 8), mt(ROOF_TILE));
  roofMain.position.y = 1.25; pavilion.add(roofMain);
  // Eave ring (upswept lip — torus at edge of roof)
  const eave = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.03, 4, 8), mt(ROOF_TILE));
  eave.rotation.x = -Math.PI / 2; eave.position.y = 1.08; pavilion.add(eave);
  // Ridge ornament on top
  const ridgeOrn = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 4), mt(STONE_GRAY));
  ridgeOrn.position.y = 1.48; pavilion.add(ridgeOrn);
  // Railing between pillars
  for (let ri = 0; ri < 8; ri++) {
    const ra0 = (ri / 8) * Math.PI * 2;
    const ra1 = ((ri + 1) / 8) * Math.PI * 2;
    const rx0 = Math.cos(ra0) * 0.6, rz0 = Math.sin(ra0) * 0.6;
    const rx1 = Math.cos(ra1) * 0.6, rz1 = Math.sin(ra1) * 0.6;
    const rLen = Math.sqrt((rx1 - rx0) ** 2 + (rz1 - rz0) ** 2);
    const rAng = Math.atan2(rz1 - rz0, rx1 - rx0);
    // Skip one section for entrance
    if (ri === 4) continue;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(rLen, 0.02, 0.02), mt(DARK_WOOD));
    rail.position.set((rx0 + rx1) / 2, 0.38, (rz0 + rz1) / 2);
    rail.rotation.y = -rAng; pavilion.add(rail);
  }
  pavilion.position.set(0, pavY, 0); bm.add(pavilion);

  // ── Small Hanok building (white plaster, dark wood, curved roof) ──
  const hanok = new THREE.Group();
  const hanokY = getTerrainY(-0.8, -1.5);
  // Raised stone foundation
  const hBase = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.6), mt(STONE_GRAY));
  hBase.position.y = 0.05; hanok.add(hBase);
  // White plaster walls
  const hWalls = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.5), mt(WHITE_WALL, { roughness: 0.85 }));
  hWalls.position.y = 0.35; hanok.add(hWalls);
  // Dark wood beams (exposed frame)
  for (const fx of [-0.4, 0, 0.4]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.5, 0.52), mt(DARK_WOOD));
    beam.position.set(fx, 0.35, 0); hanok.add(beam);
  }
  const topBeam = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.03, 0.03), mt(DARK_WOOD));
  topBeam.position.set(0, 0.6, 0.25); hanok.add(topBeam);
  const topBeam2 = topBeam.clone(); topBeam2.position.z = -0.25; hanok.add(topBeam2);
  // Curved tiled roof (giwa) — box with slight overhang
  const hRoof = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.7), mt(ROOF_TILE));
  hRoof.position.y = 0.65; hanok.add(hRoof);
  // Roof ridge
  const hRidge = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.04), mt(ROOF_TILE));
  hRidge.position.y = 0.70; hanok.add(hRidge);
  // Upswept eave corners (4 small angled blocks)
  for (const cx of [-0.48, 0.48]) {
    for (const cz of [-0.33, 0.33]) {
      const corner = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.08), mt(ROOF_TILE));
      corner.position.set(cx, 0.67, cz);
      corner.rotation.x = cz > 0 ? -0.15 : 0.15;
      corner.rotation.z = cx > 0 ? 0.15 : -0.15;
      hanok.add(corner);
    }
  }
  // Wooden veranda (maru)
  const maru = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.2), mt(DARK_WOOD));
  maru.position.set(0, 0.12, 0.35); hanok.add(maru);
  // Door panels
  for (const dx of [-0.15, 0.15]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.015), mt(0xd8c8a0));
    door.position.set(dx, 0.28, 0.25); hanok.add(door);
  }
  hanok.position.set(-0.8, hanokY, -1.5); hanok.rotation.y = 0.3; bm.add(hanok);

  // ── Stone Pagoda (seoktap) — 5 tiers ──
  const pagoda = new THREE.Group();
  const pagY = getTerrainY(-1.5, -0.3);
  // Base platform
  const pgBase = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), mt(STONE_GRAY));
  pgBase.position.y = 0.03; pagoda.add(pgBase);
  // 5 tiered stone slabs, each smaller
  for (let tier = 0; tier < 5; tier++) {
    const tSize = 0.32 - tier * 0.04;
    const tH = 0.08;
    const tY = 0.08 + tier * 0.14;
    // Body block
    const body = new THREE.Mesh(new THREE.BoxGeometry(tSize * 0.7, tH, tSize * 0.7),
      mt(STONE_GRAY, { roughness: 0.95 }));
    body.position.y = tY; pagoda.add(body);
    // Roof slab (wider, thin, with slight overhang)
    const slab = new THREE.Mesh(new THREE.BoxGeometry(tSize, 0.02, tSize), mt(STONE_DARK));
    slab.position.y = tY + tH / 2 + 0.01; pagoda.add(slab);
    // Upturn at corners
    for (const ux of [-tSize / 2, tSize / 2]) {
      for (const uz of [-tSize / 2, tSize / 2]) {
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.015), mt(STONE_DARK));
        tip.position.set(ux, tY + tH / 2 + 0.02, uz); pagoda.add(tip);
      }
    }
  }
  // Finial on top
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), mt(STONE_GRAY));
  finial.position.y = 0.08 + 5 * 0.14 + 0.03; pagoda.add(finial);
  pagoda.position.set(-1.5, pagY, -0.3); bm.add(pagoda);

  // ── Jangdok (fermentation jars) on stone terrace ──
  const jdTerrace = new THREE.Group();
  const jdY = getTerrainY(1.5, -1.8);
  // Stone platform
  const jdBase = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.6), mt(STONE_GRAY));
  jdBase.position.y = 0.025; jdTerrace.add(jdBase);
  // 8 large ceramic jars in rows
  const jarPositions = [
    [-0.25, -0.15], [0, -0.15], [0.25, -0.15],
    [-0.25, 0.15], [0, 0.15], [0.25, 0.15],
    [-0.12, 0], [0.12, 0],
  ];
  jarPositions.forEach(([jx, jz]) => {
    const jar = new THREE.Group();
    const jarBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.04, 0.1, 8), mt(0x5a4a3a, { roughness: 0.85 }));
    jarBody.position.y = 0.08; jar.add(jarBody);
    // Rounded top
    const jarTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mt(0x5a4a3a));
    jarTop.position.y = 0.13; jar.add(jarTop);
    // Lid
    const lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.015, 8), mt(0x707060));
    lid.position.y = 0.14; jar.add(lid);
    jar.position.set(jx, 0.05, jz);
    jdTerrace.add(jar);
  });
  jdTerrace.position.set(1.5, jdY, -1.8); jdTerrace.rotation.y = -0.3; bm.add(jdTerrace);

  // ── Lotus pond (east side) with stone bridge ──
  const pond = new THREE.Group();
  const pondY = getTerrainY(1.8, -0.5);
  // Water surface
  const pondWater = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 16), mt(0x508880, { roughness: 0.1, metalness: 0.05 }));
  pondWater.rotation.x = -Math.PI / 2; pondWater.position.y = 0.0; pond.add(pondWater);
  // Stone rim
  const pondRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.04, 4, 16), mt(STONE_GRAY, { roughness: 0.95 }));
  pondRim.rotation.x = -Math.PI / 2; pondRim.position.y = 0.02; pond.add(pondRim);
  // Lotus pads (flat green discs)
  for (let lp = 0; lp < 6; lp++) {
    const la = lp * Math.PI / 3 + Math.random() * 0.5;
    const ld = 0.2 + Math.random() * 0.35;
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(0.06 + Math.random() * 0.03, 8),
      mt(0x4a8a3a, { roughness: 0.8 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(Math.cos(la) * ld, 0.01, Math.sin(la) * ld);
    pond.add(pad);
    // Lotus flower on some pads
    if (Math.random() > 0.5) {
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 5, 4), mt(0xe888a8));
      flower.scale.y = 0.5;
      flower.position.set(Math.cos(la) * ld, 0.03, Math.sin(la) * ld);
      pond.add(flower);
    }
  }
  // Small stone bridge across pond
  const sBridge = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.8), mt(STONE_GRAY));
  sBridge.position.set(0, 0.06, 0); sBridge.rotation.y = 0.4; pond.add(sBridge);
  // Bridge rails
  for (const bSide of [-0.06, 0.06]) {
    const bRail = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.8), mt(STONE_GRAY));
    bRail.position.set(bSide, 0.10, 0); bRail.rotation.y = 0.4; pond.add(bRail);
  }
  pond.position.set(1.8, pondY - 0.03, -0.5); bm.add(pond);

  // ── Korean stone lanterns (simpler, squatter than Japanese) ──
  function makeKoreanLantern(lx, lz) {
    const lantern = new THREE.Group();
    const ly = getTerrainY(lx, lz);
    // Square base
    const lBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.06), mt(STONE_GRAY));
    lBase.position.y = 0.015; lantern.add(lBase);
    // Short thick shaft
    const lShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.08, 4), mt(STONE_GRAY));
    lShaft.position.y = 0.07; lantern.add(lShaft);
    // Light chamber (square box)
    const lBox = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), mt(STONE_DARK));
    lBox.position.y = 0.13; lantern.add(lBox);
    // Openings (emissive)
    for (const side of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const opening = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.02),
        mt(0xffeeaa, { emissive: 0xffcc44, emissiveIntensity: 0.4 }));
      opening.position.set(Math.cos(side) * 0.026, 0.13, Math.sin(side) * 0.026);
      opening.rotation.y = side; lantern.add(opening);
    }
    // Flat roof cap
    const lRoof = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.07), mt(STONE_DARK));
    lRoof.position.y = 0.16; lantern.add(lRoof);
    lantern.position.set(lx, ly, lz); bm.add(lantern);
  }
  // Line the path
  const lanternPairs = [
    [2.6], [2.0], [1.4], [0.8], [0.3]
  ];
  lanternPairs.forEach(([pz]) => {
    makeKoreanLantern(-0.3, pz);
    makeKoreanLantern(0.3, pz);
  });

  // ── Korean pine trees (sonamu) — twisted trunk, flat layered canopy ──
  function makeKoreanPine(px, pz) {
    const pine = new THREE.Group();
    const py = getTerrainY(px, pz);
    // Twisted trunk — 3 segments slightly offset
    for (let seg = 0; seg < 3; seg++) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04 - seg * 0.008, 0.05 - seg * 0.008, 0.35, 5),
        mt(0x6a5040, { roughness: 0.95 }));
      trunk.position.set(
        Math.sin(seg * 1.2) * 0.04,
        0.17 + seg * 0.3,
        Math.cos(seg * 0.8) * 0.03);
      trunk.rotation.z = (seg - 1) * 0.15;
      pine.add(trunk);
    }
    // 3-4 flat layered canopy discs at different heights
    const canopyLayers = [
      { y: 0.8, r: 0.25, ox: 0.05, oz: 0 },
      { y: 1.0, r: 0.20, ox: -0.03, oz: 0.04 },
      { y: 1.15, r: 0.15, ox: 0.02, oz: -0.03 },
    ];
    canopyLayers.forEach(cl => {
      const canopy = new THREE.Mesh(
        new THREE.CylinderGeometry(cl.r, cl.r * 1.1, 0.06, 7),
        mt(0x2a5a28, { roughness: 0.9 }));
      canopy.position.set(cl.ox, cl.y, cl.oz);
      pine.add(canopy);
    });
    pine.position.set(px, py, pz); bm.add(pine);
  }
  makeKoreanPine(-2.5, 1.0);
  makeKoreanPine(2.3, 1.5);
  makeKoreanPine(-2.0, -2.0);
  makeKoreanPine(2.8, -1.0);
  makeKoreanPine(-0.5, -2.5);

  // ── Stone Buddha (weathered, partially moss-covered) ──
  const buddha = new THREE.Group();
  const budY = getTerrainY(-2.0, 0.5);
  // Body (seated figure — simplified box+sphere)
  const bBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.15, 0.1), mt(STONE_GRAY, { roughness: 1 }));
  bBody.position.y = 0.1; buddha.add(bBody);
  const bHead = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), mt(STONE_GRAY));
  bHead.position.y = 0.22; buddha.add(bHead);
  // Moss patches
  const bMoss = new THREE.Mesh(new THREE.SphereGeometry(0.04, 4, 3), mt(MOSS_GREEN));
  bMoss.position.set(0.04, 0.08, 0.04); bMoss.scale.set(1, 0.3, 1); buddha.add(bMoss);
  buddha.position.set(-2.0, budY, 0.5); bm.add(buddha);

  // ── Winding stone-slab path ──
  const pathPts = [
    { x: 0, z: 3.2 }, { x: 0.05, z: 2.8 }, { x: -0.05, z: 2.4 },
    { x: 0.08, z: 2.0 }, { x: -0.08, z: 1.5 }, { x: 0.05, z: 1.0 },
    { x: -0.05, z: 0.5 }, { x: 0, z: 0.2 },
  ];
  for (let pi = 0; pi < pathPts.length - 1; pi++) {
    const p0 = pathPts[pi], p1 = pathPts[pi + 1];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const ang = Math.atan2(dz, dx);
    const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, len),
      mt(0xa8a090, { roughness: 0.95 }));
    slab.position.set(mx, getTerrainY(mx, mz) + 0.01, mz);
    slab.rotation.y = -ang + Math.PI / 2;
    bm.add(slab);
  }

  // ── Dappled light patches on ground (through bamboo canopy) ──
  for (let dp = 0; dp < 25; dp++) {
    const da = Math.random() * Math.PI * 2;
    const dd = 0.8 + Math.random() * 2.5;
    const dx = Math.cos(da) * dd, dz = Math.sin(da) * dd;
    if (inClearing(dx, dz)) continue;
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(0.08 + Math.random() * 0.06, 6),
      mt(0xc0d880, { transparent: true, opacity: 0.25 }));
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(dx, getTerrainY(dx, dz) + 0.02, dz);
    bm.add(patch);
  }

  // ── Prayer ribbons tied to bamboo near gate ──
  for (let pr = 0; pr < 12; pr++) {
    const ra = (pr / 12) * Math.PI * 2;
    const rd = 0.5 + Math.random() * 0.4;
    const rx = Math.cos(ra) * rd, rz = 2.0 + Math.sin(ra) * rd;
    const rh = 0.8 + Math.random() * 1.5;
    const ribbon = new THREE.Mesh(
      new THREE.PlaneGeometry(0.02, 0.12 + Math.random() * 0.08),
      mt(Math.random() > 0.5 ? 0xc84040 : 0xf0e8d0,
        { side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    ribbon.position.set(rx, getTerrainY(rx, rz) + rh, rz);
    ribbon.rotation.set(0, Math.random() * Math.PI, 0.1 + Math.random() * 0.3);
    bm.add(ribbon);
  }

  // ── Moss-covered rocks ──
  for (let mr = 0; mr < 12; mr++) {
    const ma = Math.random() * Math.PI * 2;
    const md = 0.8 + Math.random() * 2.5;
    const mx = Math.cos(ma) * md, mz = Math.sin(ma) * md;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.05 + Math.random() * 0.06, 0),
      mt(0x6a8a5a, { roughness: 1 }));
    rock.position.set(mx, getTerrainY(mx, mz) - 0.01, mz);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    bm.add(rock);
  }

  // ── Small stream ──
  const streamPath = [
    { x: -3.0, z: -0.5 }, { x: -2.2, z: -0.2 }, { x: -1.2, z: 0.1 },
    { x: -0.5, z: -0.2 }, { x: 0.3, z: -0.4 }, { x: 1.0, z: -0.1 },
    { x: 1.6, z: -0.5 },
  ];
  for (let si = 0; si < streamPath.length - 1; si++) {
    const s0 = streamPath[si], s1 = streamPath[si + 1];
    const sdx = s1.x - s0.x, sdz = s1.z - s0.z;
    const sLen = Math.sqrt(sdx * sdx + sdz * sdz);
    const sAng = Math.atan2(sdz, sdx);
    const smx = (s0.x + s1.x) / 2, smz = (s0.z + s1.z) / 2;
    const sSeg = new THREE.Mesh(new THREE.BoxGeometry(sLen, 0.005, 0.1),
      mt(0x70a8c0, { transparent: true, opacity: 0.35 }));
    sSeg.position.set(smx, getTerrainY(smx, smz) - 0.01, smz);
    sSeg.rotation.y = -sAng; bm.add(sSeg);
  }

  // ── Deer among bamboo ──
  for (let dr = 0; dr < 3; dr++) {
    const deer = new THREE.Group();
    const dBody = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.08), mt(0xb09060));
    dBody.position.y = 0.04; deer.add(dBody);
    const dHead = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.03), mt(0xb09060));
    dHead.position.set(0, 0.06, 0.05); deer.add(dHead);
    for (const lx of [-0.012, 0.012]) {
      for (const lz of [-0.02, 0.02]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.04, 3), mt(0xa08050));
        leg.position.set(lx, 0.0, lz); deer.add(leg);
      }
    }
    const deerPos = [
      [1.5, 0.5], [-1.0, 1.8], [2.0, -1.2]
    ][dr];
    deer.position.set(deerPos[0], getTerrainY(deerPos[0], deerPos[1]) + 0.02, deerPos[1]);
    deer.rotation.y = -0.5 + dr * 1.2;
    bm.add(deer);
  }

  scene.add(bm);

  // ── Bridge to main island ──
  const bmBA = Math.atan2(BM_Z, BM_X);
  const bmMainEdge = getIslandRadius(bmBA);
  const bb1X = Math.cos(bmBA) * (bmMainEdge - 0.5);
  const bb1Z = Math.sin(bmBA) * (bmMainEdge - 0.5);
  const bb2X = BM_X + Math.cos(bmBA + Math.PI) * 4.5;
  const bb2Z = BM_Z + Math.sin(bmBA + Math.PI) * 4.5;
  scene.add(buildRopeBridge(bb1X, bb1Z, bb2X, bb2Z, { baseY: 0.08, sag: 0.1 }));
}



/* ═══════════════════════════════════════════════════════════
   Lit Windows, Central Bonfire, Fireflies, Farm, Torches
   ═══════════════════════════════════════════════════════════ */


function createLitWindows() {
  // Add warm emissive window quads to all four district buildings
  // Windows are placed relative to building positions
  ROLES.forEach((r, i) => {
    const bx = r.home[0], bz = r.home[2];
    const by = getTerrainHeight(bx, bz);
    // Each building gets 2-4 lit windows on different faces
    const windowDefs = [
      [{ dx: 0.46, dy: 0.45, dz: 0, ry: 0 }, { dx: -0.46, dy: 0.45, dz: 0, ry: 0 }],
      [{ dx: 0, dy: 0.4, dz: 0.36, ry: 0 }, { dx: 0.3, dy: 0.4, dz: 0, ry: Math.PI/2 }],
      [{ dx: 0.35, dy: 0.35, dz: 0, ry: 0 }, { dx: -0.35, dy: 0.35, dz: 0, ry: 0 }],
      [{ dx: 0, dy: 0.5, dz: 0.3, ry: 0 }, { dx: 0.25, dy: 0.35, dz: 0, ry: Math.PI/2 }],
    ][i];
    windowDefs.forEach((w, wi) => {
      const intensity = wi === 0 ? 0.5 : 0.35; // Vary intensity slightly
      const litWin = new THREE.Mesh(
        new THREE.BoxGeometry(0.015, 0.08, 0.06),
        mt(0xffe8a0, { emissive: 0xffe8a0, emissiveIntensity: intensity }));
      // Scale by building scale factor (1.25)
      litWin.position.set(bx + w.dx * 1.25, by + w.dy * 1.25, bz + w.dz * 1.25);
      litWin.rotation.y = w.ry;
      scene.add(litWin);
    });
  });
}

function createCentralBonfire() {
  // Large gathering bonfire near plaza — bigger than campfires
  const bfx = 0, bfz = -2.5;
  const bfy = getTerrainHeight(bfx, bfz);
  const bonfire = new THREE.Group();
  bonfire.position.set(bfx, bfy, bfz);

  // Large stone ring
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.06, 0), mt(STONE, { roughness: 0.95 }));
    stone.position.set(Math.cos(a) * 0.3, 0.03, Math.sin(a) * 0.3);
    stone.rotation.set(Math.random(), Math.random(), Math.random());
    stone.scale.y = 0.6; bonfire.add(stone);
  }

  // Log stack (criss-crossed)
  for (let i = 0; i < 6; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.25, 5),
      mt(0x6a5a4a, { roughness: 0.95 }));
    log.position.set(0, 0.03 + i * 0.04, 0);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = i % 2 === 0 ? 0 : Math.PI / 2;
    bonfire.add(log);
  }

  // Large flame
  const flameMat = new THREE.MeshStandardMaterial({
    color: 0xff7720, emissive: 0xff5500, emissiveIntensity: 1.5,
    roughness: 1, flatShading: true, transparent: true, opacity: 0.85,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 6), flameMat);
  flame.position.y = 0.35; bonfire.add(flame);

  // Inner bright core
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffdd60, emissive: 0xffbb30, emissiveIntensity: 2.0,
    roughness: 1, flatShading: true, transparent: true, opacity: 0.9,
  });
  const core = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 5), coreMat);
  core.position.y = 0.28; bonfire.add(core);

  // Second flame offset
  const flame2Mat = flameMat.clone();
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), flame2Mat);
  flame2.position.set(0.05, 0.3, 0.04); bonfire.add(flame2);

  animatedObjects.push({ type: "flicker", mesh: flame, mat: flameMat, phase: 0, baseScaleX: 1, baseScaleY: 1 });
  animatedObjects.push({ type: "flicker", mesh: flame2, mat: flame2Mat, phase: 1.5, baseScaleX: 1, baseScaleY: 1 });

  // Strong warm light
  const bfLight = new THREE.PointLight(0xff8830, 1.5, 8);
  bfLight.position.y = 0.4; bonfire.add(bfLight);
  animatedObjects.push({ type: "lightFlicker", light: bfLight, baseIntensity: 1.5 });

  // Heavy smoke
  for (let i = 0; i < 7; i++) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.02 + i * 0.006, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xb0b0b0, transparent: true, opacity: 0.18 - i * 0.02 }));
    puff.position.set(bfx, bfy + 0.45 + i * 0.12, bfz);
    puff.userData.smokeBase = { x: bfx, y: bfy + 0.45 + i * 0.12, z: bfz, i: 40 + i };
    scene.add(puff);
    animatedObjects.push({ type: "smoke", mesh: puff });
  }

  scene.add(bonfire);

  // Register bonfire as interactive
  const bfHitbox = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 4, 4),
    new THREE.MeshBasicMaterial({ visible: false }));
  bfHitbox.position.set(bfx, bfy + 0.3, bfz);
  scene.add(bfHitbox);
  interactiveObjects.push({
    hitbox: bfHitbox, type: "bonfire", label: "Inspect",
    group: bonfire, data: { name: "Gathering Bonfire" },
    reaction: () => {
      // Flare up the flames temporarily
      const origScale = { x: flame.scale.x, y: flame.scale.y, z: flame.scale.z };
      flame.scale.set(1.8, 2.0, 1.8);
      core.scale.set(1.6, 1.8, 1.6);
      bfLight.intensity = 4.0;
      setTimeout(() => {
        flame.scale.set(origScale.x, origScale.y, origScale.z);
        core.scale.set(1, 1, 1);
        bfLight.intensity = 1.5;
      }, 1500);
    },
  });

  // ── Log seating ring around the bonfire ──
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const d = 0.7;
    const sx = bfx + Math.cos(a) * d, sz = bfz + Math.sin(a) * d;
    const sy = getTerrainHeight(sx, sz);
    const seatLog = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.3, 5), mt(WOOD_D, { roughness: 0.95 }));
    seatLog.position.set(sx, sy + 0.04, sz);
    seatLog.rotation.z = Math.PI / 2;
    seatLog.rotation.y = a + Math.PI / 2;
    seatLog.castShadow = true; scene.add(seatLog);
  }
}

function createFireflies() {
  // (Fireflies removed — appeared as white specks at distance)
}

function createPathTorches() {
  // Torches along main paths between districts
  const torchSpots = [
    [-2, -3], [-3, -4.5], [0, -3.5], [2, -3],
    [3, -4.5], [-3, 3], [-4.5, 4.5], [3, 3],
    [4.5, 4.5], [-2, 0], [2, 0], [0, 3],
  ];
  torchSpots.forEach(([tx, tz], idx) => {
    if (!isOnIsland(tx, tz)) return;
    const ty = getTerrainHeight(tx, tz);
    // Post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.35, 4), mt(WOOD_D));
    post.position.set(tx, ty + 0.175, tz); scene.add(post);
    // Flame
    const tFlameMat = new THREE.MeshStandardMaterial({
      color: 0xff8830, emissive: 0xff6610, emissiveIntensity: 1.0,
      roughness: 1, flatShading: true, transparent: true, opacity: 0.8,
    });
    const tFlame = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4), tFlameMat);
    tFlame.position.set(tx, ty + 0.38, tz); scene.add(tFlame);
    animatedObjects.push({
      type: "flicker", mesh: tFlame, mat: tFlameMat,
      phase: idx * 0.7, baseScaleX: 1, baseScaleY: 1,
    });
    // (glow sphere removed — looked like floating dot)
  });
}

function createFarmZone() {
  // Farm in the southern area of the island
  const farmX = -2, farmZ = 7;
  const farmY = getTerrainHeight(farmX, farmZ);
  const farm = new THREE.Group();
  farm.position.set(farmX, farmY, farmZ);

  // ── Windmill (vertical landmark) ──
  const wmGroup = new THREE.Group();
  wmGroup.position.set(1.5, 0, 0.5);
  const wmBase = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.8, 6), mt(STONE));
  wmBase.position.y = 0.4; wmGroup.add(wmBase);
  const wmRoof = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.15, 6), mt(WOOD_D));
  wmRoof.position.y = 0.85; wmGroup.add(wmRoof);
  // Blades
  const bladeHub = new THREE.Group();
  bladeHub.position.set(0, 0.65, 0.13);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.45, 0.008), mt(WOOD));
    blade.position.y = 0.22;
    const arm = new THREE.Group();
    arm.rotation.z = (i / 4) * Math.PI * 2;
    arm.add(blade);
    bladeHub.add(arm);
  }
  wmGroup.add(bladeHub);
  animatedObjects.push({ type: "spin", mesh: bladeHub, speed: 0.4, axis: "z" });
  farm.add(wmGroup);

  // ── Barn ──
  const barn = new THREE.Group();
  barn.position.set(-1, 0, -0.5);
  barn.rotation.y = 0.3;
  const barnWalls = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.5), mt(0x8a4a3a));
  barnWalls.position.y = 0.2; barnWalls.castShadow = true; barn.add(barnWalls);
  const barnRoof = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.2, 4), mt(WOOD_D));
  barnRoof.position.y = 0.5; barnRoof.rotation.y = Math.PI / 4; barn.add(barnRoof);
  const barnDoor = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.01), mt(WOOD));
  barnDoor.position.set(0, 0.125, 0.255); barn.add(barnDoor);
  barn.add(makeContactShadow(0.3));
  farm.add(barn);

  // ── Crop rows ──
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      const cx = -0.3 + col * 0.25, cz = 0.5 + row * 0.3;
      const cropH = 0.05 + Math.random() * 0.1 + row * 0.02; // varying growth
      const crop = new THREE.Mesh(
        new THREE.ConeGeometry(0.02, cropH, 4), mt(row < 2 ? GREEN_L : GREEN_D));
      crop.position.set(cx, cropH / 2 + 0.01, cz); farm.add(crop);
    }
    // Dirt row
    const dirtRow = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.015, 0.08), mt(DIRT_D));
    dirtRow.position.set(0.45, 0.005, 0.5 + row * 0.3); farm.add(dirtRow);
  }

  // ── Fencing ──
  const fencePosts = [[-0.5, 0.3], [1.3, 0.3], [-0.5, 1.8], [1.3, 1.8]];
  fencePosts.forEach(([fx, fz]) => {
    const fPost = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.2, 4), mt(WOOD_D));
    fPost.position.set(fx, 0.1, fz); farm.add(fPost);
  });
  // Horizontal rails
  const fenceRails = [
    [[-0.5, 0.3], [1.3, 0.3]], [[-0.5, 1.8], [1.3, 1.8]],
    [[-0.5, 0.3], [-0.5, 1.8]], [[1.3, 0.3], [1.3, 1.8]],
  ];
  fenceRails.forEach(([[x1, z1], [x2, z2]]) => {
    const len = Math.sqrt((x2-x1)**2 + (z2-z1)**2);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, len, 3), mt(WOOD));
    rail.position.set((x1+x2)/2, 0.15, (z1+z2)/2);
    rail.rotation.z = Math.PI / 2;
    rail.rotation.y = -Math.atan2(z2-z1, x2-x1);
    farm.add(rail);
  });

  // ── Scarecrow (wind-swaying) ──
  const sc = new THREE.Group();
  sc.position.set(0.5, 0, 1.0);
  const scPost = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.5, 4), mt(WOOD_D));
  scPost.position.y = 0.25; sc.add(scPost);
  const scArm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 3), mt(WOOD_D));
  scArm.position.y = 0.4; scArm.rotation.z = Math.PI / 2; sc.add(scArm);
  const scHead = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), mt(0xd0c0a0));
  scHead.position.y = 0.53; sc.add(scHead);
  // Hat
  const scHat = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.06, 5), mt(0x705030));
  scHat.position.y = 0.59; sc.add(scHat);
  const scBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.008, 6), mt(0x705030));
  scBrim.position.y = 0.555; sc.add(scBrim);
  // Cloth (swaying)
  const scCloth = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.15),
    mtWind(0xc8b890, { heightFactor: 2.0, swayAmp: 0.015, swaySpeed: 1.5 }));
  scCloth.position.set(0, 0.32, 0.01); sc.add(scCloth);
  farm.add(sc);

  // ── Hay bales ──
  for (let i = 0; i < 3; i++) {
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 6),
      mt(0xc8b870, { roughness: 0.95 }));
    bale.position.set(-0.8 + i * 0.25, 0.06, -0.2);
    bale.rotation.z = Math.PI / 2; farm.add(bale);
  }

  // ── Wheelbarrow ──
  const wb = new THREE.Group();
  wb.position.set(0.8, 0, -0.3);
  const wbBucket = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.12), mt(WOOD_D));
  wbBucket.position.y = 0.05; wb.add(wbBucket);
  const wbWheel = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 4, 8), mt(METAL));
  wbWheel.position.set(0, 0.025, 0.08); wb.add(wbWheel);
  const wbHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 3), mt(WOOD_D));
  wbHandle.position.set(0, 0.04, -0.1); wbHandle.rotation.x = 0.3; wb.add(wbHandle);
  farm.add(wb);

  // ── Chickens (simple pecking animation) ──
  for (let i = 0; i < 3; i++) {
    const chicken = new THREE.Group();
    const ca = Math.random() * Math.PI * 2;
    const cd = 0.3 + Math.random() * 0.6;
    chicken.position.set(0.3 + Math.cos(ca) * cd, 0, 1.2 + Math.sin(ca) * cd);
    // Body
    const cBody = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), mt(i === 0 ? 0xd0d0d0 : 0xc08040));
    cBody.position.y = 0.03; cBody.scale.set(1, 0.8, 1.3); chicken.add(cBody);
    // Head
    const cHead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), mt(i === 0 ? 0xd0d0d0 : 0xc08040));
    cHead.position.set(0, 0.045, 0.025); chicken.add(cHead);
    // Beak
    const cBeak = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.01, 3), mt(0xd0a020));
    cBeak.position.set(0, 0.04, 0.04); cBeak.rotation.x = Math.PI / 2; chicken.add(cBeak);
    // Comb
    const cComb = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.01), mt(0xc04040));
    cComb.position.set(0, 0.055, 0.02); chicken.add(cComb);
    farm.add(chicken);
    // Pecking animation (bob up/down)
    animatedObjects.push({
      type: "bob", mesh: chicken, speed: 2 + Math.random(),
      baseY: chicken.position.y, amp: 0.008, phase: i * 2,
    });
  }

  scene.add(farm);
}

function createStringLights() {
  // String lights around the plaza
  const plazaR = 2.2;
  const stringCount = 8;
  for (let i = 0; i < stringCount; i++) {
    const a1 = (i / stringCount) * Math.PI * 2;
    const a2 = ((i + 1) / stringCount) * Math.PI * 2;
    const x1 = Math.cos(a1) * plazaR, z1 = Math.sin(a1) * plazaR;
    const x2 = Math.cos(a2) * plazaR, z2 = Math.sin(a2) * plazaR;
    // 3 lights per segment
    for (let j = 1; j <= 3; j++) {
      const t = j / 4;
      const lx = x1 + (x2 - x1) * t;
      const lz = z1 + (z2 - z1) * t;
      const ly = getTerrainHeight(lx, lz) + 0.35 - Math.sin(t * Math.PI) * 0.04;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.01, 4, 3),
        mt(0xffe8a0, { emissive: 0xffe8a0, emissiveIntensity: 0.5 }));
      bulb.position.set(lx, ly, lz); scene.add(bulb);
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Dolphins & Hot Air Balloon
   ═══════════════════════════════════════════════════════════ */

function createDolphins() {
  // 4 dolphins at different positions around the island, arcing out of water
  const spots = [
    { cx: 14, cz: 0, phase: 0 },
    { cx: -10, cz: 14, phase: 2.5 },
    { cx: -14, cz: -8, phase: 5.0 },
    { cx: 12, cz: -10, phase: 7.5 },
  ];
  spots.forEach((spot) => {
    const dolphin = new THREE.Group();
    // Body — sleek elongated shape
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 4, 6), mt(0x5a7a8a));
    body.rotation.z = Math.PI / 2; dolphin.add(body);
    // Lighter belly
    const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.15, 4, 6), mt(0x8aacbc));
    belly.rotation.z = Math.PI / 2; belly.position.y = -0.02; dolphin.add(belly);
    // Dorsal fin
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), mt(0x5a7a8a));
    dorsal.position.set(0, 0.06, 0); dorsal.rotation.z = 0.15; dolphin.add(dorsal);
    // Tail flukes
    const fluke = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.04), mt(0x5a7a8a));
    fluke.position.set(-0.14, 0, 0); dolphin.add(fluke);
    // Snout
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 5), mt(0x5a7a8a));
    snout.position.set(0.14, -0.01, 0); snout.rotation.z = -Math.PI / 2; dolphin.add(snout);
    // Eye (tiny)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 4), mt(0x3a3a3a));
    eye.position.set(0.08, 0.02, 0.05); dolphin.add(eye);

    dolphin.scale.setScalar(1.2);
    dolphin.position.set(spot.cx, -0.3, spot.cz);
    scene.add(dolphin);
    animatedObjects.push({
      type: "dolphin", mesh: dolphin,
      cx: spot.cx, cz: spot.cz, phase: spot.phase,
      speed: 0.4 + Math.random() * 0.15,
    });
  });
}

function createHotAirBalloon() {
  const balloon = new THREE.Group();
  // Envelope — colorful panels (sphere with stripes)
  const envelope = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.7),
    mt(0xd04040));
  envelope.position.y = 0.6; envelope.castShadow = true; balloon.add(envelope);
  // Color panels (alternating stripes via overlaid half-spheres)
  const panelColors = [0xe8c040, 0x4080c0, 0xd04040, 0xe08030];
  for (let i = 0; i < 4; i++) {
    const panel = new THREE.Mesh(
      new THREE.SphereGeometry(0.61, 4, 8, (i / 4) * Math.PI * 2, Math.PI / 2, 0, Math.PI * 0.7),
      mt(panelColors[i]));
    panel.position.y = 0.6; balloon.add(panel);
  }
  // Basket
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), mt(WOOD_D));
  basket.position.y = -0.1; basket.castShadow = true; balloon.add(basket);
  // Basket rim
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.2), mt(WOOD));
  rim.position.y = -0.04; balloon.add(rim);
  // Ropes (4 corners)
  for (const [rx, rz] of [[0.08, 0.08], [-0.08, 0.08], [0.08, -0.08], [-0.08, -0.08]]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 3), mt(0x8a7a5a));
    rope.position.set(rx, 0.2, rz); balloon.add(rope);
  }
  // Flame glow (under envelope)
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4),
    mt(0xffaa30, { emissive: 0xff8800, emissiveIntensity: 1.0 }));
  flame.position.y = 0.05; balloon.add(flame);

  balloon.scale.setScalar(1.5);
  balloon.position.set(-1, 7, 1);
  scene.add(balloon);
  animatedObjects.push({
    type: "balloon", mesh: balloon,
    cx: -1, cz: 1, baseY: 7,
    speed: 0.08, radius: 4, phase: 0,
  });

  // Second balloon — smaller, closer to land, different colors
  const b2 = new THREE.Group();
  const env2 = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.7),
    mt(0x4080a0));
  env2.position.y = 0.6; env2.castShadow = true; b2.add(env2);
  const pc2 = [0xf0e060, 0x4080a0, 0xe06040, 0xf0e060];
  for (let i = 0; i < 4; i++) {
    const p2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.61, 4, 8, (i / 4) * Math.PI * 2, Math.PI / 2, 0, Math.PI * 0.7),
      mt(pc2[i]));
    p2.position.y = 0.6; b2.add(p2);
  }
  const bk2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), mt(WOOD_D));
  bk2.position.y = -0.1; bk2.castShadow = true; b2.add(bk2);
  const rm2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.2), mt(WOOD));
  rm2.position.y = -0.04; b2.add(rm2);
  for (const [rx, rz] of [[0.08, 0.08], [-0.08, 0.08], [0.08, -0.08], [-0.08, -0.08]]) {
    const rp = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 3), mt(0x8a7a5a));
    rp.position.set(rx, 0.2, rz); b2.add(rp);
  }
  const fl2 = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4),
    mt(0xffaa30, { emissive: 0xff8800, emissiveIntensity: 1.0 }));
  fl2.position.y = 0.05; b2.add(fl2);
  b2.scale.setScalar(1.1);
  b2.position.set(1, 5, -1);
  scene.add(b2);
  animatedObjects.push({
    type: "balloon", mesh: b2,
    cx: 1, cz: -1, baseY: 5,
    speed: 0.06, radius: 3, phase: Math.PI,
  });
}


/* ═══════════════════════════════════════════════════════════
   World Details — sea stacks, boats, buoys, whale, birds, reefs
   ═══════════════════════════════════════════════════════════ */

function createWorldDetails() {

  // ══ SEA STACKS & ROCK FORMATIONS ══
  const rockColors = [0x7a7568, 0x8a8070, 0x6a6458, 0x908878];
  const seaStacks = [
    { x: -8, z: 18, h: 2.5, r: 0.5 },    // SW of main
    { x: 25, z: -5, h: 1.8, r: 0.4 },     // E of main
    { x: -30, z: -20, h: 3.2, r: 0.7 },   // toward volcano
    { x: 10, z: 22, h: 1.2, r: 0.3 },     // SE mid-water
    { x: -12, z: -18, h: 1.5, r: 0.35 },  // between main and desert
    { x: 28, z: 20, h: 1.0, r: 0.25 },    // near maldives
    { x: -35, z: 5, h: 2.0, r: 0.45 },    // W open water
    { x: 15, z: -20, h: 1.6, r: 0.38 },   // N of main
  ];
  seaStacks.forEach((s, i) => {
    const col = rockColors[i % rockColors.length];
    // Base rock
    const stack = new THREE.Mesh(
      new THREE.ConeGeometry(s.r, s.h, 5 + Math.floor(Math.random() * 3)),
      mt(col, { roughness: 0.95 }));
    stack.position.set(s.x, s.h * 0.35 - 0.3, s.z);
    stack.castShadow = true;
    scene.add(stack);
    // Smaller companion rocks
    for (let j = 0; j < 2; j++) {
      const cr = s.r * (0.3 + Math.random() * 0.3);
      const ch = s.h * (0.2 + Math.random() * 0.3);
      const ca = Math.random() * Math.PI * 2;
      const cd = s.r + 0.3 + Math.random() * 0.5;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(cr, 0),
        mt(rockColors[(i + j + 1) % rockColors.length], { roughness: 0.95 }));
      rock.position.set(s.x + Math.cos(ca) * cd, cr * 0.3 - 0.2, s.z + Math.sin(ca) * cd);
      rock.scale.y = 0.5 + Math.random() * 0.5;
      scene.add(rock);
    }
  });

  // ══ ROCK ARCH ══
  const archGroup = new THREE.Group();
  archGroup.position.set(-25, -0.3, 8);
  // Two pillars
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.5, 2.5, 5), mt(0x8a8070, { roughness: 0.95 }));
    pillar.position.set(sx * 1.2, 1.0, 0); archGroup.add(pillar);
  }
  // Arch span (stretched torus segment)
  const archSpan = new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.3, 5, 8, Math.PI), mt(0x7a7568, { roughness: 0.95 }));
  archSpan.position.y = 2.2; archSpan.rotation.z = Math.PI; archGroup.add(archSpan);
  scene.add(archGroup);

  // ══ CARGO SHIP ══
  const cargo = new THREE.Group();
  cargo.position.set(-20, -0.12, 30);
  cargo.rotation.y = 0.8;
  // Hull (large, dark)
  const cargoHull = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 3.5), mt(0x8898a8));
  cargoHull.position.y = 0.08; cargo.add(cargoHull);
  // Bow taper
  const cargoBow = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.0, 4), mt(0x8898a8));
  cargoBow.position.set(0, 0.08, 2.2); cargoBow.rotation.x = Math.PI / 2;
  cargoBow.scale.set(1.0, 0.3, 1.0); cargo.add(cargoBow);
  // Deck
  const cargoDeck = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 3.2), mt(0x707880));
  cargoDeck.position.y = 0.24; cargo.add(cargoDeck);
  // Containers (colorful stacks)
  const containerColors = [0xc04040, 0x4060a0, 0x40a060, 0xe0a030, 0x8040a0, 0xd06030];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      for (let stack = 0; stack < (2 - row * 0.5 | 0) + 1; stack++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.15, 0.5),
          mt(containerColors[Math.floor(Math.random() * containerColors.length)]));
        c.position.set(-0.2 + col * 0.4, 0.33 + stack * 0.16, -0.8 + row * 0.55);
        cargo.add(c);
      }
    }
  }
  // Bridge/superstructure at stern
  const cargoBridge = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), mt(0xd0d0d0));
  cargoBridge.position.set(0, 0.55, -1.2); cargo.add(cargoBridge);
  const cargoStack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.4, 5), mt(0xe8d040));
  cargoStack.position.set(0.1, 0.95, -1.2); cargo.add(cargoStack);
  // Wake behind ship
  const wake = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 3.0),
    new THREE.MeshBasicMaterial({ color: 0xc0d8e8, transparent: true, opacity: 0.2, side: THREE.DoubleSide }));
  wake.rotation.x = -Math.PI / 2; wake.position.set(0, -0.05, -3.5); cargo.add(wake);
  scene.add(cargo);
  animatedObjects.push({ type: "bob", mesh: cargo, speed: 0.15, baseY: -0.12, amp: 0.02, phase: 0 });

  // ══ SAILING JUNK with patterned sails ══
  const junk = new THREE.Group();
  junk.position.set(30, -0.1, 25);
  junk.rotation.y = 1.2;
  const jHull = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.8), mt(0x6a4a2a));
  jHull.position.y = 0.03; junk.add(jHull);
  // Mast
  const jMast = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.015, 0.7, 4), mt(0x8a6a4a));
  jMast.position.y = 0.4; junk.add(jMast);
  // Batten sails (distinctive junk rig)
  for (let i = 0; i < 3; i++) {
    const sail = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, 0.18),
      mt(0xc8a070, { side: THREE.DoubleSide }));
    sail.position.set(0.05, 0.25 + i * 0.18, 0.05);
    sail.rotation.y = 0.3;
    junk.add(sail);
  }
  scene.add(junk);
  animatedObjects.push({ type: "bob", mesh: junk, speed: 0.3, baseY: -0.1, amp: 0.015, phase: 2 });

  // ══ SHIPWRECK on a reef ══
  const wreck = new THREE.Group();
  wreck.position.set(18, -0.18, -10);
  wreck.rotation.y = 0.6; wreck.rotation.z = 0.25; // tilted
  // Broken hull
  const wHull = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 1.0), mt(0x5a4a30));
  wHull.position.y = 0.0; wreck.add(wHull);
  // Broken mast (tilted)
  const wMast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.8, 4), mt(0x7a6a4a));
  wMast.position.set(0, 0.3, 0.1); wMast.rotation.z = 0.4; wreck.add(wMast);
  // Tattered sail remnant
  const wSail = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.3),
    mt(0xb0a080, { side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
  wSail.position.set(0.1, 0.45, 0.1); wSail.rotation.y = 0.5; wreck.add(wSail);
  // Reef rocks around wreck
  for (let i = 0; i < 4; i++) {
    const rr = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), mt(0x6a7a5a));
    const ra = i * Math.PI * 2 / 4;
    rr.position.set(Math.cos(ra) * 0.6, -0.12, Math.sin(ra) * 0.5);
    rr.scale.y = 0.4; wreck.add(rr);
  }
  scene.add(wreck);

  // ══ BUOYS & CHANNEL MARKERS ══
  const buoyPositions = [
    { x: 8, z: 14, color: 0xc04040 },    // red
    { x: 9, z: 15, color: 0x40a040 },    // green (pair)
    { x: -5, z: 13, color: 0xc04040 },   // red
    { x: -4, z: 14, color: 0x40a040 },   // green
    { x: 20, z: 5, color: 0xe0e040 },    // yellow warning
    { x: -15, z: -12, color: 0xc04040 }, // red
    { x: 12, z: -8, color: 0xe0e040 },   // yellow
    { x: -8, z: 22, color: 0x40a040 },   // green
  ];
  buoyPositions.forEach((b) => {
    const buoy = new THREE.Group();
    const buoyBody = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 6), mt(b.color));
    buoyBody.position.y = 0.05; buoy.add(buoyBody);
    const buoyTop = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 5), mt(b.color));
    buoyTop.position.y = 0.18; buoy.add(buoyTop);
    buoy.position.set(b.x, -0.15, b.z);
    scene.add(buoy);
    animatedObjects.push({ type: "bob", mesh: buoy, speed: 0.6 + Math.random() * 0.3, baseY: -0.15, amp: 0.03, phase: Math.random() * 6 });
  });

  // ══ WHALE SHADOW ══
  const whale = new THREE.Group();
  // Dark shadow silhouette under water
  const whaleBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 1.5, 4, 8),
    new THREE.MeshBasicMaterial({ color: 0x1a2a3a, transparent: true, opacity: 0.25 }));
  whaleBody.rotation.z = Math.PI / 2; whale.add(whaleBody);
  // Tail flukes
  const whaleTail = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.02, 0.15),
    new THREE.MeshBasicMaterial({ color: 0x1a2a3a, transparent: true, opacity: 0.2 }));
  whaleTail.position.set(-1.1, 0, 0); whale.add(whaleTail);
  whale.position.set(-5, -0.4, 25);
  scene.add(whale);
  animatedObjects.push({
    type: "jetski", mesh: whale,
    cx: -5, cz: 25, radius: 8, speed: 0.04, phase: 1,
  });

  // ══ BIRD FLOCKS (V-formation) ══
  const flockPositions = [
    { cx: 0, cy: 4, cz: 10, count: 7, radius: 5 },
    { cx: -15, cy: 5.5, cz: 0, count: 5, radius: 4 },
    { cx: 20, cy: 3.5, cz: -5, count: 6, radius: 6 },
  ];
  flockPositions.forEach((flock, fi) => {
    const flockGroup = new THREE.Group();
    for (let b = 0; b < flock.count; b++) {
      // V-formation offset
      const side = b % 2 === 0 ? 1 : -1;
      const rank = Math.ceil(b / 2);
      const bird = new THREE.Group();
      // Body
      const bBody = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0x555555));
      bird.add(bBody);
      // Wings (two planes angled up)
      for (const ws of [-1, 1]) {
        const wing = new THREE.Mesh(
          new THREE.PlaneGeometry(0.06, 0.015),
          mt(0x555555, { side: THREE.DoubleSide }));
        wing.position.set(ws * 0.04, 0.005, 0);
        wing.rotation.z = ws * -0.3;
        bird.add(wing);
      }
      bird.position.set(side * rank * 0.25, rank * 0.05, -rank * 0.3);
      flockGroup.add(bird);
    }
    flockGroup.position.set(flock.cx, flock.cy, flock.cz);
    scene.add(flockGroup);
    animatedObjects.push({
      type: "orbit", mesh: flockGroup,
      cx: flock.cx, cz: flock.cz, baseY: flock.cy,
      radius: flock.radius, speed: 0.08 + fi * 0.02, phase: fi * 2,
    });
  });

  // ══ SEAPLANE on water ══
  const seaplane = new THREE.Group();
  // Fuselage
  const spFuse = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 6), mt(0xf0f0f0));
  spFuse.rotation.z = Math.PI / 2; seaplane.add(spFuse);
  // Wings
  const spWing = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.01, 0.08), mt(0xe0e0e0));
  spWing.position.y = 0.04; seaplane.add(spWing);
  // Pontoons
  for (const px of [-0.12, 0.12]) {
    const pontoon = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.25, 3, 4), mt(0xa0a0a0));
    pontoon.rotation.z = Math.PI / 2;
    pontoon.position.set(px, -0.06, 0);
    seaplane.add(pontoon);
  }
  // Tail
  const spTail = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.01), mt(0xe0e0e0));
  spTail.position.set(0, 0.04, -0.25); seaplane.add(spTail);
  const spRudder = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.08, 0.06), mt(0xc04040));
  spRudder.position.set(0, 0.06, -0.28); seaplane.add(spRudder);
  // Propeller
  const spProp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.01, 0.01), mt(0x6a6a6a));
  spProp.position.set(0, 0.03, 0.24); seaplane.add(spProp);
  animatedObjects.push({ type: "spin", mesh: spProp, speed: 15.0, axis: "z" });
  seaplane.position.set(-12, -0.08, 28);
  seaplane.rotation.y = 1.5;
  seaplane.scale.setScalar(1.5);
  scene.add(seaplane);
  animatedObjects.push({ type: "bob", mesh: seaplane, speed: 0.4, baseY: -0.08, amp: 0.015, phase: 3 });

  // ══ AIRSHIP / ZEPPELIN ══
  const zeppelin = new THREE.Group();
  const zBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.5, 2.5, 6, 10), mt(0xc0c8d0));
  zBody.rotation.z = Math.PI / 2; zeppelin.add(zBody);
  // Gondola
  const zGondola = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.5), mt(0x4a4a5a));
  zGondola.position.y = -0.55; zeppelin.add(zGondola);
  // Fins
  for (const [fy, fz] of [[0.4, -1.3], [-0.15, -1.3]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.3, 0.3), mt(0xb0b8c0));
    fin.position.set(0, fy, fz); zeppelin.add(fin);
  }
  const hFin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.3), mt(0xb0b8c0));
  hFin.position.set(0, 0.1, -1.3); zeppelin.add(hFin);
  zeppelin.position.set(25, 8, -20);
  zeppelin.scale.setScalar(1.5);
  scene.add(zeppelin);
  animatedObjects.push({
    type: "orbit", mesh: zeppelin,
    cx: 5, cz: 5, baseY: 8,
    radius: 25, speed: 0.015, phase: 0,
  });

  // ══ KAYAKS near shorelines ══
  const kayakSpots = [
    { x: 12, z: 3, rot: 0.8 },
    { x: -10, z: 8, rot: 2.1 },
    { x: 5, z: 12, rot: 1.5 },
  ];
  kayakSpots.forEach((k) => {
    const kayak = new THREE.Group();
    const kHull = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.02, 0.25, 3, 4), mt(0xe06030));
    kHull.rotation.z = Math.PI / 2; kHull.position.y = 0.01; kayak.add(kHull);
    // Paddler (tiny figure)
    const kPerson = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.06, 4), mt(0x4a6a8a));
    kPerson.position.y = 0.04; kayak.add(kPerson);
    const kHead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), mt(0xe0c0a0));
    kHead.position.y = 0.08; kayak.add(kHead);
    // Paddle
    const kPaddle = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 3), mt(0x8a7050));
    kPaddle.position.set(0, 0.05, 0); kPaddle.rotation.z = 0.8; kayak.add(kPaddle);
    kayak.position.set(k.x, -0.15, k.z);
    kayak.rotation.y = k.rot;
    scene.add(kayak);
    animatedObjects.push({ type: "bob", mesh: kayak, speed: 0.5, baseY: -0.15, amp: 0.01, phase: Math.random() * 6 });
  });

  // ══ FLOATING DOCK with diving board ══
  const fDock = new THREE.Group();
  const dkPlatform = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.8), mt(0xb09060));
  dkPlatform.position.y = 0.0; fDock.add(dkPlatform);
  // Pontoons underneath
  for (const pz of [-0.3, 0.3]) {
    const pontoon = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 6), mt(0x4080c0));
    pontoon.rotation.z = Math.PI / 2; pontoon.position.set(0, -0.08, pz); fDock.add(pontoon);
  }
  // Diving board
  const dBoard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.4), mt(0xd0d8e0));
  dBoard.position.set(0.55, 0.06, 0); fDock.add(dBoard);
  // Ladder
  const dLadder = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.02), mt(0xa0a0a0));
  dLadder.position.set(-0.5, -0.08, 0); fDock.add(dLadder);
  fDock.position.set(14, -0.15, 12);
  scene.add(fDock);
  animatedObjects.push({ type: "bob", mesh: fDock, speed: 0.25, baseY: -0.15, amp: 0.02, phase: 1.5 });

  // ══ SUBMARINE periscope ══
  const subPeriscope = new THREE.Group();
  const subTower = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.15, 5), mt(0x606060));
  subTower.position.y = 0.05; subPeriscope.add(subTower);
  const subScope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), mt(0x6a6a6a));
  subScope.position.y = 0.2; subPeriscope.add(subScope);
  const subLens = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3),
    mt(0x80c0e0, { emissive: 0x4080a0, emissiveIntensity: 0.3 }));
  subLens.position.set(0.015, 0.28, 0); subPeriscope.add(subLens);
  subPeriscope.position.set(-28, -0.2, -10);
  scene.add(subPeriscope);
  animatedObjects.push({
    type: "jetski", mesh: subPeriscope,
    cx: -28, cz: -10, radius: 3, speed: 0.06, phase: 4,
  });

  // ══ SANDBAR with birds ══
  const sandbar = new THREE.Group();
  const sbLand = new THREE.Mesh(
    new THREE.CylinderGeometry(1.0, 1.3, 0.06, 8),
    mt(0xe8d8b0, { roughness: 0.95 }));
  sbLand.scale.set(2.0, 1.0, 1.0);
  sbLand.position.y = -0.1; sandbar.add(sbLand);
  // Wading birds on sandbar
  for (let i = 0; i < 6; i++) {
    const birdG = new THREE.Group();
    const bBody = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0xf0f0f0));
    birdG.add(bBody);
    // Legs
    const bLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.04, 3), mt(0xe0a060));
    bLeg.position.y = -0.03; birdG.add(bLeg);
    // Head
    const bHead = new THREE.Mesh(new THREE.SphereGeometry(0.01, 3, 3), mt(0xf0f0f0));
    bHead.position.set(0, 0.015, 0.015); birdG.add(bHead);
    // Beak
    const bBeak = new THREE.Mesh(new THREE.ConeGeometry(0.003, 0.015, 3), mt(0xe08030));
    bBeak.position.set(0, 0.015, 0.028); bBeak.rotation.x = -Math.PI / 2; birdG.add(bBeak);
    birdG.position.set(
      (Math.random() - 0.5) * 1.5,
      -0.05,
      (Math.random() - 0.5) * 0.6);
    birdG.rotation.y = Math.random() * Math.PI * 2;
    sandbar.add(birdG);
  }
  sandbar.position.set(5, -0.05, 20);
  scene.add(sandbar);

  // ══ ISOLATED LIGHTHOUSE on rock ══
  const isoLight = new THREE.Group();
  const ilRock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.6, 0), mt(0x7a7568, { roughness: 0.95 }));
  ilRock.position.y = 0.1; ilRock.scale.y = 0.5; isoLight.add(ilRock);
  const ilTower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.7, 6), mt(0xf0ece0));
  ilTower.position.y = 0.65; isoLight.add(ilTower);
  // Red band
  const ilBand = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.1, 6), mt(0xc04040));
  ilBand.position.y = 0.45; isoLight.add(ilBand);
  const ilTop = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.1, 6), mt(0x606060));
  ilTop.position.y = 1.05; isoLight.add(ilTop);
  const ilGlow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 4, 4),
    mt(0xffee80, { emissive: 0xffee80, emissiveIntensity: 0.6 }));
  ilGlow.position.y = 0.98; isoLight.add(ilGlow);
  animatedObjects.push({ type: "blink", mesh: ilGlow, speed: 2.0, phase: 5 });
  isoLight.position.set(-18, -0.25, 25);
  scene.add(isoLight);

  // ══ CRAB POT FLOATS ══
  const crabPotZones = [
    { cx: -6, cz: 15, count: 5 },
    { cx: 14, cz: 18, count: 4 },
  ];
  crabPotZones.forEach((zone) => {
    for (let i = 0; i < zone.count; i++) {
      const cpFloat = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 4, 3),
        mt(i % 2 === 0 ? 0xf08030 : 0xf0f030));
      cpFloat.position.set(
        zone.cx + (Math.random() - 0.5) * 2,
        -0.13,
        zone.cz + (Math.random() - 0.5) * 2);
      scene.add(cpFloat);
      animatedObjects.push({ type: "bob", mesh: cpFloat, speed: 0.7, baseY: -0.13, amp: 0.015, phase: Math.random() * 6 });
    }
  });

  // ══ SPEEDBOAT with wake ══
  const speedboat = new THREE.Group();
  const sbHull = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.3), mt(0xf0f0f0));
  sbHull.position.y = 0.01; speedboat.add(sbHull);
  const sbBow = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 4), mt(0xf0f0f0));
  sbBow.position.set(0, 0.01, 0.2); sbBow.rotation.x = Math.PI / 2; sbBow.scale.y = 0.4; speedboat.add(sbBow);
  const sbCockpit = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.08), mt(0x3060a0));
  sbCockpit.position.set(0, 0.04, -0.02); speedboat.add(sbCockpit);
  // Wake spray
  const sbWake = new THREE.Mesh(
    new THREE.PlaneGeometry(0.15, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xd0e8f0, transparent: true, opacity: 0.15, side: THREE.DoubleSide }));
  sbWake.rotation.x = -Math.PI / 2; sbWake.position.set(0, -0.02, -0.5); speedboat.add(sbWake);
  speedboat.position.set(8, -0.1, 20);
  scene.add(speedboat);
  animatedObjects.push({
    type: "jetski", mesh: speedboat,
    cx: 8, cz: 20, radius: 5, speed: 0.25, phase: 2,
  });

  // ══ KELP FORESTS in shallow areas ══
  const kelpSpots = [
    { x: 13, z: 5, count: 8 },
    { x: -11, z: 10, count: 6 },
    { x: 8, z: -12, count: 5 },
  ];
  kelpSpots.forEach((spot) => {
    for (let i = 0; i < spot.count; i++) {
      const kx = spot.x + (Math.random() - 0.5) * 2;
      const kz = spot.z + (Math.random() - 0.5) * 2;
      const kHeight = 0.15 + Math.random() * 0.15;
      const kelp = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, kHeight, 0.04),
        new THREE.MeshBasicMaterial({ color: 0x2a6a3a, transparent: true, opacity: 0.3, side: THREE.DoubleSide }));
      kelp.position.set(kx, -0.22 + kHeight * 0.3, kz);
      scene.add(kelp);
      animatedObjects.push({ type: "sway", mesh: kelp, speed: 0.4 + Math.random() * 0.3, amp: 0.03, phase: Math.random() * 6, baseX: kx });
    }
  });

  // ══ UNDERWATER SANDBARS (visible through water) ══
  const sandbarMat = new THREE.MeshBasicMaterial({
    color: 0xd8cca0, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  const sandbars = [
    { x: 5, z: 18, sx: 3.0, sz: 1.0, rot: 0.3 },
    { x: -15, z: 20, sx: 2.5, sz: 0.8, rot: -0.5 },
    { x: 20, z: 0, sx: 2.0, sz: 1.2, rot: 1.0 },
    { x: -5, z: -15, sx: 1.5, sz: 0.6, rot: 0.7 },
    { x: 25, z: 15, sx: 2.0, sz: 0.7, rot: -0.3 },
  ];
  sandbars.forEach((sb) => {
    const sbMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 8), sandbarMat);
    sbMesh.rotation.x = -Math.PI / 2;
    sbMesh.position.set(sb.x, -0.28, sb.z);
    sbMesh.scale.set(sb.sx, sb.sz, 1);
    sbMesh.rotation.z = sb.rot;
    scene.add(sbMesh);
  });

  // ══ CORAL REEF PATCHES (colored geometry under water) ══
  const reefMat = new THREE.MeshBasicMaterial({
    color: 0x4a8a6a, transparent: true, opacity: 0.2 });
  const reefMat2 = new THREE.MeshBasicMaterial({
    color: 0x8a5a6a, transparent: true, opacity: 0.18 });
  const reefs = [
    { x: 14, z: 8, r: 1.5 },
    { x: -9, z: 14, r: 1.2 },
    { x: 22, z: -8, r: 1.0 },
    { x: -14, z: -14, r: 0.8 },
    { x: 10, z: -10, r: 1.3 },
    { x: 28, z: 30, r: 2.0 },
  ];
  reefs.forEach((rf, i) => {
    const mat = i % 2 === 0 ? reefMat : reefMat2;
    // Irregular reef shape using dodecahedron flattened
    const reef = new THREE.Mesh(new THREE.DodecahedronGeometry(rf.r, 1), mat);
    reef.position.set(rf.x, -0.35, rf.z);
    reef.scale.y = 0.15;
    scene.add(reef);
    // Smaller satellite reef patches
    for (let j = 0; j < 3; j++) {
      const sr = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rf.r * 0.3, 0),
        i % 3 === 0 ? reefMat2 : reefMat);
      const sa = Math.random() * Math.PI * 2;
      sr.position.set(
        rf.x + Math.cos(sa) * (rf.r + 0.5),
        -0.33,
        rf.z + Math.sin(sa) * (rf.r + 0.5));
      sr.scale.y = 0.12;
      scene.add(sr);
    }
  });

  // ══ MOORING BALLS in sheltered bays ══
  const mooringSpots = [
    { x: 10, z: 10 }, { x: 11, z: 11 }, { x: 9, z: 11.5 },
    { x: -8, z: 8 }, { x: -7, z: 9 },
  ];
  mooringSpots.forEach((m) => {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), mt(0xf0f0f0));
    ball.position.set(m.x, -0.12, m.z);
    scene.add(ball);
    animatedObjects.push({ type: "bob", mesh: ball, speed: 0.5, baseY: -0.12, amp: 0.01, phase: Math.random() * 6 });
  });

  // ══ SEA TURTLES near reefs ══
  const turtleSpots = [
    { x: 15, z: 9 }, { x: -8, z: 15 },
  ];
  turtleSpots.forEach((ts, ti) => {
    const turtle = new THREE.Group();
    // Shell
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x70b858, transparent: true, opacity: 0.4 }));
    turtle.add(shell);
    // Body underneath
    const tBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 5, 3),
      new THREE.MeshBasicMaterial({ color: 0x3a6a30, transparent: true, opacity: 0.35 }));
    tBody.position.y = -0.01; tBody.scale.y = 0.3; turtle.add(tBody);
    // Flippers
    for (const [fx, fz] of [[0.05, 0.04], [-0.05, 0.04], [0.04, -0.04], [-0.04, -0.04]]) {
      const flip = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.005, 0.015),
        new THREE.MeshBasicMaterial({ color: 0x3a6a30, transparent: true, opacity: 0.35 }));
      flip.position.set(fx, -0.01, fz); turtle.add(flip);
    }
    turtle.position.set(ts.x, -0.25, ts.z);
    scene.add(turtle);
    animatedObjects.push({
      type: "jetski", mesh: turtle,
      cx: ts.x, cz: ts.z, radius: 1.5, speed: 0.05, phase: ti * 3,
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════ */

function init() {
  clock = new THREE.Clock();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });  // perf: AA off
  renderer.setPixelRatio(1);  // perf: capped at 1x (was 1.5x retina)
  renderer.shadowMap.enabled = false;  // perf: shadows disabled entirely
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.localClippingEnabled = true;
  updateSize();

  scene = new THREE.Scene();

  // ── Sky sphere (warm gradient, replaces flat background) ──
  const skyGeo = new THREE.SphereGeometry(800, 32, 16);
  const _skyUniforms = {
    uTop:     { value: new THREE.Color(0x5a90c8) },
    uMid:     { value: new THREE.Color(0x88b8d8) },   // soft blue
    uHorizon: { value: new THREE.Color(0xd8d0c0) },   // warm muted horizon
    uBottom:  { value: new THREE.Color(0xc8c0b0) },
    uSunDir:  { value: new THREE.Vector3(8, 8, 8).normalize() },
    uSunGlow: { value: 0.0 },
    uSunColor: { value: new THREE.Color(0xffffff) },
    uCloudTime: { value: 0.0 },
  };
  skyUniforms = _skyUniforms;
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: _skyUniforms,
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position,1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon; uniform vec3 uBottom;
      uniform vec3 uSunDir; uniform float uSunGlow; uniform vec3 uSunColor;
      uniform float uCloudTime;
      varying vec3 vWorldPos;

      // Simple hash-based noise for clouds
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        v += noise(p) * 0.5;
        v += noise(p * 2.0 + 0.5) * 0.25;
        v += noise(p * 4.0 + 1.0) * 0.125;
        v += noise(p * 8.0 + 2.0) * 0.0625;
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldPos);
        float h = dir.y;
        vec3 col;
        if (h > 0.25) {
          col = mix(uMid, uTop, smoothstep(0.25, 0.8, h));
        } else if (h > 0.0) {
          col = mix(uHorizon, uMid, smoothstep(0.0, 0.25, h));
        } else {
          col = mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.4));
        }

        // ── Clouds ──
        if (h > 0.0) {
          // Project onto dome for cloud UV — two layers at different heights
          vec2 cloudUV1 = dir.xz / (h + 0.1) * 0.8 + uCloudTime * vec2(0.01, 0.005);
          vec2 cloudUV2 = dir.xz / (h + 0.15) * 0.5 + uCloudTime * vec2(-0.007, 0.003);
          float c1 = fbm(cloudUV1 * 3.0);
          float c2 = fbm(cloudUV2 * 2.5 + 10.0);
          // Shape clouds: threshold + soft edges
          float cloud1 = smoothstep(0.4, 0.65, c1);
          float cloud2 = smoothstep(0.45, 0.7, c2) * 0.6;
          float cloud = min(cloud1 + cloud2, 1.0);
          // Fade out near horizon (clouds thin out) and at zenith
          float horizFade = smoothstep(0.02, 0.15, h);
          float zenithFade = smoothstep(0.85, 0.5, h);
          cloud *= horizFade * zenithFade;
          // Sun-lit edges: clouds facing the sun are brighter
          float sunDotC = max(dot(dir, uSunDir), 0.0);
          vec3 cloudLit = mix(vec3(0.88, 0.88, 0.90), vec3(0.95, 0.93, 0.88), pow(sunDotC, 2.0));
          vec3 cloudShadow = mix(uMid * 0.85, uHorizon * 0.9, 0.5);
          vec3 cloudCol = mix(cloudShadow, cloudLit, 0.6 + c1 * 0.4);
          col = mix(col, cloudCol, cloud * 0.7);
        }

        // ── Sun ──
        float sunDot = max(dot(dir, uSunDir), 0.0);
        float sunBody = pow(sunDot, 48.0) * 1.2 * uSunGlow;
        float sunCore = pow(sunDot, 256.0) * 1.5 * uSunGlow;
        float scatter = pow(sunDot, 4.0) * 0.5 * uSunGlow;
        float horizBand = pow(sunDot, 2.0) * exp(-abs(h) * 6.0) * 0.4 * uSunGlow;
        col += uSunColor * (sunBody + sunCore + scatter + horizBand);
        float lowHz = exp(-abs(h) * 4.0) * uSunGlow * 0.15;
        col = mix(col, uSunColor * 0.6, lowHz);
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Sun glow (emissive sphere — bloom picks it up)
  const sunGlowColor = new THREE.Color(0xfffae0).multiplyScalar(1.0);
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(4, 12, 8),
    new THREE.MeshBasicMaterial({ color: sunGlowColor, fog: false }));
  const sunGlowDir = new THREE.Vector3(8, 8, 8).normalize();
  sunGlow.position.copy(sunGlowDir.clone().multiplyScalar(170));
  scene.add(sunGlow);
  sunGlowRef = sunGlow;

  // Atmospheric fog (warm, light density)
  // scene.fog = new THREE.FogExp2(0xd0c8b4, 0.014);
  updateSceneBg(); // apply theme-correct colors

  camera = new THREE.PerspectiveCamera(28, canvas.clientWidth / canvas.clientHeight, 0.1, 1200);
  camera.position.set(...DEFAULT_CAM.pos);
  camera.lookAt(...DEFAULT_CAM.target);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.05;
  controls.enablePan = true; controls.enableZoom = true;
  controls.panSpeed = 0.8;
  controls.minDistance = 5; controls.maxDistance = 200;
  controls.minPolarAngle = Math.PI / 6;    // ~30° — no going overhead
  controls.maxPolarAngle = Math.PI / 2.15; // ~84° — no going below horizon
  controls.autoRotate = !isReducedMotion; controls.autoRotateSpeed = 0.25;
  controls.target.set(...DEFAULT_CAM.target); controls.update();
  // Clamp pan boundaries — keep camera within archipelago bounds
  controls.addEventListener("change", () => {
    const ct = controls.target;
    const BOUND = 45; // covers all islands (-18 to 19 X, -17 to 14 Z) + margin
    ct.x = Math.max(-BOUND, Math.min(BOUND, ct.x));
    ct.z = Math.max(-BOUND, Math.min(BOUND, ct.z));
    ct.y = Math.max(-0.5, Math.min(4, ct.y));
  });

  // 3-point lighting
  const hemiLight = new THREE.HemisphereLight(0xc8d8f0, 0xa8c088, 0.75);
  scene.add(hemiLight);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
  sun.position.set(8, 8, 8);  // 35° elevation for longer shadows
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
  sun.shadow.radius = 8; sun.shadow.bias = -0.0002;
  sun.shadow.intensity = 0.12;
  scene.add(sun);

  const rimLight = new THREE.DirectionalLight(0xffd8a0, 0.25);
  rimLight.position.set(-8, 10, -10); rimLight.castShadow = false; scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0xe0eaff, 0.3);
  fillLight.position.set(-6, 4, 6); scene.add(fillLight);

  sunLight = sun; hemiLightRef = hemiLight; rimLightRef = rimLight; fillLightRef = fillLight;

  // Build the world
  createTerrain();
  createStream();
  createPaths();
  createWorkingAreas();
  createSocialSpaces();
  createActivityDetails();
  createPlaza();
  createVegetation();
  createTownDetails();
  createPlazaSurroundings();
  createShoreline();
  createAmbientLife();
  createCloudShadows();
  createParticles();
  createInstancedDetail();
  createWildlife();
  createCampfireCluster();
  createBoats();
  createExtraBoatsAndHouses();
  createHilltopStructures();
  createMiscStructures();
  createExtraFeatures();
  createWorldObjects();
  createAdjacentIsland();
  createGreekIsland();
  createDesertIsland();
  createTreasureIsland();
  createHawaiiIsland();
  createJejuIsland();
  createHermitIsland();
  createGlacierIsland();
  buildRailBridgeAndTrain();
  createMontSaintMichel();
  createFlowerIsland();
  createSkyIsland();
  createCinqueTerre();
  createBambooIsland();
  createBoraBora();



  // ══════════════════════════════════════════════
  //   RAILWAY BRIDGE & TRAIN — Main Island to Glacier Island
  // ══════════════════════════════════════════════
  function buildRailBridgeAndTrain() {
    // Endpoints: main island edge toward glacier, glacier island edge toward main
    const GL_X = -65, GL_Z = -55;
    const ang = Math.atan2(GL_Z, GL_X); // angle from main (0,0) to glacier
    const mainEdge = 12; // approximate main island radius in that direction
    const glacierEdge = 10; // approximate glacier radius toward main

    const startX = Math.cos(ang) * mainEdge;
    const startZ = Math.sin(ang) * mainEdge;
    const endX = GL_X + Math.cos(ang + Math.PI) * glacierEdge;
    const endZ = GL_Z + Math.sin(ang + Math.PI) * glacierEdge;

    const dx = endX - startX, dz = endZ - startZ;
    const bridgeLen = Math.sqrt(dx * dx + dz * dz);
    const bridgeAng = Math.atan2(dz, dx);
    const segCount = Math.floor(bridgeLen / 1.5);

    // Store path for train animation
    trainPath = { startX, startZ, endX, endZ, len: bridgeLen, ang: bridgeAng };

    // ── Rail supports (trestle pillars every few segments) ──
    for (let i = 0; i <= segCount; i++) {
      const t = i / segCount;
      const px = startX + dx * t;
      const pz = startZ + dz * t;
      // Arch: rails rise in the middle, low at ends
      const archY = Math.sin(t * Math.PI) * 1.5 + 0.3;

      // Crossties (sleepers)
      if (i < segCount) {
        const tie = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.04, 0.12),
          mt(0x6a5a3a, { roughness: 0.9 }));
        tie.position.set(px, archY, pz);
        tie.rotation.y = bridgeAng + Math.PI / 2;
        scene.add(tie);
      }

      // Trestle pillars every 3 segments (skip very start/end on land)
      if (i % 3 === 0 && t > 0.03 && t < 0.97) {
        const pillarH = archY + 0.5;
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.08, pillarH, 5),
          mt(0x888888, { roughness: 0.8 }));
        pillar.position.set(px, archY / 2 - 0.25, pz);
        scene.add(pillar);
        // Cross brace
        if (pillarH > 0.8) {
          const brace = new THREE.Mesh(
            new THREE.BoxGeometry(0.02, pillarH * 0.6, 0.02),
            mt(0x777777));
          brace.position.set(px, archY / 2 - 0.1, pz);
          brace.rotation.z = 0.3;
          scene.add(brace);
        }
      }
    }

    // ── Rails (two parallel lines) ──
    const railOffsets = [-0.18, 0.18];
    railOffsets.forEach(off => {
      const perpX = Math.cos(bridgeAng + Math.PI / 2) * off;
      const perpZ = Math.sin(bridgeAng + Math.PI / 2) * off;
      for (let i = 0; i < segCount; i++) {
        const t0 = i / segCount, t1 = (i + 1) / segCount;
        const x0 = startX + dx * t0 + perpX, z0 = startZ + dz * t0 + perpZ;
        const x1 = startX + dx * t1 + perpX, z1 = startZ + dz * t1 + perpZ;
        const y0 = Math.sin(t0 * Math.PI) * 1.5 + 0.32;
        const y1 = Math.sin(t1 * Math.PI) * 1.5 + 0.32;
        const segLen = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2);
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(segLen, 0.03, 0.03),
          mt(0x555555, { metalness: 0.4, roughness: 0.6, emissive: 0x333333, emissiveIntensity: 0.1 }));
        rail.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        rail.rotation.y = bridgeAng;
        const rise = y1 - y0;
        rail.rotation.z = Math.atan2(rise, bridgeLen / segCount);
        scene.add(rail);
      }
    });

    // ── Train ──
    trainGroup = new THREE.Group();

    // Locomotive
    const loco = new THREE.Group();
    // Body
    const locoBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.3, 0.35),
      mt(0xcc2222, { roughness: 0.7, emissive: 0x661111, emissiveIntensity: 0.15 }));
    locoBody.position.y = 0.18; loco.add(locoBody);
    // Cabin
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.22, 0.32),
      mt(0xcc2222, { roughness: 0.7, emissive: 0x661111, emissiveIntensity: 0.15 }));
    cabin.position.set(-0.12, 0.4, 0); loco.add(cabin);
    // Cabin roof
    const cabRoof = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.03, 0.36),
      mt(0x333333));
    cabRoof.position.set(-0.12, 0.52, 0); loco.add(cabRoof);
    // Smokestack
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.05, 0.2, 6),
      mt(0x333333));
    stack.position.set(0.15, 0.45, 0); loco.add(stack);
    // Headlight
    const headlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 4, 3),
      mt(0xffee88, { emissive: 0xffdd44, emissiveIntensity: 0.8 }));
    headlight.position.set(0.26, 0.22, 0); loco.add(headlight);
    // Cowcatcher
    const catcher = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.08, 0.3),
      mt(0x555555));
    catcher.position.set(0.28, 0.06, 0); loco.add(catcher);
    // Wheels (3 per side)
    for (const wz of [-0.19, 0.19]) {
      for (const wx of [-0.12, 0.05, 0.18]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8),
          mt(0x333333));
        wheel.position.set(wx, 0.02, wz);
        wheel.rotation.x = Math.PI / 2; loco.add(wheel);
      }
    }
    trainGroup.add(loco);

    // Cargo cars (3 cars behind locomotive)
    const carColors = [0x2266aa, 0x44884a, 0xbb8822];
    for (let c = 0; c < 3; c++) {
      const car = new THREE.Group();
      // Body
      const carBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.22, 0.3),
        mt(carColors[c], { roughness: 0.75, emissive: carColors[c], emissiveIntensity: 0.08 }));
      carBody.position.y = 0.14; car.add(carBody);
      // Roof
      const carRoof = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, 0.02, 0.32),
        mt(0x444444));
      carRoof.position.y = 0.26; car.add(carRoof);
      // Wheels
      for (const wz of [-0.16, 0.16]) {
        for (const wx of [-0.12, 0.12]) {
          const wh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 0.025, 6),
            mt(0x333333));
          wh.position.set(wx, 0.02, wz);
          wh.rotation.x = Math.PI / 2; car.add(wh);
        }
      }
      // Coupling link
      const link = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.015, 0.015), mt(0x555555));
      link.position.set(-0.28, 0.06, 0); car.add(link);
      car.position.x = -(c + 1) * 0.6;
      trainGroup.add(car);
    }

    // Smoke puffs (small spheres attached to loco, animated)
    for (let sp = 0; sp < 4; sp++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.04 + sp * 0.015, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.4 - sp * 0.08 }));
      puff.position.set(0.15 + sp * 0.08, 0.6 + sp * 0.12, 0);
      loco.add(puff);
    }

    scene.add(trainGroup);
  }

  // Register islands as interactive (show island name/info on click)
  const islandDefs = [
    { x: -18, z: -6, name: "Catalina Island", desc: "A forested outpost with a lighthouse, connected by wooden bridge. Home to the Scout and Ranger." },
    { x: 16, z: 9, name: "Aegean Isle", desc: "A Santorini-style village of white-washed houses and blue domes. Home to the Philosopher, Oracle, and Artisan." },
    { x: 5, z: -14, name: "Desert Outpost", desc: "A sun-scorched desert island with rolling dunes, an ancient oasis, weathered ruins, and a campsite among the cacti." },
    { x: -22, z: 18, name: "Hawaiian Isle", desc: "A tropical volcanic island with palm trees, thatched huts, tiki torches, and a smoldering crater. Home to the Kahuna and Navigator." },
    { x: 10, z: -35, name: "Treasure Island", desc: "A legendary island overflowing with gold, silver, diamonds, and precious gems. A golden castle crowns its peak, guarding the royal treasure." },
    { x: 24, z: 26, name: "Maldives Resort", desc: "A pristine tropical resort with turquoise lagoon, white sand beaches, palm trees, and overwater bungalows on stilts." },
    { x: -36, z: 30, name: "Jeju Island", desc: "Korea's volcanic paradise — Hallasan with crater lake, oreum cones, Seongsan Ilchulbong, batdam stone walls, haenyeo divers, black pigs, tangerine groves, and a harbor village." },
    { x: 75, z: -30, name: "Hermit's Isle", desc: "A remote mystical island at the edge of the world. An ancient tree towers over standing stones, glowing crystals, a bioluminescent pool, and a forgotten shrine." },
    { x: 22, z: -18, name: "Mont-Saint-Michel", desc: "A medieval abbey perched atop a rocky tidal island, connected by an ancient stone causeway. The spire of the Archangel Michael gleams above spiraling village streets." },
    { x: -12, z: -22, name: "Cherry Blossom Island", desc: "A pink paradise of cherry blossoms, cascading waterfalls, and Korean stone gardens. Koi ponds, torii gates, and stepping stones wind through meadows of flowers." },
    { x: 40, z: 40, name: "Sky Island", desc: "A floating island hovering above the sea, anchored by ancient chains. Waterfalls cascade from its edges into the ocean below, while ruins of a forgotten civilization dot its grassy surface." },
    { x: -45, z: -20, name: "Cinque Terre", desc: "A dramatic cliffside fishing village of colorful stacked houses. Winding staircases climb the rocky coast, fishing boats bob in the tiny harbor, and laundry flutters between terracotta rooftops." },
    { x: 45, z: -40, name: "Korean Island", desc: "A Damyang-inspired island with a towering bamboo forest, a hanok pavilion, stone pagoda, jangseung totems, and a lotus pond — Korean pine trees frame paths lined with stone lanterns." },
    { x: -65, z: -55, name: "Glacier Island", desc: "A frozen arctic outpost with towering ice mountains, a glacier castle, igloos, penguin colonies, polar bears, and crystalline ice formations." },
  ];
  islandDefs.forEach((isl) => {
    const islHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(2.0, 4, 4),
      new THREE.MeshBasicMaterial({ visible: false }));
    islHitbox.position.set(isl.x, 0.5, isl.z);
    scene.add(islHitbox);
    // Create a dummy group for glow (won't glow the whole island, just provides hover)
    const islGroup = new THREE.Group();
    islGroup.position.set(isl.x, 0, isl.z);
    interactiveObjects.push({
      hitbox: islHitbox, type: "island", label: isl.name,
      group: islGroup, data: { name: isl.name, desc: isl.desc },
    });
  });
  createCentralBonfire();
  createFireflies();
  createPathTorches();
  createFarmZone();
  createStringLights();
  createDolphins();
  createHotAirBalloon();
  createWorldDetails();

  // ── Snow particle system (hidden until dawn mode) ──
  const snowCount = 2000;
  const snowGeo = new THREE.BufferGeometry();
  const snowPositions = new Float32Array(snowCount * 3);
  const snowVelocities = new Float32Array(snowCount);
  for (let i = 0; i < snowCount; i++) {
    snowPositions[i * 3] = (Math.random() - 0.5) * 200;
    snowPositions[i * 3 + 1] = Math.random() * 40;
    snowPositions[i * 3 + 2] = (Math.random() - 0.5) * 200;
    snowVelocities[i] = 0.02 + Math.random() * 0.03;
  }
  snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPositions, 3));
  const snowMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.14, transparent: true, opacity: 0.85,
    depthWrite: false, sizeAttenuation: true
  });
  snowSystem = new THREE.Points(snowGeo, snowMat);
  snowSystem.visible = false;
  snowSystem.userData.velocities = snowVelocities;
  scene.add(snowSystem);

  // ── Santa's Sleigh with Reindeer (hidden until dawn mode) ──
  santaSleigh = new THREE.Group();
  // Sleigh body
  const sleighBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.8), mt(0xaa1111, { roughness: 0.8 }));
  sleighBody.position.y = 0; santaSleigh.add(sleighBody);
  // Sleigh runners
  for (const sx of [-0.18, 0.18]) {
    const runner = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 1.0), mt(0xddaa00, { roughness: 0.4, metalness: 0.5 }));
    runner.position.set(sx, -0.1, 0); santaSleigh.add(runner);
    const curl = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 4, 6, Math.PI / 2), mt(0xddaa00, { roughness: 0.4, metalness: 0.5 }));
    curl.position.set(sx, -0.06, 0.5); curl.rotation.y = Math.PI / 2; santaSleigh.add(curl);
  }
  // Sleigh back (curved seat back)
  const sleighBack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.04), mt(0xaa1111, { roughness: 0.8 }));
  sleighBack.position.set(0, 0.15, -0.38); santaSleigh.add(sleighBack);
  // Santa figure
  const santa = new THREE.Group();
  // Body (red coat)
  const santaBody = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 6), mt(0xcc1111));
  santaBody.position.y = 0.18; santa.add(santaBody);
  // Belt
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 6), mt(0x6a6a6a));
  belt.position.y = 0.12; santa.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.01), mt(0xddaa00));
  buckle.position.set(0, 0.12, 0.065); santa.add(buckle);
  // Head
  const santaHead = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), mt(0xe8c8a0));
  santaHead.position.y = 0.32; santa.add(santaHead);
  // Hat (red cone with white trim)
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 5), mt(0xcc1111));
  hat.position.set(0, 0.39, 0); hat.rotation.z = 0.2; santa.add(hat);
  const hatBrim = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.008, 4, 6), mt(0xf0f0f0));
  hatBrim.rotation.x = -Math.PI / 2; hatBrim.position.y = 0.35; santa.add(hatBrim);
  const hatPom = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), mt(0xf0f0f0));
  hatPom.position.set(0.02, 0.43, 0); santa.add(hatPom);
  // White beard
  const beard = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), mt(0xf0f0f0));
  beard.position.set(0, 0.28, 0.03); beard.scale.set(1, 1.2, 0.7); santa.add(beard);
  // Sack of presents behind
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 4), mt(0x8a5a2a, { roughness: 0.95 }));
  sack.position.set(0, 0.12, -0.2); sack.scale.set(1, 1.2, 0.8); santa.add(sack);
  santa.position.set(0, 0.05, -0.15); santaSleigh.add(santa);

  // Reindeer (4 in pairs connected by reins)
  function makeReindeer(rx, rz) {
    const deer = new THREE.Group();
    const dBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.08, 4, 5), mt(0x7a5a30));
    dBody.rotation.z = Math.PI / 2; dBody.position.y = 0.03; deer.add(dBody);
    const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.015, 5, 4), mt(0x7a5a30));
    dHead.position.set(0, 0.04, 0.06); deer.add(dHead);
    // Antlers
    for (const ax of [-0.01, 0.01]) {
      const antler = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.04, 3), mt(0x5a4020));
      antler.position.set(ax, 0.06, 0.05); antler.rotation.z = ax > 0 ? -0.4 : 0.4; deer.add(antler);
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.02, 3), mt(0x5a4020));
      branch.position.set(ax * 2, 0.075, 0.05); branch.rotation.z = ax > 0 ? -0.8 : 0.8; deer.add(branch);
    }
    // Legs
    for (const lx of [-0.012, 0.012]) {
      for (const lz of [0.02, -0.02]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 3), mt(0x7a5a30));
        leg.position.set(lx, -0.01, lz); deer.add(leg);
      }
    }
    deer.position.set(rx, 0, rz); return deer;
  }
  // Lead reindeer (Rudolph with red nose)
  const rudolph = makeReindeer(0, 0.9);
  const redNose = new THREE.Mesh(new THREE.SphereGeometry(0.006, 4, 3),
    mt(0xff2200, { emissive: 0xff0000, emissiveIntensity: 1.0 }));
  redNose.position.set(0, 0.04, 0.075); rudolph.add(redNose);
  const noseLight = new THREE.PointLight(0xff2200, 0.5, 3);
  noseLight.position.set(0, 0.04, 0.08); rudolph.add(noseLight);
  santaSleigh.add(rudolph);
  // Other reindeer in pairs
  santaSleigh.add(makeReindeer(-0.08, 0.7));
  santaSleigh.add(makeReindeer(0.08, 0.7));
  santaSleigh.add(makeReindeer(-0.08, 0.5));
  santaSleigh.add(makeReindeer(0.08, 0.5));
  // Reins connecting to sleigh
  const reins = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.5, 3), mt(0x8a7a50));
  reins.position.set(0, 0.02, 0.45); reins.rotation.x = Math.PI / 2; santaSleigh.add(reins);

  // Sleigh trail light
  const sleighGlow = new THREE.PointLight(0xffdd44, 0.8, 8);
  sleighGlow.position.set(0, -0.1, -0.3); santaSleigh.add(sleighGlow);

  santaSleigh.visible = false;
  santaSleigh.position.set(30, 15, 0);
  scene.add(santaSleigh);

  // ── Christmas decorations (hidden until dawn mode) ──
  christmasGroup = new THREE.Group();
  christmasGroup.visible = false;

  // Giant Christmas tree at plaza center
  const xTree = new THREE.Group();
  // Trunk
  const xTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.4, 6), mt(0x5a3018, { roughness: 0.9 }));
  xTrunk.position.y = 0.2; xTree.add(xTrunk);
  // Tiered foliage (dark green)
  [{y: 0.7, r: 0.7, h: 0.6}, {y: 1.1, r: 0.55, h: 0.5}, {y: 1.45, r: 0.4, h: 0.45},
   {y: 1.75, r: 0.28, h: 0.35}, {y: 2.0, r: 0.15, h: 0.3}].forEach(tier => {
    const foliage = new THREE.Mesh(new THREE.ConeGeometry(tier.r, tier.h, 8), mt(0x1a4a18, { roughness: 0.85 }));
    foliage.position.y = tier.y; xTree.add(foliage);
  });
  // Star on top
  const xStar = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0),
    mt(0xffdd00, { emissive: 0xffaa00, emissiveIntensity: 1.0 }));
  xStar.position.y = 2.2; xStar.rotation.z = Math.PI / 4; xTree.add(xStar);
  const starLight = new THREE.PointLight(0xffdd00, 1.0, 6);
  starLight.position.y = 2.2; xTree.add(starLight);
  // Ornaments (colorful baubles)
  const ornColors = [0xff2222, 0x2244ff, 0xffaa00, 0xff44aa, 0x22cc44, 0xaa22ff];
  for (let orn = 0; orn < 24; orn++) {
    const oa = orn * Math.PI * 2 / 8;
    const oh = 0.6 + (orn % 5) * 0.3;
    const or2 = 0.55 - (orn % 5) * 0.08;
    const bauble = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4),
      mt(ornColors[orn % ornColors.length], {
        emissive: ornColors[orn % ornColors.length], emissiveIntensity: 0.3,
        roughness: 0.2, metalness: 0.5 }));
    bauble.position.set(Math.cos(oa) * or2, oh, Math.sin(oa) * or2);
    xTree.add(bauble);
  }
  // String lights wrapping the tree
  for (let sl = 0; sl < 30; sl++) {
    const sla = sl * Math.PI * 2 / 10 + sl * 0.2;
    const slh = 0.5 + sl * 0.05;
    const slr = 0.6 - sl * 0.015;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3),
      mt(sl % 2 === 0 ? 0xff4444 : sl % 3 === 0 ? 0x44ff44 : 0xffff44, {
        emissive: sl % 2 === 0 ? 0xff2222 : sl % 3 === 0 ? 0x22dd22 : 0xdddd22,
        emissiveIntensity: 0.8 }));
    bulb.position.set(Math.cos(sla) * slr, slh, Math.sin(sla) * slr);
    xTree.add(bulb);
  }
  // Presents under the tree
  const presentColors = [0xcc1111, 0x1144cc, 0x11aa44, 0xcc8811, 0xaa11aa];
  const ribbonColors = [0xffdd00, 0xffffff, 0xff4444, 0x44ff44, 0xffaa00];
  for (let pr = 0; pr < 8; pr++) {
    const pa = pr * Math.PI / 4;
    const pDist = 0.3 + Math.sin(pr * 2) * 0.1;
    const pSize = 0.06 + Math.sin(pr * 3) * 0.02;
    const present = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(pSize, pSize * 0.8, pSize), mt(presentColors[pr % 5], { roughness: 0.7 }));
    present.add(box);
    const ribbon1 = new THREE.Mesh(new THREE.BoxGeometry(pSize + 0.005, 0.008, pSize + 0.005), mt(ribbonColors[pr % 5]));
    ribbon1.position.y = pSize * 0.1; present.add(ribbon1);
    const bow = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 3), mt(ribbonColors[pr % 5]));
    bow.position.y = pSize * 0.45; present.add(bow);
    present.position.set(Math.cos(pa) * pDist, 0.05, Math.sin(pa) * pDist);
    present.rotation.y = pa * 0.5;
    xTree.add(present);
  }
  xTree.position.set(0, 0.3, 0); // Plaza center
  christmasGroup.add(xTree);

  // Christmas string lights on each district building
  ROLES.forEach((r) => {
    const bx = r.home[0], bz = r.home[2];
    for (let cl = 0; cl < 12; cl++) {
      const cla = cl * Math.PI / 6;
      const clr = 0.5;
      const clBulb = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 3),
        mt(cl % 3 === 0 ? 0xff3333 : cl % 3 === 1 ? 0x33ff33 : 0xffff33, {
          emissive: cl % 3 === 0 ? 0xff1111 : cl % 3 === 1 ? 0x11dd11 : 0xdddd11,
          emissiveIntensity: 0.7 }));
      clBulb.position.set(bx + Math.cos(cla) * clr, 1.0 + Math.sin(cl * 0.8) * 0.1, bz + Math.sin(cla) * clr);
      christmasGroup.add(clBulb);
    }
  });

  // Wreaths on buildings
  ROLES.forEach((r) => {
    const bx = r.home[0], bz = r.home[2];
    const wreath = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12), mt(0x1a5a18, { roughness: 0.9 }));
    wreath.position.set(bx, 0.65, bz + 0.47);
    christmasGroup.add(wreath);
    // Red bow on wreath
    const wBow = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0xcc1111));
    wBow.position.set(bx, 0.57, bz + 0.48);
    christmasGroup.add(wBow);
    // Small berries on wreath
    for (let wb = 0; wb < 4; wb++) {
      const wba = wb * Math.PI / 2;
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.008, 3, 2), mt(0xcc2222));
      berry.position.set(bx + Math.cos(wba) * 0.06, 0.65 + Math.sin(wba) * 0.06, bz + 0.48);
      christmasGroup.add(berry);
    }
  });

  // Candy canes scattered around plaza
  for (let cc = 0; cc < 6; cc++) {
    const cca = cc * Math.PI / 3 + 0.2;
    const ccr = 2.5;
    const cane = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 4), mt(0xffffff));
    stick.position.y = 0.1; cane.add(stick);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 4, 6, Math.PI), mt(0xcc1111));
    hook.position.y = 0.2; hook.rotation.z = Math.PI; cane.add(hook);
    // Red stripes on stick
    for (let str = 0; str < 3; str++) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 4), mt(0xcc1111));
      stripe.position.y = 0.04 + str * 0.06; cane.add(stripe);
    }
    cane.position.set(Math.cos(cca) * ccr, 0.3, Math.sin(cca) * ccr);
    cane.rotation.z = 0.2; cane.rotation.y = cca;
    christmasGroup.add(cane);
  }

  // Snowman near the bonfire area
  const xSnowman = new THREE.Group();
  const sm1 = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), mt(0xf8fcff));
  sm1.position.y = 0.12; xSnowman.add(sm1);
  const sm2 = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), mt(0xf8fcff));
  sm2.position.y = 0.3; xSnowman.add(sm2);
  const sm3 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), mt(0xf8fcff));
  sm3.position.y = 0.44; xSnowman.add(sm3);
  const smCarrot = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.06, 4), mt(0xf08020));
  smCarrot.position.set(0, 0.44, 0.08); smCarrot.rotation.x = Math.PI / 2; xSnowman.add(smCarrot);
  for (const ex of [-0.02, 0.02]) {
    const smEye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 3), mt(0x6a6a6a));
    smEye.position.set(ex, 0.47, 0.06); xSnowman.add(smEye);
  }
  const smScarf = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 4, 8), mt(0xcc1111));
  smScarf.rotation.x = -Math.PI / 2; smScarf.position.y = 0.36; xSnowman.add(smScarf);
  for (const ax of [-0.12, 0.12]) {
    const smArm = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.18, 3), mt(0x5a3018));
    smArm.position.set(ax, 0.3, 0); smArm.rotation.z = ax > 0 ? -0.8 : 0.8; xSnowman.add(smArm);
  }
  const smHat = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 6), mt(0x6a6a6a));
  smHat.position.y = 0.52; xSnowman.add(smHat);
  const smBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 6), mt(0x6a6a6a));
  smBrim.position.y = 0.48; xSnowman.add(smBrim);
  xSnowman.position.set(2, 0.28, 2);
  christmasGroup.add(xSnowman);

  // North Star — big glowing golden star in the sky
  const northStar = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.25, 0),
    mt(0xffee88, { emissive: 0xffcc44, emissiveIntensity: 2.0, transparent: true, opacity: 0.9 })
  );
  northStar.position.set(-8, 18, -12);
  northStar.rotation.set(0.4, 0.3, Math.PI / 4);
  christmasGroup.add(northStar);
  // star self-lit via emissive
  // Star rays (4 thin beams)
  for (let sr = 0; sr < 4; sr++) {
    const ray = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 1.2, 3),
      mt(0xffee88, { emissive: 0xffcc44, emissiveIntensity: 1.5, transparent: true, opacity: 0.5 })
    );
    ray.position.copy(northStar.position);
    ray.rotation.z = sr * Math.PI / 4;
    christmasGroup.add(ray);
  }

  // Christmas lights use emissive materials, no point lights needed

  // Snow piles on island edges (small white mounds)
  const snowPilePositions = [
    [0, 0.35, 3], [0, 0.35, -3], [3, 0.35, 0], [-3, 0.35, 0],
    [-6, 0.35, 8], [-8, 0.35, -6], [8, 0.35, -6], [8, 0.35, 6],
    [-20, 0.35, -8], [18, 0.35, 11]
  ];
  snowPilePositions.forEach(pos => {
    const pile = new THREE.Mesh(
      new THREE.SphereGeometry(0.2 + Math.random() * 0.15, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      mt(0xeef4ff, { roughness: 0.95 })
    );
    pile.position.set(pos[0], pos[1], pos[2]);
    pile.scale.y = 0.4;
    christmasGroup.add(pile);
  });

  // Holly sprigs scattered on ground
  for (let hs = 0; hs < 8; hs++) {
    const ha = hs * Math.PI / 4;
    const hr = 1.5 + Math.random() * 2;
    const holly = new THREE.Group();
    // Two leaves
    for (const lx of [-0.02, 0.02]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.02, 4, 3), mt(0x1a5a18));
      leaf.scale.set(1, 0.3, 2); leaf.position.x = lx; holly.add(leaf);
    }
    // Three red berries
    for (let hb = 0; hb < 3; hb++) {
      const hberry = new THREE.Mesh(new THREE.SphereGeometry(0.008, 4, 3),
        mt(0xcc1111, { emissive: 0x881111, emissiveIntensity: 0.3 }));
      hberry.position.set((hb - 1) * 0.01, 0.01, 0);
      holly.add(hberry);
    }
    holly.position.set(Math.cos(ha) * hr, 0.35, Math.sin(ha) * hr);
    christmasGroup.add(holly);
  }

  // Garland string lights across the plaza (draped between corners)
  const garlandPairs = [
    [[-3, 1.8, -3], [3, 1.8, -3]],
    [[3, 1.8, -3], [3, 1.8, 3]],
    [[3, 1.8, 3], [-3, 1.8, 3]],
    [[-3, 1.8, 3], [-3, 1.8, -3]]
  ];
  const garlandColors = [0xff2222, 0x22cc22, 0xffdd22, 0xff44aa, 0x4488ff];
  garlandPairs.forEach(([p1, p2]) => {
    for (let gl = 0; gl <= 10; gl++) {
      const t = gl / 10;
      const gx = p1[0] + (p2[0] - p1[0]) * t;
      const gz = p1[2] + (p2[2] - p1[2]) * t;
      const sag = -Math.sin(t * Math.PI) * 0.3;
      const gy = p1[1] + sag;
      const gBulb = new THREE.Mesh(new THREE.SphereGeometry(0.018, 4, 3),
        mt(garlandColors[gl % garlandColors.length], {
          emissive: garlandColors[gl % garlandColors.length], emissiveIntensity: 0.9 }));
      gBulb.position.set(gx, gy, gz);
      christmasGroup.add(gBulb);
    }
  });

  // Stockings hanging on each district building
  ROLES.forEach((r) => {
    const bx = r.home[0], bz = r.home[2];
    for (let sk = 0; sk < 2; sk++) {
      const stocking = new THREE.Group();
      const sockBody = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.08, 5),
        mt(sk === 0 ? 0xcc1111 : 0x11aa44));
      stocking.add(sockBody);
      const sockToe = new THREE.Mesh(new THREE.SphereGeometry(0.022, 4, 3),
        mt(sk === 0 ? 0xcc1111 : 0x11aa44));
      sockToe.position.set(0.015, -0.04, 0); stocking.add(sockToe);
      const sockTrim = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.015, 5), mt(0xf0f0f0));
      sockTrim.position.y = 0.04; stocking.add(sockTrim);
      stocking.position.set(bx + (sk - 0.5) * 0.15, 0.75, bz + 0.45);
      christmasGroup.add(stocking);
    }
  });

  scene.add(christmasGroup);



  // Districts
  const districtDescs = [
    "Literature — reading, synthesis, and research narrative",
    "Hypothesis — questions, experiments, and conjectures",
    "Design — prototyping, building, and creative engineering",
    "Analysis — data, logic, and investigative reasoning",
  ];
  const builders = [buildLiteratureDistrict, buildHypothesisDistrict, buildDesignDistrict, buildAnalysisDistrict];
  ROLES.forEach((role, i) => {
    const building = builders[i](role);
    scene.add(building); buildings.push(building);
    // Contact shadow under each district building
    const bldgShadow = makeContactShadow(1.2);
    bldgShadow.position.set(role.home[0], getTerrainHeight(role.home[0], role.home[2]) + 0.008, role.home[2]);
    scene.add(bldgShadow);
    // Register building as interactive
    const bHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 4, 4),
      new THREE.MeshBasicMaterial({ visible: false }));
    bHitbox.position.set(role.home[0], getTerrainHeight(role.home[0], role.home[2]) + 0.5, role.home[2]);
    scene.add(bHitbox);
    interactiveObjects.push({
      hitbox: bHitbox, type: "building", label: "Visit",
      group: building, data: { name: role.name + " District", desc: districtDescs[i] },
    });
    const agent = createAgent(role, i);
    scene.add(agent.group); agents.push(agent);
    // Register building as collision obstacle (scaled 1.25, body ~0.9 wide → effective radius ~1.0)
    obstacles.push({ x: role.home[0], z: role.home[2], r: 1.2 });
  });

  createLitWindows();

  if (isReducedMotion) {
    agents.forEach((a) => { a.state = "idle"; a.idleTimer = 99999; addPaperToTable(a); });
  }

  // ── Interactivity system — click + hover for agents, buildings, objects ──
  agentPopup = document.createElement("div");
  agentPopup.className = "agent-popup";
  container.appendChild(agentPopup);

  // Hover label element
  hoverLabel = document.createElement("div");
  hoverLabel.className = "hover-label";
  container.appendChild(hoverLabel);

  // Return Home button — appears when camera navigates to an island/agent/object
  const returnHomeBtn = document.createElement("button");
  returnHomeBtn.className = "diorama-btn diorama-return-home";
  returnHomeBtn.type = "button";
  returnHomeBtn.title = "Return to default view";
  returnHomeBtn.textContent = "⌂ Return";
  returnHomeBtn.style.display = "none";
  container.querySelector(".diorama-controls")?.appendChild(returnHomeBtn);
  returnHomeBtn.addEventListener("click", () => {
    deselectAll();
    smoothCameraTo(
      new THREE.Vector3(...DEFAULT_CAM.pos),
      new THREE.Vector3(...DEFAULT_CAM.target));
    returnHomeBtn.style.display = "none";
    isOverview = false;
  });

  const stateLabels = {
    idle: "Resting at home",
    "walking-to-plaza": "Heading to symposium",
    exchanging: "Sharing ideas",
    "walking-home": "Returning home",
  };

  const agentDialogues = [
    ["I found a fascinating passage in today's reading...", "The narrative structure is compelling.", "Every hypothesis needs a story."],
    ["What if we reversed the assumption?", "I have a new conjecture to test.", "The question is more interesting than the answer."],
    ["Let me sketch this out...", "The prototype is almost ready.", "Good design is invisible."],
    ["The data tells an interesting story.", "I traced the pattern back three layers.", "Evidence first, then conclusions."],
    ["*sniffs curiously*", "Honey makes everything better!", "*waves cheerfully*"],
    ["*wiggles nose*", "The garden is looking great today!", "*hops excitedly*"],
    ["*purrs thoughtfully*", "I spotted something interesting...", "*stretches lazily*"],
    ["*tail swishes*", "I've been exploring the far trails.", "*adjusts backpack*"],
  ];

  function addGlow(group) {
    group.traverse((child) => {
      if (child.isMesh && child.material && child.material.visible !== false) {
        child.userData._origEmissive = child.material.emissive ? child.material.emissive.getHex() : 0;
        child.userData._origEI = child.material.emissiveIntensity || 0;
        if (child.material.emissive) {
          child.material.emissive.set(0xffffff);
          child.material.emissiveIntensity = 0.25;
        }
      }
    });
  }

  function removeGlow(group) {
    group.traverse((child) => {
      if (child.isMesh && child.userData._origEmissive !== undefined) {
        if (child.material.emissive) {
          child.material.emissive.set(child.userData._origEmissive);
          child.material.emissiveIntensity = child.userData._origEI;
        }
        delete child.userData._origEmissive;
        delete child.userData._origEI;
      }
    });
  }

  function smoothCameraTo(targetPos, lookAt) {
    cameraTarget = {
      pos: targetPos.clone(),
      look: lookAt.clone(),
      progress: 0,
      startPos: camera.position.clone(),
      startLook: controls.target.clone(),
    };
  }

  function selectAgent(agent) {
    if (selectedAgent === agent) { deselectAll(); return; }
    deselectAll();
    selectedAgent = agent;
    addGlow(agent.group);

    // Smooth camera to agent
    const ap = agent.group.position;
    const camOffset = new THREE.Vector3(
      ap.x + 2.5, ap.y + 2.5, ap.z + 2.5);
    smoothCameraTo(camOffset, ap.clone());
    returnHomeBtn.style.display = "";

    // Agent dialogue
    const dialogues = agentDialogues[agent.index % agentDialogues.length];
    const dialogue = dialogues[Math.floor(Math.random() * dialogues.length)];

    const spec = agent.useBridge ? "Catalina Island" : agent.useBridge2 ? "Aegean Isle" : agent.useBridge3 ? "Desert Outpost" : agent.useBridge4 ? "Hawaiian Isle" : agent.config.name;
    const status = stateLabels[agent.state] || agent.state;
    agentPopup.innerHTML =
      `<strong>${agent.config.name}</strong><br>` +
      `<span class="agent-popup__spec">${spec}</span><br>` +
      `<span class="agent-popup__status">${status}</span><br>` +
      `<span class="agent-popup__dialogue">"${dialogue}"</span>`;
    agentPopup.style.display = "block";
    controls.autoRotate = false;
  }

  function selectObject(obj) {
    if (selectedObject === obj) { deselectAll(); return; }

    // Buildings with interiors: enter directly
    if (obj.type === "building" && typeof enterBuilding === "function") {
      const roleIdx = interactiveObjects.filter(o => o.type === "building").indexOf(obj);
      if (roleIdx >= 0 && interiors && interiors[roleIdx]) {
        enterBuilding(roleIdx);
        return;
      }
    }

    deselectAll();
    selectedObject = obj;
    addGlow(obj.group);

    // Smooth camera to object
    const wp = obj.group.position.clone();
    if (wp.lengthSq() < 0.01) {
      wp.copy(obj.hitbox.position);
    }
    const camDist = obj.type === "island" ? 12 : 3;
    const camOffset = new THREE.Vector3(wp.x + camDist, wp.y + camDist * 0.8, wp.z + camDist);
    smoothCameraTo(camOffset, wp);
    returnHomeBtn.style.display = "";

    // Show card
    let cardHTML = `<strong>${obj.data.name}</strong>`;
    if (obj.data.desc) {
      cardHTML += `<br><span class="agent-popup__spec">${obj.data.desc}</span>`;
    }
    agentPopup.innerHTML = cardHTML;
    agentPopup.style.display = "block";
    controls.autoRotate = false;

    // Trigger reaction
    if (obj.reaction) obj.reaction();
  }

  function deselectAll() {
    if (selectedAgent) {
      removeGlow(selectedAgent.group);
      selectedAgent = null;
    }
    if (selectedObject) {
      removeGlow(selectedObject.group);
      selectedObject = null;
    }
    agentPopup.style.display = "none";
    if (!isReducedMotion) controls.autoRotate = true;
  }

  // ── Click handler ──
  canvas.addEventListener("pointerdown", (e) => {
    const startX = e.clientX, startY = e.clientY;
    const onUp = (eu) => {
      canvas.removeEventListener("pointerup", onUp);
      if (Math.abs(eu.clientX - startX) > 4 || Math.abs(eu.clientY - startY) > 4) return;

      // If inside a building, don't process world clicks (interior click handler handles it)
      if (insideBuilding !== null) return;

      const rect = canvas.getBoundingClientRect();
      pointerNDC.x = ((eu.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((eu.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);

      // Check agents first
      const agentHitboxes = agents.map((a) => a.hitbox).filter(Boolean);
      const agentHits = raycaster.intersectObjects(agentHitboxes);
      if (agentHits.length > 0) {
        const hitAgent = agents.find((a) => a.hitbox === agentHits[0].object);
        if (hitAgent) { selectAgent(hitAgent); return; }
      }

      // Check interactive objects
      const objHitboxes = interactiveObjects.map((o) => o.hitbox);
      const objHits = raycaster.intersectObjects(objHitboxes);
      if (objHits.length > 0) {
        const hitObj = interactiveObjects.find((o) => o.hitbox === objHits[0].object);
        if (hitObj) { selectObject(hitObj); return; }
      }

      deselectAll();
    };
    canvas.addEventListener("pointerup", onUp);
  });

  // ── Hover handler — glow + label ──
  canvas.addEventListener("pointermove", (e) => {
    // Skip hover checks while inside a building
    if (insideBuilding !== null) { if (hoveredObj) clearHover(); return; }
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    // Check agents
    const agentHitboxes = agents.map((a) => a.hitbox).filter(Boolean);
    const agentHits = raycaster.intersectObjects(agentHitboxes);
    if (agentHits.length > 0) {
      const hitAgent = agents.find((a) => a.hitbox === agentHits[0].object);
      if (hitAgent && hoveredObj !== hitAgent) {
        clearHover();
        hoveredObj = hitAgent;
        if (hitAgent !== selectedAgent) addGlow(hitAgent.group);
        hoverLabel.textContent = "Talk";
        hoverLabel.style.display = "block";
        container.style.cursor = "pointer";
      }
      // Update label position
      hoverLabel.style.left = (e.clientX - rect.left + 14) + "px";
      hoverLabel.style.top = (e.clientY - rect.top - 8) + "px";
      return;
    }

    // Check interactive objects
    const objHitboxes = interactiveObjects.map((o) => o.hitbox);
    const objHits = raycaster.intersectObjects(objHitboxes);
    if (objHits.length > 0) {
      const hitObj = interactiveObjects.find((o) => o.hitbox === objHits[0].object);
      if (hitObj && hoveredObj !== hitObj) {
        clearHover();
        hoveredObj = hitObj;
        if (hitObj !== selectedObject) addGlow(hitObj.group);
        hoverLabel.textContent = hitObj.label;
        hoverLabel.style.display = "block";
        container.style.cursor = "pointer";
      }
      hoverLabel.style.left = (e.clientX - rect.left + 14) + "px";
      hoverLabel.style.top = (e.clientY - rect.top - 8) + "px";
      return;
    }

    // Nothing hovered
    if (hoveredObj) clearHover();
  });

  function clearHover() {
    if (!hoveredObj) return;
    // Remove hover glow (but don't remove if it's currently selected)
    if (hoveredObj.group && hoveredObj !== selectedAgent && hoveredObj !== selectedObject) {
      removeGlow(hoveredObj.group);
    }
    hoveredObj = null;
    hoverLabel.style.display = "none";
    container.style.cursor = "";
  }

  // ── Enterable building interiors (cutaway doll-house view) ──
  let insideBuilding = null; // index of building we're inside, or null
  let interiorGroup = null; // the furnishing group for the current interior
  let fadedMeshes = []; // meshes whose opacity we've lowered for cutaway

  // Breadcrumb / exit UI
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "breadcrumb-nav";
  breadcrumb.style.display = "none";
  container.appendChild(breadcrumb);

  // Interior furnishing definitions per district
  function createAnalysisInterior(bldg) {
    const interior = new THREE.Group();
    // Position interior at the building's world position
    const wp = new THREE.Vector3();
    bldg.getWorldPosition(wp);
    interior.position.copy(wp);
    interior.rotation.y = bldg.rotation.y;

    // Floor
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.02, 8), mt(0x706858, { roughness: 0.95 }));
    floor.position.y = 0.05; interior.add(floor);

    // Desk with instruments
    const desk = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.12), mt(WOOD_D));
    desk.position.set(0.08, 0.18, 0); interior.add(desk);
    // Desk legs
    for (const [lx, lz] of [[0.09, 0.04], [0.09, -0.04], [-0.03, 0.04], [-0.03, -0.04]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.14, 3), mt(WOOD_D));
      leg.position.set(lx, 0.1, lz); interior.add(leg);
    }

    // Monitors/readouts on desk (faint glow)
    const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.005),
      mt(0x4a5a68, { emissive: 0x2060a0, emissiveIntensity: 0.4 }));
    monitor.position.set(0.1, 0.24, -0.01); interior.add(monitor);
    monitor.userData.interiorClickable = true;
    monitor.userData.contentName = "Data Readout";
    monitor.userData.contentDesc = "Real-time analysis pipeline — signal processing and anomaly detection running on streaming sensor data.";

    const monitor2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.04, 0.005),
      mt(0x4a5a68, { emissive: 0x20a060, emissiveIntensity: 0.3 }));
    monitor2.position.set(0.04, 0.23, -0.01); interior.add(monitor2);

    // Charts on wall (inside cylinder wall position)
    const chart = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.005),
      mt(0xf0e8d0));
    chart.position.set(-0.2, 0.3, 0.08); chart.rotation.y = 2.5; interior.add(chart);
    // Chart lines
    for (let i = 0; i < 3; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.003, 0.002),
        mt([0xc04040, 0x4080c0, 0x40a060][i]));
      line.position.set(-0.2, 0.3 + (i - 1) * 0.015, 0.084);
      line.rotation.y = 2.5; interior.add(line);
    }
    chart.userData.interiorClickable = true;
    chart.userData.contentName = "Analysis Charts";
    chart.userData.contentDesc = "Tracking convergence metrics across experimental runs — loss curves, accuracy bounds, and confidence intervals.";

    // Telescope pointed out window
    const scopeInt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.025, 0.18, 5), mt(0x808080));
    scopeInt.position.set(-0.1, 0.22, -0.15);
    scopeInt.rotation.z = -0.4; scopeInt.rotation.y = 1.0; interior.add(scopeInt);
    scopeInt.userData.interiorClickable = true;
    scopeInt.userData.contentName = "Telescope";
    scopeInt.userData.contentDesc = "Aimed at the far islands — useful for surveying the archipelago from the observatory hill.";

    // Chair
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.06), mt(WOOD));
    chairSeat.position.set(0.08, 0.13, 0.08); interior.add(chairSeat);
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.008), mt(WOOD));
    chairBack.position.set(0.08, 0.17, 0.11); interior.add(chairBack);

    // Small lamp
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.04, 5), mt(METAL));
    lampBase.position.set(0.17, 0.2, 0.03); interior.add(lampBase);
    const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.025, 6),
      mt(0xffe8a0, { emissive: 0xffdd80, emissiveIntensity: 0.6 }));
    lampShade.position.set(0.17, 0.24, 0.03); interior.add(lampShade);

    // Warm interior light
    const intLight = new THREE.PointLight(0xffe0b0, 0.5, 2);
    intLight.position.set(0, 0.35, 0); interior.add(intLight);

    interior.visible = false;
    scene.add(interior);
    return interior;
  }

  // Pre-create interiors (hidden)
  const interiors = [null, null, null, null]; // indexed by ROLES
  interiors[3] = createAnalysisInterior(buildings[3]); // Analysis

  // Content panel for interior objects
  const contentPanel = document.createElement("div");
  contentPanel.className = "content-panel";
  contentPanel.style.display = "none";
  container.appendChild(contentPanel);

  function enterBuilding(buildingIdx) {
    if (insideBuilding !== null) return;
    if (!interiors[buildingIdx]) return; // no interior built yet

    deselectAll();
    insideBuilding = buildingIdx;
    interiorGroup = interiors[buildingIdx];
    interiorGroup.visible = true;

    // Fade roof/dome meshes
    fadedMeshes = [];
    buildings[buildingIdx].traverse((child) => {
      if (child.isMesh && (child.userData.isRoof)) {
        child.material = child.material.clone();
        child.material.transparent = true;
        child.userData._origOpacity = child.material.opacity;
        child.material.opacity = 0.08;
        fadedMeshes.push(child);
      }
    });

    // Camera: fly to interior cutaway view (looking down into building)
    const wp = new THREE.Vector3();
    buildings[buildingIdx].getWorldPosition(wp);
    const interiorCamPos = new THREE.Vector3(wp.x + 1.2, wp.y + 2.5, wp.z + 1.2);
    const interiorLookAt = new THREE.Vector3(wp.x, wp.y + 0.2, wp.z);
    smoothCameraTo(interiorCamPos, interiorLookAt);

    // Show breadcrumb with exit button
    const districtName = ROLES[buildingIdx].name;
    breadcrumb.innerHTML =
      `<span class="bc-link" data-action="exit">&larr; Back to Island</span>` +
      `<span class="bc-sep"> &rsaquo; </span>` +
      `<strong>${districtName}</strong> &rsaquo; Inside` +
      `<button class="bc-exit" data-action="exit">&times;</button>`;
    breadcrumb.style.display = "block";

    controls.autoRotate = false;
  }

  function exitBuilding() {
    if (insideBuilding === null) return;

    // Restore faded meshes
    fadedMeshes.forEach((m) => {
      m.material.opacity = m.userData._origOpacity !== undefined ? m.userData._origOpacity : 1;
      m.material.transparent = m.material.opacity < 1;
    });
    fadedMeshes = [];

    if (interiorGroup) interiorGroup.visible = false;
    interiorGroup = null;

    // Camera: fly back to overview
    const wp = new THREE.Vector3();
    buildings[insideBuilding].getWorldPosition(wp);
    const exitCamPos = new THREE.Vector3(wp.x + 5, wp.y + 6, wp.z + 5);
    smoothCameraTo(exitCamPos, wp);

    insideBuilding = null;
    breadcrumb.style.display = "none";
    contentPanel.style.display = "none";
    if (!isReducedMotion) controls.autoRotate = true;
  }

  // Breadcrumb click handler (both the link and the X button)
  breadcrumb.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action='exit']");
    if (target) exitBuilding();
  });

  // Interior object click handler
  canvas.addEventListener("click", (e) => {
    if (insideBuilding === null) return;
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    // Check interior clickable objects
    const clickables = [];
    interiorGroup.traverse((child) => {
      if (child.isMesh && child.userData.interiorClickable) clickables.push(child);
    });
    const hits = raycaster.intersectObjects(clickables);
    if (hits.length > 0) {
      const hit = hits[0].object;
      contentPanel.innerHTML =
        `<div class="cp-close">&times;</div>` +
        `<strong>${hit.userData.contentName}</strong>` +
        `<p>${hit.userData.contentDesc}</p>`;
      contentPanel.style.display = "block";
      // Position near click
      contentPanel.style.left = (e.clientX - rect.left + 20) + "px";
      contentPanel.style.top = (e.clientY - rect.top - 20) + "px";
    }
  });

  // Content panel close
  contentPanel.addEventListener("click", (e) => {
    if (e.target.classList.contains("cp-close")) contentPanel.style.display = "none";
  });

  // Post-processing pipeline: render → SSAO → bloom → color grade → tilt-shift → vignette
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // [perf] SSAO removed — too expensive for smooth framerate

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth >> 1, canvas.clientHeight >> 1), 0.35, 0.4, 0.90);
  composer.addPass(bloomPass);
  bloomPassRef = bloomPass;
  const colorGradePass = new ShaderPass(ColorGradeShader);
  composer.addPass(colorGradePass);
  colorGradeRef = colorGradePass;
  // [perf] tilt-shift removed
  const vignettePass = new ShaderPass(VignetteShader);
  composer.addPass(vignettePass);

  if (loading) loading.style.display = "none";

  animate();
}

/* ── Theme ─────────────────────────────────────────────── */
function updateSceneBg() {
  if (!scene || isSunsetMode) return;
  const isDark = document.documentElement.dataset.theme === "dark";
  const dur = 1.2;
  // Sky sphere gradient
  if (skyUniforms) {
    const top = new THREE.Color(isDark ? 0x2d4268 : 0x5a90c8);
    const mid = new THREE.Color(isDark ? 0x3d5078 : 0x88b8d8);
    const horiz = new THREE.Color(isDark ? 0x486080 : 0xd8d0c0);
    const bottom = new THREE.Color(isDark ? 0x3d5070 : 0xc8c0b0);
    gsap.to(skyUniforms.uTop.value, { r: top.r, g: top.g, b: top.b, duration: dur });
    gsap.to(skyUniforms.uMid.value, { r: mid.r, g: mid.g, b: mid.b, duration: dur });
    gsap.to(skyUniforms.uHorizon.value, { r: horiz.r, g: horiz.g, b: horiz.b, duration: dur });
    gsap.to(skyUniforms.uBottom.value, { r: bottom.r, g: bottom.g, b: bottom.b, duration: dur });
    gsap.to(skyUniforms.uSunGlow, { value: isDark ? 0.15 : 0.2, duration: dur });
  }
  // Fog color matches horizon
  if (scene.fog) {
    const fogC = new THREE.Color(isDark ? 0x283848 : 0xd0c8b4);
    gsap.to(scene.fog.color, { r: fogC.r, g: fogC.g, b: fogC.b, duration: dur });
  }
  // Ocean — darker at night
  if (oceanUniforms) {
    const oc = new THREE.Color(isDark ? 0x3a5878 : 0x78c8e0);
    const ocd = new THREE.Color(isDark ? 0x304868 : 0x58a8c8);
    gsap.to(oceanUniforms.uColor.value, { r: oc.r, g: oc.g, b: oc.b, duration: dur });
    gsap.to(oceanUniforms.uColorDeep.value, { r: ocd.r, g: ocd.g, b: ocd.b, duration: dur });
  }
  // Lights — night = blue-tinted moonlight at near-full brightness
  // Toon materials snap to black at low light, so keep intensity HIGH
  if (sunLight) {
    const col = new THREE.Color(isDark ? 0xd0d8e8 : 0xfff4e0);
    gsap.to(sunLight.color, { r: col.r, g: col.g, b: col.b, duration: dur });
    gsap.to(sunLight, { intensity: isDark ? 1.2 : 1.15, duration: dur });
    gsap.to(sunLight.position, { x: isDark ? -6 : 8, y: isDark ? 10 : 8, z: isDark ? -4 : 8, duration: dur });
  }
  if (hemiLightRef) {
    const hSky = new THREE.Color(isDark ? 0x6088c0 : 0xd8e8ff);
    const hGnd = new THREE.Color(isDark ? 0x405878 : 0xa8c088);
    gsap.to(hemiLightRef.color, { r: hSky.r, g: hSky.g, b: hSky.b, duration: dur });
    gsap.to(hemiLightRef.groundColor, { r: hGnd.r, g: hGnd.g, b: hGnd.b, duration: dur });
    gsap.to(hemiLightRef, { intensity: isDark ? 0.7 : 0.7, duration: dur });
  }
  if (rimLightRef) {
    const rimC = new THREE.Color(isDark ? 0xc0c8d8 : 0xffd8a0);
    gsap.to(rimLightRef.color, { r: rimC.r, g: rimC.g, b: rimC.b, duration: dur });
    gsap.to(rimLightRef, { intensity: isDark ? 0.6 : 0.25, duration: dur });
  }
  if (fillLightRef) {
    const fillC = new THREE.Color(isDark ? 0xb0b8c8 : 0xe0eaff);
    gsap.to(fillLightRef.color, { r: fillC.r, g: fillC.g, b: fillC.b, duration: dur });
    gsap.to(fillLightRef, { intensity: isDark ? 0.5 : 0.3, duration: dur });
  }
  // Bloom — subtle glow at night for emissive elements
  if (bloomPassRef) {
    gsap.to(bloomPassRef, { strength: isDark ? 0.5 : 0.35, threshold: isDark ? 0.6 : 0.90, duration: dur });
  }
}
const themeObs = new MutationObserver(() => updateSceneBg());
themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

/* ── Resize ────────────────────────────────────────────── */
function updateSize() {
  if (!renderer || !container) return;
  const w = container.clientWidth, h = container.clientHeight;
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  if (oceanUniforms && oceanUniforms.uResolution) oceanUniforms.uResolution.value.set(w, h);
  if (reflectionRT) reflectionRT.setSize(Math.min(w >> 1, 512), Math.min(h >> 1, 512));
}
window.addEventListener("resize", updateSize);

/* ── Fireworks (night mode only) ───────────────────────── */
const FW_COLORS = [0xff4060, 0x40c0ff, 0xffdd40, 0x60ff80, 0xff80e0, 0xffa040, 0x80a0ff];
let fwLastSpawn = 0;

function spawnFirework() {
  if (!scene) return;
  const now = performance.now() / 1000;
  if (now - fwLastSpawn < 0.8) return; // min gap between launches
  fwLastSpawn = now;

  const fx = (Math.random() - 0.5) * 16;
  const fz = (Math.random() - 0.5) * 16;
  const burstY = 6 + Math.random() * 4;
  const color = new THREE.Color(FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)]);

  // Rising trail — bright glowing line
  const trailGroup = new THREE.Group();
  trailGroup.position.set(fx, 0, fz);
  const trailHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffeedd }));
  trailGroup.add(trailHead);
  // Tail streak
  const tailGeo = new THREE.CylinderGeometry(0.03, 0.01, 1.0, 4);
  const tail = new THREE.Mesh(tailGeo,
    new THREE.MeshBasicMaterial({ color: 0xffcc88, transparent: true, opacity: 0.6 }));
  tail.position.y = -0.5;
  trailGroup.add(tail);
  scene.add(trailGroup);

  fireworks.push({
    phase: "rise",
    trailGroup,
    x: fx, z: fz, burstY,
    riseStart: now,
    riseDur: 0.5 + Math.random() * 0.3,
    color,
    sparks: [],
    light: null,
    burstTime: 0,
  });
}

function burstFirework(fw) {
  const now = performance.now() / 1000;
  // Remove trail
  scene.remove(fw.trailGroup);
  fw.trailGroup.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  fw.trailGroup = null;

  // Burst flash light
  fw.light = new THREE.PointLight(fw.color, 5, 25);
  fw.light.position.set(fw.x, fw.burstY, fw.z);
  scene.add(fw.light);

  // Spark streaks — elongated shapes that trail outward
  const count = 30 + Math.floor(Math.random() * 25);
  const hasRing = Math.random() > 0.5; // some bursts have a ring pattern

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = hasRing
      ? (Math.PI * 0.4 + Math.random() * 0.2) // ring pattern — sparks mostly at equator
      : Math.acos(2 * Math.random() - 1);      // sphere pattern
    const speed = 2.0 + Math.random() * 3.0;

    const vx = Math.sin(phi) * Math.cos(theta) * speed;
    const vy = Math.sin(phi) * Math.sin(theta) * speed;
    const vz = Math.cos(phi) * speed;

    // Each spark is a stretched capsule/cylinder for streak look
    const sparkGeo = new THREE.CylinderGeometry(0.03, 0.015, 0.25, 4);
    const sparkColor = i % 3 === 0
      ? new THREE.Color(0xffffff).lerp(fw.color, 0.5) // white-hot core on some
      : fw.color.clone();
    const sparkMat = new THREE.MeshBasicMaterial({
      color: sparkColor, transparent: true, opacity: 1,
    });
    const spark = new THREE.Mesh(sparkGeo, sparkMat);
    spark.position.set(fw.x, fw.burstY, fw.z);
    spark.userData.vel = new THREE.Vector3(vx, vy, vz);
    scene.add(spark);
    fw.sparks.push(spark);
  }

  // Central flash — bright sphere that fades fast
  const flashGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const flash = new THREE.Mesh(flashGeo,
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
  flash.position.set(fw.x, fw.burstY, fw.z);
  scene.add(flash);
  fw.flash = flash;

  fw.phase = "burst";
  fw.burstTime = now;
}

function updateFireworks() {
  const now = performance.now() / 1000;
  for (let i = fireworks.length - 1; i >= 0; i--) {
    const fw = fireworks[i];

    if (fw.phase === "rise") {
      const p = (now - fw.riseStart) / fw.riseDur;
      if (p >= 1) {
        burstFirework(fw);
      } else {
        const ease = 1 - (1 - p) * (1 - p); // ease-out
        fw.trailGroup.position.y = ease * fw.burstY;
      }
    } else if (fw.phase === "burst") {
      const age = now - fw.burstTime;
      const maxAge = 2.2;

      if (age > maxAge) {
        // Cleanup all sparks
        fw.sparks.forEach(s => { scene.remove(s); s.geometry.dispose(); s.material.dispose(); });
        if (fw.flash) { scene.remove(fw.flash); fw.flash.geometry.dispose(); fw.flash.material.dispose(); }
        if (fw.light) { scene.remove(fw.light); fw.light.dispose(); }
        fireworks.splice(i, 1);
        continue;
      }

      const fade = Math.max(0, 1 - age / maxAge);
      const dt = 0.016;

      // Update sparks — move, apply gravity, orient along velocity, fade
      fw.sparks.forEach(s => {
        const v = s.userData.vel;
        s.position.x += v.x * dt;
        s.position.y += v.y * dt;
        s.position.z += v.z * dt;
        v.y -= 1.8 * dt; // gravity (gentle arc)
        v.multiplyScalar(0.985); // air drag

        // Orient streak along velocity direction
        const dir = v.clone().normalize();
        s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

        // Fade + shrink
        s.material.opacity = fade * fade;
        const shrink = 0.5 + fade * 0.5;
        s.scale.set(shrink, 1 + (1 - fade) * 0.5, shrink);
      });

      // Flash fades fast
      if (fw.flash) {
        const flashFade = Math.max(0, 1 - age / 0.3);
        fw.flash.material.opacity = flashFade * 0.8;
        fw.flash.scale.setScalar(1 + age * 3);
        if (flashFade <= 0) {
          scene.remove(fw.flash); fw.flash.geometry.dispose(); fw.flash.material.dispose();
          fw.flash = null;
        }
      }

      // Light fades
      if (fw.light) fw.light.intensity = 5 * fade * fade;
    }
  }
}

/* ── Render loop ───────────────────────────────────────── */
function animate() {
  requestAnimationFrame(animate);
  if (!isVisible) return;
  const t = clock.getElapsedTime();
  controls.update();

  // Drive ocean shader
  if (oceanUniforms) oceanUniforms.uTime.value = t;
  if (skyUniforms && skyUniforms.uTime) skyUniforms.uTime.value = t;
  if (skyUniforms && skyUniforms.uCloudTime) skyUniforms.uCloudTime.value = t;
  // Drive wind system
  windUniforms.uWindTime.value = t;
  windUniforms.uGustPhase.value = t * 0.3; // gust wave traverses ~every 20s
  // Drive cloud shadows
  cloudShadowUniforms.uTime.value = t;

  // Smooth camera animation
  if (cameraTarget) {
    cameraTarget.progress += 0.025;
    const p = Math.min(1, cameraTarget.progress);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
    camera.position.lerpVectors(cameraTarget.startPos, cameraTarget.pos, ease);
    controls.target.lerpVectors(cameraTarget.startLook, cameraTarget.look, ease);
    if (p >= 1) cameraTarget = null;
  }

  // Update popup position (agents or objects)
  if (agentPopup && agentPopup.style.display === "block") {
    let wp;
    if (selectedAgent) {
      wp = selectedAgent.group.position.clone();
      wp.y += selectedAgent.topY + 0.25;
      // Update status text live
      const stateTxt = { idle: "Resting at home", "walking-to-plaza": "Heading to symposium",
        exchanging: "Sharing ideas", "walking-home": "Returning home" };
      const statusEl = agentPopup.querySelector(".agent-popup__status");
      if (statusEl) statusEl.textContent = stateTxt[selectedAgent.state] || selectedAgent.state;
    } else if (selectedObject) {
      wp = selectedObject.hitbox.position.clone();
      wp.y += 0.5;
    }
    if (wp) {
      wp.project(camera);
      const px = (wp.x * 0.5 + 0.5) * canvas.clientWidth;
      const py = (-wp.y * 0.5 + 0.5) * canvas.clientHeight;
      agentPopup.style.left = px + "px";
      agentPopup.style.top = (py - 60) + "px";
    }
  }

  if (!isReducedMotion) {
    agents.forEach(updateAgent);

    animatedObjects.forEach((obj) => {
      switch (obj.type) {
        case "spin":
          obj.mesh.rotation[obj.axis || "y"] += obj.speed * 0.016;
          break;
        case "sway":
          if (obj.baseX !== undefined) {
            obj.mesh.position.x = obj.baseX + Math.sin(t * obj.speed + obj.phase) * obj.amp;
          }
          break;
        case "smoke": {
          const base = obj.mesh.userData.smokeBase;
          const drift = t * 0.3 + base.i * 0.5;
          obj.mesh.position.set(
            base.x + Math.sin(drift) * 0.03,
            base.y + Math.sin(t * 0.5 + base.i) * 0.02 + 0.01,
            base.z + Math.cos(drift * 0.7) * 0.02);
          break;
        }
        case "blink": {
          const v = (Math.sin(t * obj.speed + obj.phase) + 1) * 0.5;
          obj.mesh.material.emissiveIntensity = 0.2 + v * 0.6;
          break;
        }
        case "orbit": {
          const oa = t * obj.speed + obj.phase;
          obj.mesh.position.x = obj.cx + Math.cos(oa) * obj.radius;
          obj.mesh.position.z = obj.cz + Math.sin(oa) * obj.radius;
          obj.mesh.position.y = obj.baseY + Math.sin(oa * 2.5) * 0.04;
          obj.mesh.rotation.y = oa + Math.PI / 2;
          break;
        }
        case "bob": {
          obj.mesh.position.y = obj.baseY + Math.sin(t * obj.speed + obj.phase) * obj.amp;
          obj.mesh.rotation.z = Math.sin(t * obj.speed * 0.7 + obj.phase) * 0.03;
          break;
        }
        case "foam": {
          obj.mat.opacity = 0.15 + Math.sin(t * 0.8) * 0.1;
          obj.mesh.position.y = -0.15 + Math.sin(t * 0.5) * 0.02;
          break;
        }
        case "flicker": {
          const fl = 0.8 + Math.sin(t * 12 + obj.phase) * 0.15 + Math.sin(t * 17.3) * 0.05;
          obj.mesh.scale.y = obj.baseScaleY * fl;
          obj.mesh.scale.x = obj.baseScaleX * (0.9 + Math.sin(t * 9 + obj.phase + 1) * 0.1);
          obj.mesh.scale.z = obj.mesh.scale.x;
          if (obj.mesh.material.emissiveIntensity !== undefined) {
            obj.mesh.material.emissiveIntensity = 0.6 + Math.sin(t * 14) * 0.4;
          }
          break;
        }
        case "lightFlicker": {
          const li = 0.5 + Math.sin(t * 10 + (obj.phase || 0)) * 0.2 + Math.sin(t * 15.7) * 0.1 + Math.random() * 0.05;
          (obj.light || obj.mesh).intensity = obj.baseIntensity * li;
          break;
        }
        case "butterfly": {
          const bt = t * obj.speed + obj.phase;
          obj.mesh.position.x = obj.baseX + Math.sin(bt) * obj.radius;
          obj.mesh.position.z = obj.baseZ + Math.cos(bt * 0.7 + 1) * obj.radius;
          obj.mesh.position.y = obj.baseY + Math.sin(bt * 1.5) * 0.08;
          obj.mesh.rotation.y = bt * 3;
          obj.mesh.rotation.z = Math.sin(bt * 6) * 0.3;
          break;
        }
        case "firefly": {
          const ft = t * obj.speed + obj.phase;
          obj.mesh.position.x = obj.baseX + Math.sin(ft) * obj.radius;
          obj.mesh.position.z = obj.baseZ + Math.cos(ft * 0.8 + 1.5) * obj.radius;
          obj.mesh.position.y = obj.baseY + Math.sin(ft * 0.6) * 0.1;
          // Blink on/off
          const blink = Math.sin(ft * 3) * 0.5 + 0.5;
          obj.mesh.material.opacity = blink * 0.8;
          obj.mesh.scale.setScalar(0.5 + blink * 0.5);
          break;
        }
        case "airplane": {
          const at = t * obj.speed + obj.phase;
          obj.mesh.position.x = Math.cos(at) * obj.radius;
          obj.mesh.position.z = Math.sin(at) * obj.radius;
          obj.mesh.position.y = obj.baseY + Math.sin(at * 0.7) * 1.5;
          obj.mesh.rotation.y = -at + Math.PI / 2;
          obj.mesh.rotation.z = Math.cos(at) * 0.08;
          break;
        }
        case "submarine": {
          const st = t * obj.speed + obj.phase;
          obj.mesh.position.x = obj.cx + Math.cos(st) * obj.radius;
          obj.mesh.position.z = obj.cz + Math.sin(st) * obj.radius;
          // Periodic surfacing: mostly submerged, briefly rises
          const surfaceCycle = Math.sin(st * 0.8);
          const surfaceY = surfaceCycle > 0.7 ? (surfaceCycle - 0.7) * 2.5 : 0;
          obj.mesh.position.y = obj.baseY + surfaceY;
          obj.mesh.rotation.y = -st + Math.PI / 2;
          // Slight pitch when diving/surfacing
          obj.mesh.rotation.z = surfaceCycle > 0.5 ? (surfaceCycle - 0.7) * 0.3 : 0;
          break;
        }
        case "dolphin": {
          // Arc out of water periodically, then submerge
          const dt = t * obj.speed + obj.phase;
          const cycle = (dt % (Math.PI * 2)) / (Math.PI * 2); // 0→1
          // Jump arc: visible for ~30% of cycle, submerged rest
          const jumpPhase = Math.max(0, Math.sin(cycle * Math.PI * 2) * 1.2 - 0.2);
          const arcY = jumpPhase * 0.8; // max height above water
          obj.mesh.position.x = obj.cx + Math.sin(dt * 0.3) * 1.5;
          obj.mesh.position.z = obj.cz + Math.cos(dt * 0.3) * 1.5;
          obj.mesh.position.y = -0.25 + arcY;
          // Nose-down on descent, nose-up on ascent
          const slope = Math.cos(cycle * Math.PI * 2) * 1.2;
          obj.mesh.rotation.z = slope * 0.4;
          obj.mesh.rotation.y = dt * 0.3 + Math.PI / 2;
          // Hide when fully submerged
          obj.mesh.visible = jumpPhase > 0.01;
          break;
        }
        case "balloon": {
          const bt = t * obj.speed + obj.phase;
          obj.mesh.position.x = obj.cx + Math.cos(bt) * obj.radius;
          obj.mesh.position.z = obj.cz + Math.sin(bt * 0.7) * obj.radius;
          obj.mesh.position.y = obj.baseY + Math.sin(bt * 0.4) * 1.5;
          // Gentle sway
          obj.mesh.rotation.y = bt * 0.1;
          obj.mesh.rotation.z = Math.sin(bt * 0.5) * 0.03;
          break;
        }
        case "sandDrift": {
          const sd = obj.mesh.userData.sandDrift;
          const st = t * sd.speed + sd.phase;
          obj.mesh.position.x = sd.baseX + Math.sin(st) * sd.range;
          obj.mesh.position.z = sd.baseZ + Math.cos(st * 0.7) * sd.range * 0.3;
          obj.mesh.position.y = sd.baseY + Math.sin(st * 2) * 0.02;
          obj.mesh.material.opacity = 0.15 + Math.sin(st * 1.5) * 0.15;
          break;
        }
        case "tumbleweed": {
          const tw = obj.mesh.userData.tumbleweed;
          const tt = t * tw.speed + tw.phase;
          obj.mesh.position.x = tw.baseX + Math.sin(tt) * tw.range;
          obj.mesh.position.z = tw.baseZ + Math.cos(tt * 0.6 + 0.5) * tw.range * 0.5;
          obj.mesh.position.y = 0.05 + Math.abs(Math.sin(tt * 3)) * 0.03;
          obj.mesh.rotation.x = tt * 2;
          obj.mesh.rotation.z = tt * 1.5;
          break;
        }
        case "jetski": {
          const jt = t * obj.speed + obj.phase;
          obj.mesh.position.x = obj.cx + Math.cos(jt) * obj.radius;
          obj.mesh.position.z = obj.cz + Math.sin(jt) * obj.radius;
          obj.mesh.position.y = -0.08 + Math.sin(jt * 4) * 0.02;
          // Face movement direction
          obj.mesh.rotation.y = -jt + Math.PI / 2;
          // Lean into turns
          obj.mesh.rotation.z = Math.cos(jt) * 0.15;
          break;
        }
      }
    });

    particles.forEach((p) => {
      const b = p.userData.base;
      p.position.x = b.x + Math.sin(t * p.userData.speed + p.userData.phase) * p.userData.radius;
      p.position.y = b.y + Math.sin(t * p.userData.speed * 0.7 + p.userData.phase + 1) * 0.06;
      p.position.z = b.z + Math.cos(t * p.userData.speed * 0.8 + p.userData.phase) * p.userData.radius;
      p.material.opacity = 0.3 + Math.sin(t * 2 + p.userData.phase) * 0.3;
    });
  } else {
    agents.forEach((a) => { a.group.position.y = Math.sin(t * 0.4 + a.index) * 0.012; });
  }

  tablePapers.forEach((p) => {
    if (p.userData.scaleT !== undefined && p.userData.scaleT < 1) {
      p.userData.scaleT += 0.08;
      const s = Math.min(1, p.userData.scaleT);
      p.scale.setScalar(1 - Math.pow(1 - s, 3));
      if (s >= 1) delete p.userData.scaleT;
    }
  });

  towerBlocks.forEach((b) => {
    if (b.userData.scaleT !== undefined && b.userData.scaleT < 1) {
      b.userData.scaleT += 0.06;
      const s = Math.min(1, b.userData.scaleT);
      const ease = 1 - Math.pow(1 - s, 3);
      b.scale.setScalar(ease);
      b.position.y = b.userData.targetY * ease;
      if (s >= 1) delete b.userData.scaleT;
    }
  });

  // Update HTML bubble positions (projected from 3D → screen)
  updateHtmlBubblePositions();

  // ── Night-mode fireworks ──
  const fwDark = document.documentElement.dataset.theme === "dark";
  if (fwDark && Math.random() < 0.015) spawnFirework();
  updateFireworks();

  // ── Reflection pass — every 3rd frame to save GPU ──
  if (reflectionRT && reflectionCamera && oceanMesh && _reflFrame++ % 5 === 0 && camera.position.y < 20) {
    const waterY = oceanMesh.position.y;
    reflectionCamera.aspect = camera.aspect;
    reflectionCamera.fov = camera.fov;
    reflectionCamera.near = camera.near;
    reflectionCamera.far = camera.far;
    reflectionCamera.updateProjectionMatrix();
    reflectionCamera.position.copy(camera.position);
    reflectionCamera.position.y = 2 * waterY - camera.position.y;
    _reflLook.copy(controls.target);
    _reflLook.y = 2 * waterY - _reflLook.y;
    reflectionCamera.up.set(0, 1, 0);
    reflectionCamera.lookAt(_reflLook);

    _reflClip.constant = -waterY;
    renderer.clippingPlanes = _reflClipArr;

    oceanMesh.visible = false;
    renderer.setRenderTarget(reflectionRT);
    renderer.clear();
    renderer.render(scene, reflectionCamera);
    renderer.setRenderTarget(null);
    renderer.clippingPlanes = _emptyClip;
    oceanMesh.visible = true;
  }


  // ── Train animation: shuttle back and forth on the bridge ──
  if (trainGroup && trainPath) {
    const tp = trainPath;
    const period = 40; // seconds for a full round trip
    const phase = (t % period) / period; // 0..1
    // Shuttle: 0->0.5 go forward, 0.5->1 go back
    const progress = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    const tx = tp.startX + (tp.endX - tp.startX) * progress;
    const tz = tp.startZ + (tp.endZ - tp.startZ) * progress;
    const ty = Math.sin(progress * Math.PI) * 1.5 + 0.38;
    trainGroup.position.set(tx, ty, tz);
    // Face direction of travel
    const fwd = phase < 0.5 ? tp.ang : tp.ang + Math.PI;
    trainGroup.rotation.y = -fwd;
    // Tilt to match bridge slope
    const slopeT = Math.cos(progress * Math.PI) * 1.5 * Math.PI / tp.len;
    trainGroup.rotation.z = phase < 0.5 ? slopeT : -slopeT;
  }

  // ── Dawn mode: snow falling + Santa orbiting ──
  if (isDawnMode) {
    if (snowSystem && snowSystem.visible) {
      const sPos = snowSystem.geometry.attributes.position;
      const sVel = snowSystem.userData.velocities;
      for (let i = 0; i < sPos.count; i++) {
        let y = sPos.getY(i) - sVel[i];
        let x = sPos.getX(i) + Math.sin(t * 0.5 + i * 0.1) * 0.003;
        if (y < -1) { y = 35 + Math.random() * 5; x = (Math.random() - 0.5) * 200; sPos.setZ(i, (Math.random() - 0.5) * 200); }
        sPos.setY(i, y); sPos.setX(i, x);
      }
      sPos.needsUpdate = true;
    }
    if (santaSleigh && santaSleigh.visible) {
      const sAngle = t * 0.15;
      const sRadius = 35;
      const sHeight = 14 + Math.sin(t * 0.3) * 2;
      santaSleigh.position.set(Math.cos(sAngle) * sRadius, sHeight, Math.sin(sAngle) * sRadius);
      santaSleigh.rotation.y = -sAngle + Math.PI / 2;
      santaSleigh.rotation.z = Math.sin(t * 0.5) * 0.05;
    }
  }

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

/* ── Lazy init ─────────────────────────────────────────── */
const io = new IntersectionObserver(
  (entries) => { entries.forEach((e) => {
    if (e.isIntersecting) { isVisible = true; if (!renderer) init(); }
    else { isVisible = false; }
  }); }, { threshold: 0.05 });
if (container) io.observe(container);

/* ── Spawn new agents ─────────────────────────────────── */

const USER_NAMES = [
  "Retrieval", "Synthesis", "Critique", "Verify",
  "Explore", "Encode", "Decode", "Calibrate",
  "Annotate", "Benchmark", "Simulate", "Interpret",
];
const USER_COLORS = [
  [0x6ab0d4, 0x5698ba], [0xd4a86a, 0xba9058],
  [0xa06ab0, 0x8a58a0], [0xd06a6a, 0xba5858],
  [0x6ad48a, 0x58ba76], [0xd0b060, 0xba9a50],
];
let spawnCount = 0;

const spawnBtn = document.getElementById("dioramaSpawn");
if (spawnBtn) {
  spawnBtn.addEventListener("click", () => {
    if (!scene || !camera) return;
    const ci = spawnCount % USER_COLORS.length;
    const name = USER_NAMES[spawnCount % USER_NAMES.length];
    // Place between the 4 core districts (at 0°, 90°, 180°, 270°) to avoid overlap
    // Core agents are at 45°/135°/225°/315° (±6,±6), so we offset to 0°/90°/180°/270°
    const slotAngle = (spawnCount % 4) * (Math.PI / 2) + (Math.random() - 0.5) * 0.4;
    const dist = 5 + Math.random() * 3;
    const config = {
      name,
      body: USER_COLORS[ci][0],
      accent: USER_COLORS[ci][1],
      roof: USER_COLORS[ci][1],
      home: [Math.cos(slotAngle) * dist, 0, Math.sin(slotAngle) * dist],
      angle: slotAngle + Math.PI,
    };
    const agent = createAgent(config, spawnCount % 4);
    agent.idleTimer = 30 + Math.random() * 60;
    scene.add(agent.group);
    agents.push(agent);
    spawnCount++;
  });
}

/* ── Reset / overview toggle button ────────────────────── */
let isOverview = false;
const resetBtn = document.getElementById("dioramaReset");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    if (!controls || !camera) return;
    const dest = isOverview ? DEFAULT_CAM : CLOSE_CAM;
    isOverview = !isOverview;
    if (typeof gsap !== "undefined") {
      gsap.to(camera.position, { x: dest.pos[0], y: dest.pos[1], z: dest.pos[2],
        duration: 1.0, ease: "power3.inOut" });
      gsap.to(controls.target, { x: dest.target[0], y: dest.target[1], z: dest.target[2],
        duration: 1.0, ease: "power3.inOut", onUpdate: () => controls.update() });
    } else {
      camera.position.set(...dest.pos);
      controls.target.set(...dest.target);
      controls.update();
    }
  });
}

/* ── Zoom in / out buttons ─────────────────────────────── */
const zoomInBtn = document.getElementById("zoomIn");
const zoomOutBtn = document.getElementById("zoomOut");
function dollyCamera(factor) {
  if (!controls || !camera) return;
  const dir = camera.position.clone().sub(controls.target);
  const newLen = Math.max(controls.minDistance, Math.min(controls.maxDistance, dir.length() * factor));
  dir.normalize().multiplyScalar(newLen);
  camera.position.copy(controls.target).add(dir);
  controls.update();
}
if (zoomInBtn) zoomInBtn.addEventListener("click", () => dollyCamera(0.7));
if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => dollyCamera(1.4));

/* ── Location nav + camera presets ─────────────────────── */
const navToggle = document.getElementById("navToggle");
const navPanel = document.getElementById("navPanel");
if (navToggle && navPanel) {
  navToggle.addEventListener("click", () => {
    navPanel.classList.toggle("open");
    navToggle.classList.toggle("active");
  });
  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".diorama-nav")) {
      navPanel.classList.remove("open");
      navToggle.classList.remove("active");
    }
  });
}

// Smooth fly-to helper (works outside init scope, uses lerp in animate)
function flyTo(pos, target) {
  if (!camera || !controls) return;
  cameraTarget = {
    pos: new THREE.Vector3(...pos),
    look: new THREE.Vector3(...target),
    progress: 0,
    startPos: camera.position.clone(),
    startLook: controls.target.clone(),
  };
}

// Camera presets
const CAM_PRESETS = {
  overview: { pos: [25, 18, 25], target: [0, 0, 0] },
  island:   { pos: [8, 7, 8], target: [0, 0.2, 0] },
  plaza:    { pos: [1.5, 2.5, 1.5], target: [0, 0.1, 0] },
};

// Named locations (pos = camera offset from location center)
const LOCATIONS = {
  analysis:   { at: [-6, 0, 6],   camOff: [-3, 4, 3] },
  literature: { at: [-6, 0, -6],  camOff: [-3, 4, -3] },
  hypothesis: { at: [6, 0, -6],   camOff: [3, 4, -3] },
  design:     { at: [6, 0, 6],    camOff: [3, 4, 3] },
  catalina:   { at: [-18, 0, -6], camOff: [-5, 5, -3] },
  aegean:     { at: [16, 0, 9],   camOff: [5, 5, 3] },
  desert:     { at: [5, 0, -14],  camOff: [2, 5, -5] },
  hawaii:     { at: [-22, 0, 18], camOff: [-5, 5, 3] },
  lighthouse: { at: [-9, 0, 7],   camOff: [-3, 3, 3] },
  farm:       { at: [3, 0, -5],   camOff: [3, 3, -2] },
  bonfire:    { at: [0, 0, 0],    camOff: [2, 2, 2] },
  jeju:       { at: [-36, 0, 30],  camOff: [-6, 7, 5] },
  treasure:   { at: [10, 0, -35],  camOff: [4, 6, -4] },
  maldives:   { at: [24, 0, 26],   camOff: [5, 5, 4] },
  hermit:     { at: [75, 0, -30],  camOff: [10, 12, -8] },
  glacier:        { at: [-65, 0, -55],  camOff: [-10, 12, -8] },
  montsaintmichel:{ at: [22, 0, -18],   camOff: [5, 6, -4] },
  cherryblossom:  { at: [-12, 0, -22],  camOff: [-4, 5, -4] },
  skyisland:      { at: [40, 0, 40],    camOff: [6, 8, 6] },
  cinqueterre:    { at: [-45, 0, -20],  camOff: [-6, 7, -4] },
  bamboo:         { at: [45, 0, -40],   camOff: [6, 7, -5] },
  borabora:       { at: [-48, 0, 38],   camOff: [6, 6, 5] },
  bb_bungalows:   { at: [-43, 0, 39],   camOff: [3, 3, 2] },
  bb_otemanu:     { at: [-49.5, 0, 38.5], camOff: [-3, 5, 2] },
  bb_beach:       { at: [-45, 0, 36],   camOff: [3, 3, -2] },
  bb_lagoon:      { at: [-44, 0, 40],   camOff: [4, 3, 3] },
  bb_pool:        { at: [-46, 0, 36.5], camOff: [2, 2, -1] },
};

if (navPanel) {
  navPanel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cam],[data-loc]");
    if (!btn) return;
    const camKey = btn.dataset.cam;
    const locKey = btn.dataset.loc;
    if (camKey && CAM_PRESETS[camKey]) {
      const p = CAM_PRESETS[camKey];
      flyTo(p.pos, p.target);
    } else if (locKey && LOCATIONS[locKey]) {
      const loc = LOCATIONS[locKey];
      const pos = [loc.at[0] + loc.camOff[0], loc.at[1] + loc.camOff[1], loc.at[2] + loc.camOff[2]];
      flyTo(pos, loc.at);
    }
    navPanel.classList.remove("open");
    navToggle.classList.remove("active");
    controls.autoRotate = false;
  });
}

/* ── Onboarding hint — dismiss on first interaction ───── */
const dioramaHint = document.getElementById("dioramaHint");
if (dioramaHint && canvas) {
  const dismissHint = () => {
    dioramaHint.classList.add("hidden");
    canvas.removeEventListener("pointerdown", dismissHint);
    canvas.removeEventListener("wheel", dismissHint);
  };
  canvas.addEventListener("pointerdown", dismissHint);
  canvas.addEventListener("wheel", dismissHint);
  // Auto-dismiss after 8 seconds
  setTimeout(() => dioramaHint.classList.add("hidden"), 8000);
}

/* ── Symposium trigger ─────────────────────────────────── */
let symposiumActive = false;

/* ── Symposium particle burst ──────────────────────────── */
function createSymposiumBurst() {
  const COUNT = 28;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(COUNT * 3);
  const vels = [];
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = 0; pos[i * 3 + 1] = 0.32; pos[i * 3 + 2] = 0;
    const a = Math.random() * Math.PI * 2;
    const spd = 0.015 + Math.random() * 0.03;
    vels.push({ x: Math.cos(a) * spd, y: 0.025 + Math.random() * 0.04, z: Math.sin(a) * spd });
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffd860, size: 0.05, transparent: true, opacity: 1, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  let frame = 0;
  const MAX = 65;
  function step() {
    frame++;
    const arr = pts.geometry.attributes.position.array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3] += vels[i].x;
      arr[i * 3 + 1] += vels[i].y; vels[i].y -= 0.0012;
      arr[i * 3 + 2] += vels[i].z;
    }
    pts.geometry.attributes.position.needsUpdate = true;
    mat.opacity = 1 - frame / MAX;
    if (frame < MAX) requestAnimationFrame(step);
    else { scene.remove(pts); geo.dispose(); mat.dispose(); }
  }
  requestAnimationFrame(step);
}

const symposiumBtn = document.getElementById("symposiumBtn");
if (symposiumBtn) {
  symposiumBtn.addEventListener("click", () => {
    if (!scene || !camera || symposiumActive) return;
    symposiumActive = true;
    symposiumBtn.disabled = true;

    // Particle burst at plaza center
    createSymposiumBurst();

    // Animate camera toward the plaza
    if (typeof gsap !== "undefined") {
      gsap.to(camera.position, { x: 4, y: 3.5, z: 4,
        duration: 0.85, ease: "power3.out" });
      gsap.to(controls.target, { x: 0, y: 0.3, z: 0,
        duration: 0.85, ease: "power3.out", onUpdate: () => controls.update() });
    }

    // Force all 4 core agents (indices 0-3) to walk to the plaza now
    for (let i = 0; i < 4 && i < agents.length; i++) {
      const agent = agents[i];
      agent.state = "walking-to-plaza";
      agent.scroll.visible = !agentsMuted;
      agent.headMesh.rotation.x = 0;
      const homeAngle = Math.atan2(agent.config.home[0], agent.config.home[2]);
      const seatR = PLAZA_R + 0.35;
      agent.target = new THREE.Vector3(
        Math.sin(homeAngle) * seatR, 0, Math.cos(homeAngle) * seatR);
    }
  });
}

function startDialogueLine(step) {
  // Hide all HTML dialogue bubbles
  hideAllHtmlBubbles();

  if (step >= DIALOGUE_LINES.length) return;

  const line = DIALOGUE_LINES[step];
  const agent = agents[line.agent];
  if (!agent) return;

  showHtmlBubble(line.agent, line.text);
}

function advanceDialogue() {
  if (dialogueStep < 0) return;
  dialogueTimer--;
  if (dialogueTimer <= 0) {
    // Hide current line
    if (dialogueStep < DIALOGUE_LINES.length) {
      hideHtmlBubble(DIALOGUE_LINES[dialogueStep].agent);
    }
    dialogueStep++;
    if (dialogueStep < DIALOGUE_LINES.length) {
      dialogueTimer = DIALOGUE_SHOW_FRAMES;
      setTimeout(() => startDialogueLine(dialogueStep), (DIALOGUE_GAP_FRAMES / 60) * 1000);
    } else {
      // Dialogue complete — send all core agents home
      dialogueStep = -1;
      for (let i = 0; i < 4 && i < agents.length; i++) {
        const a = agents[i];
        if (a.state === "exchanging") {
          a.state = "walking-home";
          a.target = new THREE.Vector3(...a.config.home);
          a.speechBubble.visible = false;
        }
      }
      cleanupDialogue();
    }
  }
}

function cleanupDialogue() {
  dialogueStep = -1;
  dialogueTimer = 0;
  hideAllHtmlBubbles();
}

// Called from updateAgent when an agent returns home after a symposium
function checkSymposiumEnd() {
  if (!symposiumActive) return;
  const coreAgents = agents.slice(0, 4);
  const allHome = coreAgents.every(a => a.state === "idle");
  if (allHome) {
    symposiumActive = false;
    if (symposiumBtn) symposiumBtn.disabled = false;
  }
}

/* ── Sunset Toggle — auto-reverts after 10s ──────────── */
let sunsetTimer = null;
const sunsetBtn = document.getElementById("sunsetBtn");

function applySunset(dur) {
  // Sun touching the ocean horizon
  const sunsetSunDir = new THREE.Vector3(14, 0.5, 6).normalize();
  if (sunLight) {
    gsap.to(sunLight.color, { r: 1.0, g: 0.82, b: 0.6, duration: dur });
    gsap.to(sunLight.position, { x: 14, y: 1.0, z: 6, duration: dur });
    gsap.to(sunLight, { intensity: 1.2, duration: dur });
  }
  if (hemiLightRef) {
    gsap.to(hemiLightRef.color, { r: 0.82, g: 0.68, b: 0.72, duration: dur });
    gsap.to(hemiLightRef.groundColor, { r: 0.4, g: 0.32, b: 0.3, duration: dur });
    gsap.to(hemiLightRef, { intensity: 0.5, duration: dur });
  }
  if (rimLightRef) {
    gsap.to(rimLightRef.color, { r: 1.0, g: 0.72, b: 0.52, duration: dur });
    gsap.to(rimLightRef, { intensity: 0.35, duration: dur });
    gsap.to(rimLightRef.position, { x: 14, y: 0.5, z: 6, duration: dur });
  }
  if (fillLightRef) {
    gsap.to(fillLightRef.color, { r: 0.55, g: 0.5, b: 0.7, duration: dur });
    gsap.to(fillLightRef, { intensity: 0.2, duration: dur });
  }
  if (sunGlowRef) {
    const sunsetPos = sunsetSunDir.clone().multiplyScalar(170);
    gsap.to(sunGlowRef.position, { x: sunsetPos.x, y: sunsetPos.y, z: sunsetPos.z, duration: dur });
    gsap.to(sunGlowRef.material.color, { r: 1.0, g: 0.75, b: 0.4, duration: dur });
    gsap.to(sunGlowRef.scale, { x: 3.5, y: 3.5, z: 3.5, duration: dur });
  }
  if (skyUniforms) {
    // 4-stop gradient: deep indigo → rose pink → peach-orange → soft gold
    const top = new THREE.Color(0x1e1040);     // deep indigo
    const mid = new THREE.Color(0x8a4878);     // rose-pink
    const horiz = new THREE.Color(0xf0b870);   // peach-orange
    const bottom = new THREE.Color(0xe8d0a0);  // soft gold
    gsap.to(skyUniforms.uTop.value, { r: top.r, g: top.g, b: top.b, duration: dur });
    gsap.to(skyUniforms.uMid.value, { r: mid.r, g: mid.g, b: mid.b, duration: dur });
    gsap.to(skyUniforms.uHorizon.value, { r: horiz.r, g: horiz.g, b: horiz.b, duration: dur });
    gsap.to(skyUniforms.uBottom.value, { r: bottom.r, g: bottom.g, b: bottom.b, duration: dur });
    gsap.to(skyUniforms.uSunDir.value, { x: sunsetSunDir.x, y: sunsetSunDir.y, z: sunsetSunDir.z, duration: dur });
    gsap.to(skyUniforms.uSunGlow, { value: 1.0, duration: dur });
    const sunC = new THREE.Color(0xffe0a0);
    gsap.to(skyUniforms.uSunColor.value, { r: sunC.r, g: sunC.g, b: sunC.b, duration: dur });
  }
  if (oceanUniforms) {
    const oc = new THREE.Color(0x7890a8);      // soft steel-blue
    const ocd = new THREE.Color(0x586878);      // deeper blue-grey
    gsap.to(oceanUniforms.uColor.value, { r: oc.r, g: oc.g, b: oc.b, duration: dur });
    gsap.to(oceanUniforms.uColorDeep.value, { r: ocd.r, g: ocd.g, b: ocd.b, duration: dur });
    gsap.to(oceanUniforms.uSunDir.value, { x: sunsetSunDir.x, y: sunsetSunDir.y, z: sunsetSunDir.z, duration: dur });
  }
  if (scene.fog) {
    const fogC = new THREE.Color(0xc8a088);
    gsap.to(scene.fog.color, { r: fogC.r, g: fogC.g, b: fogC.b, duration: dur });
  }
  // Turn off lighthouse beams during sunset
  lighthouseBeams.forEach(obj => {
    if (obj.isLight) gsap.to(obj, { intensity: 0, duration: dur });
    else gsap.to(obj, { visible: false, duration: 0, delay: dur * 0.3 });
  });
  if (bloomPassRef) {
    gsap.to(bloomPassRef, { strength: 0.22, threshold: 0.97, duration: dur });
  }
  if (colorGradeRef) {
    const warmSunset = new THREE.Vector3(0.015, 0.005, -0.01);
    gsap.to(colorGradeRef.uniforms.warmth.value, { x: warmSunset.x, y: warmSunset.y, z: warmSunset.z, duration: dur });
    gsap.to(colorGradeRef.uniforms.saturation, { value: 1.35, duration: dur });
  }
}

function revertSunset(dur) {
  const isDark = document.documentElement.dataset.theme === "dark";
  const daySunDir = new THREE.Vector3(8, 8, 8).normalize();
  if (sunLight) {
    const dayCol = new THREE.Color(0xfff4e0);
    gsap.to(sunLight.color, { r: dayCol.r, g: dayCol.g, b: dayCol.b, duration: dur });
    gsap.to(sunLight.position, { x: 8, y: 8, z: 8, duration: dur });
    gsap.to(sunLight, { intensity: 1.4, duration: dur });
  }
  if (hemiLightRef) {
    const hSky = new THREE.Color(0xd8e8ff);
    const hGnd = new THREE.Color(0xa8c088);
    gsap.to(hemiLightRef.color, { r: hSky.r, g: hSky.g, b: hSky.b, duration: dur });
    gsap.to(hemiLightRef.groundColor, { r: hGnd.r, g: hGnd.g, b: hGnd.b, duration: dur });
    gsap.to(hemiLightRef, { intensity: 0.7, duration: dur });
  }
  if (rimLightRef) {
    const rimC = new THREE.Color(0xffd8a0);
    gsap.to(rimLightRef.color, { r: rimC.r, g: rimC.g, b: rimC.b, duration: dur });
    gsap.to(rimLightRef, { intensity: 0.25, duration: dur });
    gsap.to(rimLightRef.position, { x: -6, y: 4, z: -6, duration: dur });
  }
  if (fillLightRef) {
    const fillC = new THREE.Color(0xe0eaff);
    gsap.to(fillLightRef.color, { r: fillC.r, g: fillC.g, b: fillC.b, duration: dur });
    gsap.to(fillLightRef, { intensity: 0.25, duration: dur });
  }
  if (sunGlowRef) {
    const dayPos = daySunDir.clone().multiplyScalar(170);
    gsap.to(sunGlowRef.position, { x: dayPos.x, y: dayPos.y, z: dayPos.z, duration: dur });
    const dayGlow = new THREE.Color(0xfffae0).multiplyScalar(1.5);
    gsap.to(sunGlowRef.material.color, { r: dayGlow.r, g: dayGlow.g, b: dayGlow.b, duration: dur });
    gsap.to(sunGlowRef.scale, { x: 1, y: 1, z: 1, duration: dur });
  }
  if (skyUniforms) {
    const top = new THREE.Color(isDark ? 0x0a1828 : 0x5a8ab8);
    const mid = new THREE.Color(isDark ? 0x122030 : 0x8aaccc);
    const horiz = new THREE.Color(isDark ? 0x1a2430 : 0xd8ccb4);
    const bottom = new THREE.Color(isDark ? 0x0c1218 : 0xc0b898);
    gsap.to(skyUniforms.uTop.value, { r: top.r, g: top.g, b: top.b, duration: dur });
    gsap.to(skyUniforms.uMid.value, { r: mid.r, g: mid.g, b: mid.b, duration: dur });
    gsap.to(skyUniforms.uHorizon.value, { r: horiz.r, g: horiz.g, b: horiz.b, duration: dur });
    gsap.to(skyUniforms.uBottom.value, { r: bottom.r, g: bottom.g, b: bottom.b, duration: dur });
    gsap.to(skyUniforms.uSunDir.value, { x: daySunDir.x, y: daySunDir.y, z: daySunDir.z, duration: dur });
    gsap.to(skyUniforms.uSunGlow, { value: 0.0, duration: dur });
  }
  if (oceanUniforms) {
    const oc = new THREE.Color(isDark ? 0x3a5568 : 0x7a9fb8);
    const ocd = new THREE.Color(isDark ? 0x2a3f50 : 0x5a7f98);
    gsap.to(oceanUniforms.uColor.value, { r: oc.r, g: oc.g, b: oc.b, duration: dur });
    gsap.to(oceanUniforms.uColorDeep.value, { r: ocd.r, g: ocd.g, b: ocd.b, duration: dur });
    gsap.to(oceanUniforms.uSunDir.value, { x: daySunDir.x, y: daySunDir.y, z: daySunDir.z, duration: dur });
  }
  if (scene.fog) {
    const fogC = new THREE.Color(isDark ? 0x1a2430 : 0xd0c8b4);
    gsap.to(scene.fog.color, { r: fogC.r, g: fogC.g, b: fogC.b, duration: dur });
  }
  // Fade out god rays
  // Restore lighthouse beams
  lighthouseBeams.forEach(obj => {
    if (obj.isLight) gsap.to(obj, { intensity: 1.0, duration: dur });
    else obj.visible = true;
  });
  // Restore bloom and color grade
  if (bloomPassRef) {
    gsap.to(bloomPassRef, { strength: 0.3, threshold: 0.92, duration: dur });
  }
  if (colorGradeRef) {
    const warmDay = new THREE.Vector3(0.025, 0.012, -0.025);
    gsap.to(colorGradeRef.uniforms.warmth.value, { x: warmDay.x, y: warmDay.y, z: warmDay.z, duration: dur });
    gsap.to(colorGradeRef.uniforms.saturation, { value: 1.4, duration: dur });
  }
}

if (sunsetBtn) {
  sunsetBtn.addEventListener("click", () => {
    if (!scene) return;
    if (isSunsetMode) {
      clearTimeout(sunsetTimer);
      isSunsetMode = false;
      sunsetBtn.classList.remove("active");
      revertSunset(2.0);
      return;
    }
    isSunsetMode = true;
    sunsetBtn.classList.add("active");
    applySunset(2.5);
    sunsetTimer = setTimeout(() => {
      isSunsetMode = false;
      sunsetBtn.classList.remove("active");
      revertSunset(2.5);
    }, 10000);
  });
}


/* ── Dawn / Winter Mode — mysterious snow + Santa ─────── */
let dawnTimer = null;
const dawnBtn = document.getElementById("dawnBtn");

function applyDawn(dur) {
  // Soft purple-blue Christmas twilight — even lighting, low contrast
  if (sunLight) {
    gsap.to(sunLight.color, { r: 0.7, g: 0.65, b: 0.9, duration: dur });
    gsap.to(sunLight.position, { x: -5, y: 6, z: -8, duration: dur });
    gsap.to(sunLight, { intensity: 0.9, duration: dur });
  }
  if (hemiLightRef) {
    gsap.to(hemiLightRef.color, { r: 0.6, g: 0.55, b: 0.8, duration: dur });
    gsap.to(hemiLightRef.groundColor, { r: 0.45, g: 0.4, b: 0.55, duration: dur });
    gsap.to(hemiLightRef, { intensity: 0.95, duration: dur });
  }
  if (rimLightRef) {
    gsap.to(rimLightRef.color, { r: 0.65, g: 0.6, b: 0.9, duration: dur });
    gsap.to(rimLightRef, { intensity: 0.4, duration: dur });
  }
  if (fillLightRef) {
    gsap.to(fillLightRef.color, { r: 0.6, g: 0.55, b: 0.8, duration: dur });
    gsap.to(fillLightRef, { intensity: 0.5, duration: dur });
  }
  if (sunGlowRef) {
    gsap.to(sunGlowRef.scale, { x: 0.4, y: 0.4, z: 0.4, duration: dur });
    gsap.to(sunGlowRef.material.color, { r: 0.75, g: 0.7, b: 0.95, duration: dur });
  }
  if (skyUniforms) {
    const top = new THREE.Color(0x1a1840);
    const mid = new THREE.Color(0x2a2858);
    const horiz = new THREE.Color(0x4a4070);
    const bottom = new THREE.Color(0x352e55);
    gsap.to(skyUniforms.uTop.value, { r: top.r, g: top.g, b: top.b, duration: dur });
    gsap.to(skyUniforms.uMid.value, { r: mid.r, g: mid.g, b: mid.b, duration: dur });
    gsap.to(skyUniforms.uHorizon.value, { r: horiz.r, g: horiz.g, b: horiz.b, duration: dur });
    gsap.to(skyUniforms.uBottom.value, { r: bottom.r, g: bottom.g, b: bottom.b, duration: dur });
    gsap.to(skyUniforms.uSunGlow, { value: 0.08, duration: dur });
  }
  if (oceanUniforms) {
    const oc = new THREE.Color(0x303050);
    const ocd = new THREE.Color(0x252540);
    gsap.to(oceanUniforms.uColor.value, { r: oc.r, g: oc.g, b: oc.b, duration: dur });
    gsap.to(oceanUniforms.uColorDeep.value, { r: ocd.r, g: ocd.g, b: ocd.b, duration: dur });
  }
  if (bloomPassRef) {
    gsap.to(bloomPassRef, { strength: 0.45, threshold: 0.5, duration: dur });
  }
  if (colorGradeRef) {
    gsap.to(colorGradeRef.uniforms.warmth.value, { x: 0.01, y: -0.01, z: 0.05, duration: dur });
    gsap.to(colorGradeRef.uniforms.saturation, { value: 1.2, duration: dur });
  }
  lighthouseBeams.forEach(obj => {
    if (obj.isLight) gsap.to(obj, { intensity: 0, duration: dur });
    else gsap.to(obj, { visible: false, duration: 0, delay: dur * 0.3 });
  });
  // Show snow and Santa after transition
  setTimeout(() => {
    if (snowSystem) snowSystem.visible = true;
    if (santaSleigh) santaSleigh.visible = true;
    if (christmasGroup) christmasGroup.visible = true;
  }, dur * 500);
}

function revertDawn(dur) {
  // Hide snow and Santa immediately
  if (snowSystem) snowSystem.visible = false;
  if (santaSleigh) santaSleigh.visible = false;
  if (christmasGroup) christmasGroup.visible = false;
  // Revert to day (reuse revertSunset logic)
  revertSunset(dur);
}

if (dawnBtn) {
  dawnBtn.addEventListener("click", () => {
    if (!scene) return;
    // If sunset is active, turn it off first
    if (isSunsetMode) {
      clearTimeout(sunsetTimer);
      isSunsetMode = false;
      if (sunsetBtn) sunsetBtn.classList.remove("active");
    }
    if (isDawnMode) {
      clearTimeout(dawnTimer);
      isDawnMode = false;
      dawnBtn.classList.remove("active");
      revertDawn(2.0);
      return;
    }
    isDawnMode = true;
    dawnBtn.classList.add("active");
    applyDawn(2.5);
    dawnTimer = setTimeout(() => {
      isDawnMode = false;
      dawnBtn.classList.remove("active");
      revertDawn(2.5);
    }, 30000);
  });
}

/* ── Mute agents button ─────────────────────────────────── */
const muteBtn = document.getElementById("muteAgentsBtn");
if (muteBtn) {
  muteBtn.addEventListener("click", () => {
    agentsMuted = !agentsMuted;
    muteBtn.classList.toggle("active", agentsMuted);
    if (agentsMuted) {
      hideAllHtmlBubbles();
      agents.forEach(a => {
        a.speechBubble.visible = false;
        a.scroll.visible = false;
      });
    }
  });
}

