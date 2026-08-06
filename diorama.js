import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { prefersReducedMotion } from "./ui-motion.js";

/* ═══════════════════════════════════════════════════════════
   Research Township Diorama — Dense Edition
   Single landmass, four districts around a central plaza.
   Literature fully realized as reference cluster.
   ═══════════════════════════════════════════════════════════ */

const ROLES = [
  { name: "Literature",  body: 0x5b8fa8, accent: 0x467a92, roof: 0x3d6878,
    home: [-6, 0, -6], angle: Math.PI * 1.25 },
  { name: "Hypothesis",  body: 0xc49a5c, accent: 0xb08845, roof: 0x9a7638,
    home: [6, 0, -6],  angle: Math.PI * 1.75 },
  { name: "Design",      body: 0x8b7baa, accent: 0x766896, roof: 0x635882,
    home: [6, 0, 6],   angle: Math.PI * 0.25 },
  { name: "Analysis",    body: 0xc27c6e, accent: 0xad6a5d, roof: 0x955a4e,
    home: [-6, 0, 6],  angle: Math.PI * 0.75 },
];

const PLAZA_R = 1.2, WALK_SPEED = 0.016, BOB_SPEED = 1.6, BOB_AMP = 0.04;
const EXCHANGE_F = 240, WAITS = [150, 230, 190, 270];
const PLATFORM_R = 11;
const ANALYSIS_HILL_Y = 0.45;
const DEFAULT_CAM = { pos: [4, 4.2, 4], target: [0, 0.2, 0] };  // close miniature framing (~7 units, 36° elev)
const OVERVIEW_CAM = { pos: [15, 11, 15], target: [0, 0, 0] };     // full-island aerial

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
let isReducedMotion = prefersReducedMotion();
let isVisible = false;

/* ── Vignette Shader ───────────────────────────────────── */

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    darkness: { value: 0.35 },
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
    saturation: { value: 1.40 },    // +40% toylike pop
    brightness: { value: 0.05 },    // +5%
    contrast: { value: 1.15 },      // +15%
    warmth: { value: new THREE.Vector3(0.025, 0.012, -0.025) },
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
gradientCanvas.width = 4;
gradientCanvas.height = 1;
const gCtx = gradientCanvas.getContext("2d");
gCtx.fillStyle = "#3a3a3a"; gCtx.fillRect(0, 0, 1, 1);
gCtx.fillStyle = "#7a7a7a"; gCtx.fillRect(1, 0, 1, 1);
gCtx.fillStyle = "#b8b8b8"; gCtx.fillRect(2, 0, 1, 1);
gCtx.fillStyle = "#ffffff"; gCtx.fillRect(3, 0, 1, 1);
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

const WOOD = 0xd9ccb0, WOOD_D = 0xc4b89c, STONE = 0xd0c8ba, CREAM = 0xf5f0e5;
const GREEN_L = 0x7ab87a, GREEN_D = 0x5a9a5a, GREEN_VD = 0x4a8a4a, TRUNK = 0x9a8a6a;
const WATER = 0x8ab8d0, METAL = 0x9a9aaa;
const DIRT = 0xc8b898, DIRT_D = 0xb8a880;

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
  const aHillDist = Math.sqrt((x + 6) * (x + 6) + (z - 6) * (z - 6));
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
  color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false,
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
  chim.position.set(0.25, 1.15, -0.12); chim.castShadow = true; lib.add(chim);
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
    book.rotation.y = (i - 3) * 0.06; book.castShadow = true; district.add(book);
  }
  // Short stack right side
  for (let i = 0; i < 3; i++) {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.1), mt(BOOK_COLORS[i + 3]));
    book.position.set(0.55, 0.02 + i * 0.04, 0.25);
    book.rotation.y = (i - 1) * 0.1; book.castShadow = true; district.add(book);
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
  trunkB.position.set(-0.9, 0.275, 0.8); trunkB.castShadow = true; district.add(trunkB);
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
    l.position.set(x, 0.24 + h + lr * 0.4, z); l.castShadow = true; g.add(l);
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
    bl.rotation.y = i * 0.15; bl.castShadow = true; g.add(bl);
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

  // Ground clearing (on top of the hill)
  const ground = makeGroundPatch(1.5, DIRT);
  g.add(ground);

  // Anchor: Observatory
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.85, 8), mt(r.body));
  tower.position.y = 0.425; tower.castShadow = true; g.add(tower);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.31, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mt(r.roof));
  dome.position.y = 0.85; dome.castShadow = true; g.add(dome);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.014, 4, 12), mt(CREAM));
  rail.rotation.x = -Math.PI / 2; rail.position.y = 0.87; g.add(rail);
  const scopeGroup = new THREE.Group();
  scopeGroup.position.set(0, 0.9, 0);
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.04, 0.32, 6), mt(METAL, { metalness: 0.3 }));
  scope.position.set(0.18, 0, 0); scope.rotation.z = -Math.PI / 5; scope.castShadow = true; scopeGroup.add(scope);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.026, 5, 4), mt(0xd0e8f0, { roughness: 0.1 }));
  lens.position.set(0.3, 0.08, 0); scopeGroup.add(lens);
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
    mast.position.set(i * 0.08, (0.3 + i * 0.08) / 2, 0); mast.castShadow = true; antennaArr.add(mast);
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
  const RES = 144; // grid resolution (higher = smoother edges)
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

  // Vertex-colored ground (base green, will be replaced by terrain shader in pass 4)
  const groundMat = mt(0xb0c898, { vertexColors: false });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ── Cliff/underside — vertical wall below island rim ──
  const cliffSegments = 128;
  const cliffGeo = new THREE.BufferGeometry();
  const cliffVerts = [];
  const cliffNorms = [];
  const cliffUvs = [];
  const cliffIdxs = [];
  for (let i = 0; i <= cliffSegments; i++) {
    const a = (i / cliffSegments) * Math.PI * 2;
    const r = getIslandRadius(a);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = getTerrainHeight(x * 0.95, z * 0.95); // sample slightly inward
    const topY = Math.max(h * 0.5, -0.05);
    const botY = -0.35;
    const nx = Math.cos(a), nz = Math.sin(a);
    const u = i / cliffSegments;
    // Top vertex
    cliffVerts.push(x, topY, z);
    cliffNorms.push(nx, 0, nz);
    cliffUvs.push(u, 1);
    // Bottom vertex
    cliffVerts.push(x, botY, z);
    cliffNorms.push(nx, 0, nz);
    cliffUvs.push(u, 0);
    if (i < cliffSegments) {
      const vi = i * 2;
      cliffIdxs.push(vi, vi + 1, vi + 2, vi + 2, vi + 1, vi + 3);
    }
  }
  cliffGeo.setAttribute("position", new THREE.Float32BufferAttribute(cliffVerts, 3));
  cliffGeo.setAttribute("normal", new THREE.Float32BufferAttribute(cliffNorms, 3));
  cliffGeo.setAttribute("uv", new THREE.Float32BufferAttribute(cliffUvs, 2));
  cliffGeo.setIndex(cliffIdxs);
  const cliff = new THREE.Mesh(cliffGeo, mt(WOOD_D, { roughness: 0.95 }));
  cliff.castShadow = true;
  scene.add(cliff);

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
  const rockCluster = (cx, cz, count) => {
    for (let i = 0; i < count; i++) {
      const size = 0.08 + Math.random() * 0.12;
      const rx = cx + (Math.random() - 0.5) * 0.5;
      const rz = cz + (Math.random() - 0.5) * 0.5;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(size, 0),
        mt(STONE, { roughness: 0.95 }));
      rock.position.set(rx, getTerrainHeight(rx, rz) + size * 0.3, rz);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
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
  const waterUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(0x7a9fb8) },
    uColorDeep: { value: new THREE.Color(0x5a7f98) },
    uSunDir: { value: sunDir },
  };
  oceanUniforms = waterUniforms;

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying float vWave;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vec3 pos = position;
        // Multi-frequency wave displacement
        float w1 = sin(pos.x * 0.6 + uTime * 0.8) * 0.08;
        float w2 = sin(pos.z * 0.4 + uTime * 0.5 + 1.0) * 0.06;
        float w3 = sin((pos.x + pos.z) * 0.3 + uTime * 0.3) * 0.04;
        float w4 = sin(pos.x * 1.5 + pos.z * 0.8 + uTime * 1.2) * 0.02;
        pos.y += w1 + w2 + w3 + w4;
        vWave = (w1 + w2 + w3 + w4) / 0.2;
        // Analytical normal from wave derivatives
        float dx = 0.6*cos(pos.x*0.6+uTime*0.8)*0.08
                  + 0.3*cos((pos.x+pos.z)*0.3+uTime*0.3)*0.04
                  + 1.5*cos(pos.x*1.5+pos.z*0.8+uTime*1.2)*0.02;
        float dz = 0.4*cos(pos.z*0.4+uTime*0.5+1.0)*0.06
                  + 0.3*cos((pos.x+pos.z)*0.3+uTime*0.3)*0.04
                  + 0.8*cos(pos.x*1.5+pos.z*0.8+uTime*1.2)*0.02;
        vNormal = normalize(vec3(-dx, 1.0, -dz));
        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uColorDeep;
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying float vWave;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        // Toon-step base color from wave height
        float shade = smoothstep(-0.5, 0.5, vWave);
        shade = floor(shade * 3.0 + 0.5) / 3.0;
        vec3 col = mix(uColorDeep, uColor, shade);
        // Scrolling surface detail
        float detail = sin(vWorldPos.x * 3.0 + uTime * 0.4) * sin(vWorldPos.z * 2.5 + uTime * 0.3);
        col += detail * 0.015;
        // Specular highlight from sun (toon-stepped)
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 halfDir = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(vNormal, halfDir), 0.0), 64.0);
        col += vec3(1.0, 0.98, 0.9) * step(0.4, spec) * 0.3;
        // Fresnel edge darkening
        float fresnel = 1.0 - max(dot(vNormal, viewDir), 0.0);
        fresnel = pow(fresnel, 3.0) * 0.15;
        col = mix(col, uColorDeep, fresnel);
        // Sparkle glints (irregular, non-gridded)
        float wx = vWorldPos.x + sin(vWorldPos.z * 1.3) * 0.4;
        float wz = vWorldPos.z + sin(vWorldPos.x * 1.7) * 0.3;
        float sp1 = sin(wx * 4.5 + uTime * 2.0) * sin(wz * 3.8 + uTime * 1.3);
        float sp2 = sin(wx * 2.7 - uTime * 1.1) * sin(wz * 3.2 - uTime * 0.8);
        float sparkle = max(sp1, sp2);
        col += step(0.85, sparkle) * 0.05;
        gl_FragColor = vec4(col, 0.88);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
  });

  const oceanGeo = new THREE.PlaneGeometry(200, 200, 80, 80);
  const ocean = new THREE.Mesh(oceanGeo, waterMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.22;
  ocean.receiveShadow = true;
  scene.add(ocean);

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
  barrel.position.set(mx + 0.3, 0.06, mz + 0.5); barrel.castShadow = true; scene.add(barrel);
  const barrel2 = barrel.clone();
  barrel2.position.set(mx + 0.45, 0.06, mz + 0.4); scene.add(barrel2);
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.12), mt(WOOD));
  crate.position.set(mx - 0.4, 0.05, mz + 0.45); crate.castShadow = true; scene.add(crate);
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

  const layPath = (curve) => {
    const points = curve.getPoints(24);
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const dx = p2.x - p1.x, dz = p2.z - p1.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      const angle = Math.atan2(dx, dz);
      const width = 0.28 + Math.sin(i * 1.3) * 0.06;

      const midX = (p1.x + p2.x) / 2, midZ = (p1.z + p2.z) / 2;
      const midY = getTerrainHeight(midX, midZ);
      const edgeSeg = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, 0.01, len * 1.05), pathEdgeMat);
      edgeSeg.position.set(midX, midY + 0.004, midZ);
      edgeSeg.rotation.y = angle;
      edgeSeg.receiveShadow = true;
      scene.add(edgeSeg);

      const seg = new THREE.Mesh(new THREE.BoxGeometry(width, 0.012, len * 1.05), pathMat);
      seg.position.set(midX, midY + 0.007, midZ);
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
    stool.castShadow = true; scene.add(stool);
  });

  // Low decorative posts with lanterns
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.3, 4), mt(WOOD_D));
    post.position.set(Math.cos(a) * 0.55, plazaY + 0.15, Math.sin(a) * 0.55);
    post.castShadow = true; scene.add(post);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.018, 5, 4),
      mt(0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 0.3 }));
    glow.position.set(Math.cos(a) * 0.55, plazaY + 0.32, Math.sin(a) * 0.55);
    scene.add(glow);
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
  addGrove(-1, -8.5, 10, 2.5, [GREEN_L, GREEN_D]);

  // ── GROVE 2: Between Design [6,6] and Analysis [-6,6] — south edge ──
  addGrove(1, 8.5, 9, 2.5, [GREEN_L, GREEN_D]);

  // ── GROVE 3: East of Hypothesis — island edge ──
  addGrove(8.5, -2.5, 8, 2, [GREEN_D, GREEN_VD]);

  // ── GROVE 4: West of Literature — island edge ──
  addGrove(-8.5, -2.5, 8, 2, [GREEN_L, GREEN_D]);

  // ── GROVE 5: East of Design — island edge ──
  addGrove(8.5, 3, 7, 1.8, [GREEN_D, GREEN_VD]);

  // ── GROVE 6: West of Analysis — island edge, on the hill ──
  addGrove(-8, 4.5, 6, 2, [GREEN_VD, GREEN_D]);

  // ── GROVE 7: Near-right foreground (SE corner, partially cropped by frame) ──
  addGrove(8, 6, 6, 1.5, [GREEN_D, GREEN_VD]);

  // ── GROVE 8: Near-left foreground (E, close to camera) ──
  addGrove(7, 8, 5, 1.2, [GREEN_L, GREEN_D]);

  // ── GROVE 9: Near-bottom foreground framing (S-SE) ──
  addGrove(3, 7.5, 4, 1.0, [GREEN_D, GREEN_L, GREEN_VD]);

  // ── Sparse individuals along paths (3-4 only, for rhythm) ──
  addTree(-3, -3, 1, 0, GREEN_L);   // Literature path
  addTree(3, 3, 1, 1, GREEN_D);     // Design path
  addTree(-3, 3, 0, 2, GREEN_VD);   // Analysis path side
  addTree(6, 4, 2, 0, GREEN_D);     // near foreground individual
  addTree(4.5, 7, 1, 2, GREEN_VD);  // foreground conifer

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
    { cx: 0, cz: 0, r: 2.5, grass: 18, flowers: 2, rocks: 4 },
    // Along each path (mid density)
    { cx: -3, cz: -3, r: 1.5, grass: 8, flowers: 0, rocks: 2 },
    { cx: 3, cz: -3, r: 1.5, grass: 8, flowers: 0, rocks: 2 },
    { cx: 3, cz: 3, r: 1.5, grass: 8, flowers: 1, rocks: 2 },
    { cx: -3, cz: 3, r: 1.5, grass: 8, flowers: 0, rocks: 2 },
    // Near each building entrance
    { cx: -5.5, cz: -5.5, r: 1.5, grass: 10, flowers: 1, rocks: 3 },
    { cx: 5.5, cz: -5.5, r: 1.5, grass: 10, flowers: 1, rocks: 3 },
    { cx: 5.5, cz: 5.5, r: 1.5, grass: 10, flowers: 0, rocks: 3 },
    { cx: -5.5, cz: 5.5, r: 1.5, grass: 10, flowers: 1, rocks: 3 },
    // At grove bases (lower density)
    { cx: -1, cz: -8.5, r: 2, grass: 6, flowers: 0, rocks: 3 },
    { cx: 1, cz: 8.5, r: 2, grass: 6, flowers: 0, rocks: 3 },
    { cx: 8.5, cz: -2.5, r: 1.5, grass: 5, flowers: 0, rocks: 4 },
    { cx: -8.5, cz: -2.5, r: 1.5, grass: 5, flowers: 0, rocks: 4 },
  ];
  const fColors = [0xe8a0a0, 0xa0c0e8, 0xe8d8a0, 0xc0a0e0, 0xa0e8c0, 0xf0d0a0];
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
  const dummy = new THREE.Object3D();

  // ── Grass tufts (InstancedMesh — crossed planes) ──
  const grassGeo = new THREE.PlaneGeometry(0.04, 0.06);
  const grassMat = mtWind(0x6aaa5a, { heightFactor: 3.0, swayAmp: 0.015, swaySpeed: 1.2 });
  grassMat.side = THREE.DoubleSide;
  grassMat.transparent = true; grassMat.opacity = 0.9;
  grassMat.alphaTest = 0.1;
  const GRASS_COUNT = 80;
  const grassInst = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_COUNT);
  let gi = 0;
  const placeGrass = (x, z) => {
    if (gi >= GRASS_COUNT || !isOnIsland(x, z)) return;
    const y = getTerrainHeight(x, z);
    dummy.position.set(x, y + 0.03, z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.setScalar(0.7 + Math.random() * 0.6);
    dummy.updateMatrix();
    grassInst.setMatrixAt(gi++, dummy.matrix);
    // Cross blade
    if (gi >= GRASS_COUNT) return;
    dummy.rotation.y += Math.PI / 2;
    dummy.updateMatrix();
    grassInst.setMatrixAt(gi++, dummy.matrix);
  };
  // Sparse scatter across island
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 8;
    placeGrass(Math.cos(a) * d, Math.sin(a) * d);
  }
  grassInst.count = gi;
  grassInst.instanceMatrix.needsUpdate = true;
  scene.add(grassInst);

  // ── Flowers (sparse — just a few accent patches) ──
  [0xe8a0a0, 0xe8d8a0].forEach(fc => {
    const fGeo = new THREE.SphereGeometry(0.015, 4, 4);
    const fMat = mt(fc);
    const FLOWER_COUNT = 10;
    const fInst = new THREE.InstancedMesh(fGeo, fMat, FLOWER_COUNT);
    let fi = 0;
    for (let i = 0; i < FLOWER_COUNT; i++) {
      const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 5;
      const fx = Math.cos(a) * d, fz = Math.sin(a) * d;
      if (!isOnIsland(fx, fz)) continue;
      const fy = getTerrainHeight(fx, fz);
      dummy.position.set(fx, fy + 0.015, fz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.6 + Math.random() * 0.8);
      dummy.updateMatrix();
      fInst.setMatrixAt(fi++, dummy.matrix);
    }
    fInst.count = fi;
    fInst.instanceMatrix.needsUpdate = true;
    scene.add(fInst);
  });

  // ── Pebbles (InstancedMesh — small dodecahedrons) ──
  const pebbleGeo = new THREE.DodecahedronGeometry(0.018, 0);
  const pebbleMat = mt(STONE, { roughness: 0.95 });
  const PEBBLE_COUNT = 200;
  const pebbleInst = new THREE.InstancedMesh(pebbleGeo, pebbleMat, PEBBLE_COUNT);
  let pi = 0;
  for (let i = 0; i < PEBBLE_COUNT; i++) {
    const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 9;
    const px = Math.cos(a) * d, pz = Math.sin(a) * d;
    if (!isOnIsland(px, pz)) continue;
    const py = getTerrainHeight(px, pz);
    dummy.position.set(px, py + 0.006, pz);
    dummy.rotation.set(Math.random(), Math.random(), Math.random());
    dummy.scale.set(0.5 + Math.random() * 1.0, 0.3 + Math.random() * 0.5, 0.5 + Math.random() * 1.0);
    dummy.updateMatrix();
    pebbleInst.setMatrixAt(pi++, dummy.matrix);
  }
  pebbleInst.count = pi;
  pebbleInst.instanceMatrix.needsUpdate = true;
  scene.add(pebbleInst);

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
  const birdMat = mt(0x404040);
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
    new THREE.CylinderGeometry(2.5, 3.0, 0.6, 8), mt(0x8aaa70, { roughness: 0.9 }));
  di1Land.position.y = 0.1; di1.add(di1Land);
  // Hill
  const di1Hill = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), mt(0x7a9a60));
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
    new THREE.DodecahedronGeometry(1.5, 1), mt(0xa09880, { roughness: 0.95 }));
  di2Rock.position.y = 0.5; di2Rock.scale.y = 0.4; di2.add(di2Rock);
  const di2Peak = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.0, 5), mt(0x908878));
  di2Peak.position.set(0.3, 0.8, 0); di2.add(di2Peak);
  scene.add(di2);

  // Island 3 — flat atoll, far south
  const di3 = new THREE.Group();
  di3.position.set(5, -0.35, 35);
  const di3Land = new THREE.Mesh(
    new THREE.CylinderGeometry(1.8, 2.2, 0.3, 10), mt(0xd0c8a0, { roughness: 0.9 }));
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
  post.position.set(2.5, spY + 0.275, -2.5); post.castShadow = true; scene.add(post);
  ROLES.forEach((r, i) => {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.015), mt(r.body));
    sign.position.set(2.62, spY + 0.46 - i * 0.065, -2.5);
    sign.rotation.y = -0.3 + i * 0.2; scene.add(sign);
  });

  // ── Lamp posts — ONLY along paths and plaza perimeter ──
  const addLamp = (x, z) => {
    const gy = getTerrainHeight(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.42, 5), mt(0x606060));
    pole.position.set(x, gy + 0.21, z); pole.castShadow = true; scene.add(pole);
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
    // Flowers in planter
    for (let j = 0; j < 3; j++) {
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.015, 4, 4),
        mt([0xe8a0a0, 0xa0c0e8, 0xe8d8a0][j]));
      fl.position.set(px + (j - 1) * 0.05, 0.1, pz); scene.add(fl);
    }
    // Small greenery in planter
    const pGreen = new THREE.Mesh(new THREE.DodecahedronGeometry(0.04, 0), mt(GREEN_D));
    pGreen.position.set(px, 0.1, pz); scene.add(pGreen);
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

  // ── Banner flags between plaza perimeter posts ──
  for (let i = 0; i < 4; i++) {
    const a1 = (i * Math.PI) / 2 + Math.PI / 4;
    const a2 = ((i + 1) * Math.PI) / 2 + Math.PI / 4;
    const r1 = 1.8, r2 = 1.8;
    const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
    const x2 = Math.cos(a2) * r2, z2 = Math.sin(a2) * r2;
    // 3 small flags along the catenary
    for (let j = 1; j <= 3; j++) {
      const t = j / 4;
      const fx = x1 + (x2 - x1) * t;
      const fz = z1 + (z2 - z1) * t;
      const sag = Math.sin(t * Math.PI) * 0.06;
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.06),
        mt(ROLES[i % 4].body, { transparent: true, opacity: 0.7 }));
      flag.position.set(fx, 0.4 - sag, fz);
      flag.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      scene.add(flag);
    }
  }

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

  // ── Path junction signposts ──
  const signpostSpots = [
    { pos: [-2.8, 0, -2.8], ry: Math.PI * 1.25, label: ROLES[0].body },  // toward Literature
    { pos: [2.8, 0, -2.8],  ry: Math.PI * 1.75, label: ROLES[1].body },  // toward Hypothesis
    { pos: [2.8, 0, 2.8],   ry: Math.PI * 0.25, label: ROLES[2].body },  // toward Design
    { pos: [-2.8, 0, 2.8],  ry: Math.PI * 0.75, label: ROLES[3].body },  // toward Analysis
  ];
  signpostSpots.forEach(({ pos, ry, label }) => {
    const sp = new THREE.Group();
    sp.position.set(pos[0], getTerrainHeight(pos[0], pos[2]), pos[2]);
    // Post
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.015, 0.35, 4), mt(WOOD_D));
    pole.position.y = 0.175; sp.add(pole);
    // Arrow sign (colored by district)
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.01), mt(label));
    sign.position.set(0.04, 0.3, 0); sign.rotation.y = ry; sp.add(sign);
    // Arrow tip
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 3), mt(label));
    tip.position.set(0.11, 0.3, 0); tip.rotation.z = -Math.PI / 2; tip.rotation.y = ry; sp.add(tip);
    scene.add(sp);
  });
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
    mPost.position.set(0.28, 0.14, pz); mPost.castShadow = true; dock.add(mPost);
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
  hull.position.y = 0.02; hull.castShadow = true; boat.add(hull);
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
  // Roof
  const lhRoof = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.12, 8), mt(0xc04040));
  lhRoof.position.y = 1.42; lighthouse.add(lhRoof);
  scene.add(lighthouse);
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
    const bfBody = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 3), mt(0x404040));
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
      mt(0x3a2a1a, { roughness: 0.95 }));
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
    mt(0x404040, { roughness: 0.95 }));
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
  sbHull.position.y = 0.02; sbHull.castShadow = true; sailboat.add(sbHull);
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
  animatedObjects.push({
    type: "bob", mesh: sailboat, speed: 0.5,
    baseY: -0.1, amp: 0.018, phase: 1.0,
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
    gPost.position.set(px, 0.2, pz); gPost.castShadow = true; gazebo.add(gPost);
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
  block.position.set(wpx, wpy + 0.05, wpz); block.castShadow = true; scene.add(block);
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
      logM.rotation.x = Math.PI / 2; logM.castShadow = true; scene.add(logM);
    }
  }

  // ── Research crates under tarp along a path ──
  const rcx = -2, rcz = -3;
  const rcy = getTerrainHeight(rcx, rcz);
  const rc1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.1), mt(WOOD_D));
  rc1.position.set(rcx, rcy + 0.05, rcz); rc1.castShadow = true; scene.add(rc1);
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
  for (let i = 0; i < 36; i++) {
    const geo = new THREE.SphereGeometry(0.012, 4, 4);
    const color = [0xffe8a0, 0xa0d8ff, 0xffa0c0, 0xc0ffa0][i % 4];
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    const angle = Math.random() * Math.PI * 2;
    const dist = 1.5 + Math.random() * 9;
    mesh.position.set(Math.cos(angle) * dist, 0.3 + Math.random() * 0.8, Math.sin(angle) * dist);
    mesh.userData.base = mesh.position.clone();
    mesh.userData.speed = 0.3 + Math.random() * 0.5;
    mesh.userData.phase = Math.random() * Math.PI * 2;
    mesh.userData.radius = 0.1 + Math.random() * 0.2;
    scene.add(mesh);
    particles.push(mesh);
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

  switch (index % 4) {
    case 0: { // Literature — tall scholar with mortarboard & book
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.22, 4, 8), mt(c));
      body.position.y = 0.24; body.castShadow = true; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mt(c));
      head.position.y = 0.50; head.castShadow = true; group.add(head);
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.1, 3, 4), mt(c));
        arm.position.set(side * 0.115, 0.26, 0); arm.rotation.z = side * 0.2; group.add(arm);
      }
      // Legs
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.025, 0.1, 4), mt(c));
        leg.position.set(side * 0.04, 0.06, 0); group.add(leg);
      }
      // Mortarboard
      const hatBoard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.012, 0.18), mt(a));
      hatBoard.position.y = 0.58; group.add(hatBoard);
      const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.04, 6), mt(a));
      hatCrown.position.y = 0.555; group.add(hatCrown);
      const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.06, 3), mt(0xc45454));
      tassel.position.set(0.09, 0.56, 0.09); tassel.rotation.z = 0.3; group.add(tassel);
      // Book (larger, with visible pages)
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), mt(0xc45454));
      book.position.set(0.13, 0.28, 0.03); group.add(book);
      const pages = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.015), mt(CREAM));
      pages.position.set(0.13, 0.28, 0.055); group.add(pages);
      topY = 0.60; break;
    }
    case 1: { // Hypothesis — round curious with question mark
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 7), mt(c));
      body.position.y = 0.22; body.castShadow = true; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 7), mt(c));
      head.position.y = 0.44; head.castShadow = true; group.add(head);
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.08, 3, 4), mt(c));
        arm.position.set(side * 0.155, 0.22, 0); arm.rotation.z = side * 0.35; group.add(arm);
      }
      // Feet
      for (const side of [-1, 1]) {
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), mt(c));
        foot.position.set(side * 0.06, 0.06, 0.02); group.add(foot);
      }
      // Question mark (torus arc + dot)
      const qCurve = new THREE.Mesh(
        new THREE.TorusGeometry(0.025, 0.006, 4, 8, Math.PI * 1.5), mt(CREAM));
      qCurve.position.set(0, 0.57, 0.08); qCurve.rotation.x = 0.2; group.add(qCurve);
      const qDot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 4), mt(CREAM));
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
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), mt(c));
        arm.position.set(side * 0.125, 0.24, 0); arm.rotation.z = side * 0.12; group.add(arm);
      }
      // Legs (blocky)
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.1, 0.06), mt(c));
        leg.position.set(side * 0.05, 0.06, 0); group.add(leg);
      }
      // Hard hat (dome + brim)
      const hat = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mt(a));
      hat.position.y = 0.51; group.add(hat);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 8), mt(a));
      brim.position.y = 0.505; group.add(brim);
      // Pencil (larger, held at side)
      const pencil = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 4), mt(0xe8c040));
      pencil.position.set(0.15, 0.28, 0.04); pencil.rotation.z = -0.25; group.add(pencil);
      const pencilTip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.02, 4), mt(0x333333));
      pencilTip.position.set(0.157, 0.21, 0.04); pencilTip.rotation.z = -0.25; group.add(pencilTip);
      // Ruler (at other side)
      const ruler = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.005), mt(WOOD));
      ruler.position.set(-0.13, 0.22, 0.04); ruler.rotation.z = 0.15; group.add(ruler);
      topY = 0.54; break;
    }
    case 3: { // Analysis — detective with hat, monocle & magnifying glass
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.16, 4, 8), mt(c));
      body.position.y = 0.22; body.castShadow = true; group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6), mt(c));
      head.position.y = 0.46; head.castShadow = true; group.add(head);
      // Arms
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.1, 3, 4), mt(c));
        arm.position.set(side * 0.14, 0.24, 0); arm.rotation.z = side * 0.2; group.add(arm);
      }
      // Legs
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.1, 4), mt(c));
        leg.position.set(side * 0.045, 0.06, 0); group.add(leg);
      }
      // Detective hat (deerstalker — base + dome + front visor)
      const hatBase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.035, 8), mt(a));
      hatBase.position.y = 0.545; group.add(hatBase);
      const hatDome = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), mt(a));
      hatDome.position.y = 0.56; group.add(hatDome);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.008, 0.05), mt(a));
      visor.position.set(0, 0.54, 0.1); visor.rotation.x = -0.2; group.add(visor);
      // Monocle (larger, more visible)
      const monocle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 6, 12),
        mt(0xd0d0d0, { metalness: 0.5 }));
      monocle.position.set(0.08, 0.48, 0.085); monocle.rotation.y = 0.2; group.add(monocle);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.035, 8),
        mt(0xd0e8f0, { roughness: 0.1, transparent: true, opacity: 0.4 }));
      lens.position.set(0.08, 0.48, 0.09); monocle.rotation.y = 0.2; group.add(lens);
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.12, 3), mt(0xc0c0c0));
      chain.position.set(0.06, 0.40, 0.06); chain.rotation.z = 0.1; group.add(chain);
      // Magnifying glass (held in left arm, bigger)
      const magRing = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 4, 12),
        mt(0xc8c8c8, { metalness: 0.4 }));
      magRing.position.set(-0.15, 0.28, 0.06); group.add(magRing);
      const magLens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 8),
        mt(0xd0e8f0, { roughness: 0.1, transparent: true, opacity: 0.3 }));
      magLens.position.set(-0.15, 0.28, 0.065); group.add(magLens);
      const magHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 4), mt(WOOD_D));
      magHandle.position.set(-0.15, 0.20, 0.06); group.add(magHandle);
      topY = 0.58; break;
    }
  }

  // Eyes — larger, more legible face
  const eyeY = [0.51, 0.46, 0.45, 0.48][index % 4];
  const eyeZ = [0.075, 0.09, 0.07, 0.08][index % 4];
  const eyeX = [0.035, 0.042, 0.048, 0.038][index % 4];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), mt(CREAM, { roughness: 0.3 }));
    eye.position.set(side * eyeX, eyeY, eyeZ); group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.011, 5, 4), mt(0x222222));
    pupil.position.set(side * eyeX, eyeY, eyeZ + 0.017); group.add(pupil);
  }

  // Antenna + glow (shorter, tighter to head)
  const antennaWire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.004, 0.1, 4), mt(0xb0b0b0, { metalness: 0.3 }));
  antennaWire.position.set(0, topY + 0.05, 0); group.add(antennaWire);
  const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5),
    mt(config.body, { emissive: config.body, emissiveIntensity: 0.3 }));
  antennaTip.position.set(0, topY + 0.11, 0); group.add(antennaTip);

  // Signal rings — smaller, subtler (no floating-artifact look)
  const signalRing = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.003, 4, 12),
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

  group.position.set(...config.home);
  if (index === 3) group.position.y = ANALYSIS_HILL_Y;

  // children[0] = contact shadow, [1] = body, [2] = head
  const bodyMesh = group.children[1];
  const headMesh = group.children[2];

  return {
    group, bodyMesh, headMesh, scroll, antennaTip, signalRing, signalRing2,
    speechBubble, config, index, state: "idle",
    pauseTimer: 60 + index * 30, idleTimer: 80 + index * 60, target: null, topY,
  };
}

/* ═══════════════════════════════════════════════════════════
   Agent FSM — with district idle behavior
   ═══════════════════════════════════════════════════════════ */

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

  const baseY = getTerrainHeight(pos.x, pos.z);

  switch (agent.state) {
    case "idle": {
      agent.speechBubble.visible = false;
      const idlePhase = t * 0.8 + agent.index * 2;

      if (agent.index === 0) {
        agent.headMesh.rotation.x = -0.12 + Math.sin(t * 0.6) * 0.05;
        agent.bodyMesh.rotation.z = Math.sin(t * 0.3) * 0.015;
        pos.y = baseY + Math.sin(t * 0.5 + agent.index) * 0.01;
      } else {
        pos.y = baseY + Math.sin(t * BOB_SPEED + agent.index * 1.7) * BOB_AMP * 0.5;
        agent.headMesh.rotation.y = Math.sin(idlePhase) * 0.25;
        agent.bodyMesh.rotation.z = Math.sin(t * 1.0 + agent.index * 2) * 0.02;
      }

      agent.group.rotation.y = agent.config.angle + Math.PI;
      agent.idleTimer--;
      if (agent.idleTimer <= 0) {
        agent.state = "walking-to-plaza";
        agent.scroll.visible = true;
        agent.headMesh.rotation.x = 0;
        // Seat on the agent's own side of the table (no crossing through center)
        const homeAngle = Math.atan2(agent.config.home[0], agent.config.home[2]);
        const seatR = PLAZA_R + 0.35;
        agent.target = new THREE.Vector3(
          Math.sin(homeAngle) * seatR, 0, Math.cos(homeAngle) * seatR);
      }
      break;
    }
    case "walking-to-plaza": {
      const dir = agent.target.clone().sub(new THREE.Vector3(pos.x, 0, pos.z));
      const dist = dir.length();
      if (dist < 0.12) {
        const isSymposium = symposiumActive;
        agent.state = "exchanging";
        // During symposium, dialogue completion drives exit — use huge timer
        agent.pauseTimer = isSymposium ? 99999 : EXCHANGE_F;
        agent.scroll.visible = false;
        if (!isSymposium) {
          // Show HTML overlay bubble (bypasses tilt-shift blur)
          const line = CASUAL_LINES[Math.floor(Math.random() * CASUAL_LINES.length)];
          showHtmlBubble(agents.indexOf(agent), line);
        }
        agent.speechBubble.visible = false;
        addPaperToTable(agent);
        // If this is the first agent arriving during symposium, start dialogue
        if (isSymposium && dialogueStep < 0) {
          dialogueStep = 0;
          dialogueTimer = DIALOGUE_SHOW_FRAMES;
          startDialogueLine(0);
        }
      } else {
        dir.normalize();
        pos.x += dir.x * WALK_SPEED; pos.z += dir.z * WALK_SPEED;
        pos.y = getTerrainHeight(pos.x, pos.z) + Math.abs(Math.sin(t * 9)) * 0.04;
        agent.group.rotation.y = Math.atan2(dir.x, dir.z);
        agent.bodyMesh.rotation.z = Math.sin(t * 9) * 0.07;
        agent.headMesh.rotation.x = 0;
      }
      break;
    }
    case "exchanging": {
      pos.y = getTerrainHeight(pos.x, pos.z) + Math.sin(t * 3 + agent.index) * 0.015 + 0.015;
      // Face inward toward the table center
      agent.group.rotation.y = Math.atan2(-pos.x, -pos.z);
      agent.headMesh.rotation.y = Math.sin(t * 2.5 + agent.index) * 0.35;
      // Advance dialogue if symposium is running
      if (symposiumActive && agent.index === 0) advanceDialogue();
      agent.pauseTimer--;
      if (agent.pauseTimer <= 0) {
        agent.state = "walking-home";
        agent.target = new THREE.Vector3(...agent.config.home);
        agent.speechBubble.visible = false;
        hideHtmlBubble(agents.indexOf(agent));
        cleanupDialogue();
      }
      break;
    }
    case "walking-home": {
      const dir = agent.target.clone().sub(new THREE.Vector3(pos.x, 0, pos.z));
      const dist = dir.length();
      if (dist < 0.12) {
        pos.set(agent.config.home[0], getTerrainHeight(agent.config.home[0], agent.config.home[2]), agent.config.home[2]);
        agent.state = "idle";
        agent.idleTimer = WAITS[agent.index % WAITS.length] + Math.random() * 80;
        hideHtmlBubble(agents.indexOf(agent));
        checkSymposiumEnd();
      } else {
        dir.normalize();
        pos.x += dir.x * WALK_SPEED; pos.z += dir.z * WALK_SPEED;
        pos.y = getTerrainHeight(pos.x, pos.z) + Math.abs(Math.sin(t * 9)) * 0.04;
        agent.group.rotation.y = Math.atan2(dir.x, dir.z);
        agent.bodyMesh.rotation.z = Math.sin(t * 9) * 0.07;
      }
      break;
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Init
   ═══════════════════════════════════════════════════════════ */

function init() {
  clock = new THREE.Clock();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  updateSize();

  scene = new THREE.Scene();

  // ── Sky sphere (warm gradient, replaces flat background) ──
  const skyGeo = new THREE.SphereGeometry(110, 32, 16);
  const _skyUniforms = {
    uTop:     { value: new THREE.Color(0x5a8ab8) },   // warm medium blue overhead
    uHorizon: { value: new THREE.Color(0xd8ccb4) },   // warm cream at horizon
    uBottom:  { value: new THREE.Color(0xc0b898) },    // warm ground reflection
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
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos).y;
        vec3 col = h > 0.0
          ? mix(uHorizon, uTop, pow(h, 0.5))
          : mix(uHorizon, uBottom, pow(-h, 0.4));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Sun glow (emissive sphere — bloom picks it up)
  const sunGlowColor = new THREE.Color(0xfffae0).multiplyScalar(1.5);
  const sunGlow = new THREE.Mesh(
    new THREE.SphereGeometry(4, 12, 8),
    new THREE.MeshBasicMaterial({ color: sunGlowColor, fog: false }));
  const sunGlowDir = new THREE.Vector3(8, 8, 8).normalize();
  sunGlow.position.copy(sunGlowDir.clone().multiplyScalar(90));
  scene.add(sunGlow);

  // Atmospheric fog (warm, light density)
  scene.fog = new THREE.FogExp2(0xd0c8b4, 0.012);
  updateSceneBg(); // apply theme-correct colors

  camera = new THREE.PerspectiveCamera(28, canvas.clientWidth / canvas.clientHeight, 0.1, 250);
  camera.position.set(...DEFAULT_CAM.pos);
  camera.lookAt(...DEFAULT_CAM.target);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.05;
  controls.enablePan = true; controls.enableZoom = true;
  controls.panSpeed = 0.8;
  controls.minDistance = 3; controls.maxDistance = 55;
  controls.minPolarAngle = Math.PI / 8; controls.maxPolarAngle = Math.PI / 2.2;
  controls.autoRotate = !isReducedMotion; controls.autoRotateSpeed = 0.25;
  controls.target.set(...DEFAULT_CAM.target); controls.update();
  // Clamp pan boundaries so camera can't drift to infinity
  controls.addEventListener("change", () => {
    const t = controls.target;
    const BOUND = PLATFORM_R + 2;
    t.x = Math.max(-BOUND, Math.min(BOUND, t.x));
    t.z = Math.max(-BOUND, Math.min(BOUND, t.z));
    t.y = Math.max(-1, Math.min(5, t.y));
  });

  // 3-point lighting
  const hemiLight = new THREE.HemisphereLight(0xc8d8f0, 0x8a7a60, 0.4);
  scene.add(hemiLight);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
  sun.position.set(8, 8, 8);  // 35° elevation for longer shadows
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
  sun.shadow.radius = 6; sun.shadow.bias = -0.0003;
  scene.add(sun);

  const rimLight = new THREE.DirectionalLight(0xffd8a0, 0.25);
  rimLight.position.set(-8, 10, -10); rimLight.castShadow = false; scene.add(rimLight);

  const fillLight = new THREE.DirectionalLight(0xe0eaff, 0.25);
  fillLight.position.set(-6, 4, 6); scene.add(fillLight);

  // Build the world
  createTerrain();
  createStream();
  createPaths();
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

  // Districts
  const builders = [buildLiteratureDistrict, buildHypothesisDistrict, buildDesignDistrict, buildAnalysisDistrict];
  ROLES.forEach((role, i) => {
    const building = builders[i](role);
    scene.add(building); buildings.push(building);
    // Contact shadow under each district building
    const bldgShadow = makeContactShadow(1.2);
    bldgShadow.position.set(role.home[0], getTerrainHeight(role.home[0], role.home[2]) + 0.008, role.home[2]);
    scene.add(bldgShadow);
    const agent = createAgent(role, i);
    scene.add(agent.group); agents.push(agent);
  });

  if (isReducedMotion) {
    agents.forEach((a) => { a.state = "idle"; a.idleTimer = 99999; addPaperToTable(a); });
  }

  // Post-processing pipeline: render → bloom → color grade → tilt-shift → vignette
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth, canvas.clientHeight), 0.3, 0.4, 0.92);
  composer.addPass(bloomPass);
  const colorGradePass = new ShaderPass(ColorGradeShader);
  composer.addPass(colorGradePass);
  const tiltShiftPass = new ShaderPass(TiltShiftShader);
  composer.addPass(tiltShiftPass);
  const vignettePass = new ShaderPass(VignetteShader);
  composer.addPass(vignettePass);

  if (loading) loading.style.display = "none";
  animate();
}

/* ── Theme ─────────────────────────────────────────────── */
function updateSceneBg() {
  if (!scene) return;
  const isDark = document.documentElement.dataset.theme === "dark";
  // Sky sphere gradient
  if (skyUniforms) {
    skyUniforms.uTop.value.set(isDark ? 0x0a1828 : 0x5a8ab8);
    skyUniforms.uHorizon.value.set(isDark ? 0x1a2430 : 0xd8ccb4);
    skyUniforms.uBottom.value.set(isDark ? 0x0c1218 : 0xc0b898);
  }
  // Fog color matches horizon
  if (scene.fog) scene.fog.color.set(isDark ? 0x1a2430 : 0xd0c8b4);
  // Ocean
  if (oceanUniforms) {
    oceanUniforms.uColor.value.set(isDark ? 0x3a5568 : 0x7a9fb8);
    oceanUniforms.uColorDeep.value.set(isDark ? 0x2a3f50 : 0x5a7f98);
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
}
window.addEventListener("resize", updateSize);

/* ── Render loop ───────────────────────────────────────── */
function animate() {
  requestAnimationFrame(animate);
  if (!isVisible) return;
  const t = clock.getElapsedTime();
  controls.update();

  // Drive ocean shader
  if (oceanUniforms) oceanUniforms.uTime.value = t;
  // Drive wind system
  windUniforms.uWindTime.value = t;
  windUniforms.uGustPhase.value = t * 0.3; // gust wave traverses ~every 20s
  // Drive cloud shadows
  cloudShadowUniforms.uTime.value = t;

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
          // Wing flutter — rapid Y-axis rotation
          obj.mesh.rotation.y = bt * 3;
          obj.mesh.rotation.z = Math.sin(bt * 6) * 0.3;
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
    const dest = isOverview ? DEFAULT_CAM : OVERVIEW_CAM;
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
      agent.scroll.visible = true;
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

/* ── Click labels ──────────────────────────────────────── */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
canvas.addEventListener("click", (e) => {
  if (!camera || !scene) return;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  for (const agent of agents) {
    if (raycaster.intersectObject(agent.group, true).length > 0) { showLabel(agent.config.name, e); return; }
  }
  for (let i = 0; i < buildings.length; i++) {
    if (raycaster.intersectObject(buildings[i], true).length > 0) { showLabel(ROLES[i].name, e); return; }
  }
});
function showLabel(text, e) {
  const label = document.getElementById("cursorLabel");
  if (!label) return;
  label.textContent = text; label.classList.add("is-visible");
  label.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`;
  setTimeout(() => label.classList.remove("is-visible"), 1800);
}
