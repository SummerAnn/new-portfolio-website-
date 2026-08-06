import * as THREE from "three";
import { prefersReducedMotion } from "./ui-motion.js";

/* ═══════════════════════════════════════════════════════════
   Word Column — vertical typographic field
   Words drift in subtle sine waves, forming an organic column.
   No helix shape, no gimmick — just words and motion.
   ═══════════════════════════════════════════════════════════ */

const canvas = document.getElementById("heroHelixCanvas");
const container = document.getElementById("heroHelixContainer");
if (!canvas || !container) {
  throw new Error("Helix elements missing");
}

const COLORS = [0x5b8fa8, 0xc49a5c, 0x8b7baa, 0xc27c6e];

const WORDS = [
  "interaction tax", "multi-agent", "diversity", "convergence",
  "MoA", "critique", "debate", "flamebird",
  "agent4science", "runtime", "provenance", "ECG",
  "TCR", "genomics", "reproducibility", "compute",
  "evaluation", "SEI", "hypothesis", "synthesis",
  "knapsack", "3AP-free", "MIG", "safety",
  "audit", "pipeline", "checkpoint", "bedrock",
  "deva", "appSec", "embeddings", "prototype",
  "immune", "ataxia", "eye tracker", "gaze",
  "reward", "curriculum", "ablation", "scaling",
  "latent", "manifold", "topology", "metric",
];

let renderer, scene, camera, clock;
let wordSprites = [];
let animId = null;
let isVisible = false;

/* ── Word sprite ───────────────────────────────────────── */

function makeWordSprite(text, color, fontSize) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.font = `500 ${fontSize}px 'IBM Plex Mono', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillText(text.toUpperCase(), 256, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    })
  );
  return sprite;
}

/* ── Init ──────────────────────────────────────────────── */

function init() {
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();

  camera = new THREE.OrthographicCamera(-2, 2, 4, -4, 0.1, 50);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  buildWords();
  resize();
}

/* ── Build word field ──────────────────────────────────── */

function buildWords() {
  const count = WORDS.length;
  const totalHeight = 7.2;
  const startY = totalHeight / 2;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // 0 to 1
    const y = startY - t * totalHeight;

    const color = COLORS[i % COLORS.length];
    // Vary font size: larger in center, smaller at edges
    const centerDist = Math.abs(t - 0.5) * 2; // 0 at center, 1 at edges
    const fontSize = Math.round(22 + (1 - centerDist) * 8);

    const sprite = makeWordSprite(WORDS[i], color, fontSize);

    // Staggered horizontal offset for organic feel
    const xOffset = Math.sin(i * 0.7) * 0.4 + Math.cos(i * 0.3) * 0.2;
    sprite.position.set(xOffset, y, 0);

    // Scale based on font size
    const scale = 0.6 + (1 - centerDist) * 0.25;
    sprite.scale.set(scale * 1.4, scale * 0.16, 1);

    sprite.material.opacity = 0.3 + (1 - centerDist) * 0.5;

    sprite.userData = {
      baseX: xOffset,
      baseY: y,
      baseOpacity: 0.3 + (1 - centerDist) * 0.5,
      phase: i * 0.47,
      speed: 0.15 + (i % 5) * 0.06,
      amp: 0.12 + Math.sin(i * 1.1) * 0.06,
    };

    scene.add(sprite);
    wordSprites.push(sprite);
  }
}

/* ── Resize ────────────────────────────────────────────── */

function resize() {
  const rect = container.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  if (w === 0 || h === 0) return;

  renderer.setSize(w, h);
  const aspect = w / h;
  const vSize = 4;
  camera.left = -vSize * aspect;
  camera.right = vSize * aspect;
  camera.top = vSize;
  camera.bottom = -vSize;
  camera.updateProjectionMatrix();
}

/* ── Animate ───────────────────────────────────────────── */

function animate() {
  if (!isVisible) return;
  animId = requestAnimationFrame(animate);

  const t = clock.getElapsedTime();

  if (!prefersReducedMotion()) {
    for (const sp of wordSprites) {
      const d = sp.userData;
      // Gentle horizontal wave
      sp.position.x = d.baseX + Math.sin(t * d.speed + d.phase) * d.amp;
      // Very subtle vertical drift
      sp.position.y = d.baseY + Math.sin(t * 0.2 + d.phase * 0.5) * 0.03;
      // Opacity pulse
      sp.material.opacity = d.baseOpacity + Math.sin(t * 0.4 + d.phase) * 0.12;
    }
  }

  renderer.render(scene, camera);
}

function start() {
  isVisible = true;
  clock.start();
  animate();
}

function stop() {
  isVisible = false;
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

try {
  init();

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) start();
      else stop();
    },
    { threshold: 0.1 }
  );
  observer.observe(container);

  window.addEventListener("resize", resize);
} catch (e) {
  console.warn("Helix init skipped:", e.message);
}
