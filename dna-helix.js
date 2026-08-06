import { prefersReducedMotion } from "./ui-motion.js";

/* ═══════════════════════════════════════════════════════════
   DNA Helix Word Formation — hero background
   Two helical strands of research terms with connecting rungs,
   depth-simulated via scale/opacity, slowly rotating.
   CSS/JS 2D approach — no 3D libraries needed.
   ═══════════════════════════════════════════════════════════ */

const WORDS = [
  "Interaction Tax", "Multi-Agent", "Compute Budget",
  "Flamebird", "Agent4Science", "DevSecCode",
  "Persistent Runtime", "LLM Debate", "Marginal Gain",
  "Mixture-of-Agents", "Critique Loop", "Epistemic",
  "Verifier-Scored", "Proposal Diversity", "Hill Climbing",
  "Static Analysis", "Secrets Detection", "Biomedical ML",
  "Solution Exchange", "Independent Sampling", "Task Budget",
  "Scientific Discovery", "Long-Horizon", "Agent State",
  "Convergence", "Evaluation", "Benchmark",
  "Collaboration", "Optimization", "Reproducibility",
];

const container = document.getElementById("heroDna");
if (container && !prefersReducedMotion()) {
  const HELIX_RADIUS = 140;      // px — radius of each strand
  const HELIX_PITCH = 44;        // px per radian of vertical advance
  const TOTAL_TURNS = 3.5;       // how many full turns
  const TOTAL_RUNGS = WORDS.length;
  const ROTATION_PERIOD = 70;    // seconds per full rotation (slow)

  // Monochrome gray — single shared value, never per-word
  const WORD_COLOR = "#999";

  const wordEls = [];
  const rungEls = [];

  for (let i = 0; i < TOTAL_RUNGS; i++) {
    const t = (i / TOTAL_RUNGS) * TOTAL_TURNS * Math.PI * 2;

    // Strand A word
    const wordA = document.createElement("span");
    wordA.className = "dna-word";
    wordA.textContent = WORDS[i];
    wordA.style.color = WORD_COLOR;
    container.appendChild(wordA);

    // Strand B word (opposite strand, offset by half the total words)
    const wordB = document.createElement("span");
    wordB.className = "dna-word";
    wordB.textContent = WORDS[(i + Math.floor(TOTAL_RUNGS / 2)) % TOTAL_RUNGS];
    wordB.style.color = WORD_COLOR;
    container.appendChild(wordB);

    // Connecting rung — short line between the two strand endpoints
    const rung = document.createElement("div");
    rung.className = "dna-rung";
    container.appendChild(rung);

    wordEls.push({ a: wordA, b: wordB, t, i });
    rungEls.push(rung);
  }

  let centerX = 0, centerY = 0;

  function measure() {
    const rect = container.getBoundingClientRect();
    centerX = rect.width * 0.5;
    centerY = rect.height * 0.5;
  }
  measure();

  let phase = 0;
  let lastTime = performance.now();

  function updatePositions() {
    const totalHeight = TOTAL_TURNS * Math.PI * 2 * HELIX_PITCH;
    const startY = centerY - totalHeight / 2;

    for (let i = 0; i < wordEls.length; i++) {
      const { a, b, t } = wordEls[i];
      const rung = rungEls[i];

      const angle = t + phase;
      const angleB = angle + Math.PI; // opposite strand

      // Vertical position (along helix axis)
      const y = startY + (t / (TOTAL_TURNS * Math.PI * 2)) * totalHeight;

      // Horizontal position — helix projection
      const xA = centerX + Math.cos(angle) * HELIX_RADIUS;
      const xB = centerX + Math.cos(angleB) * HELIX_RADIUS;

      // Depth (z) via sin — -1 (back) to 1 (front)
      const zA = Math.sin(angle);
      const zB = Math.sin(angleB);

      // Scale: front = 0.9, back = 0.5
      const scaleA = 0.5 + (zA + 1) * 0.2;
      const scaleB = 0.5 + (zB + 1) * 0.2;

      // Opacity: front = 0.10, back = 0.03 (very subtle, behind headline)
      const opacityA = 0.03 + (zA + 1) * 0.035;
      const opacityB = 0.03 + (zB + 1) * 0.035;

      // Z-index: front words on top
      const zIndexA = zA > 0 ? 2 : 1;
      const zIndexB = zB > 0 ? 2 : 1;

      a.style.transform = `translate(-50%, -50%) translate(${xA}px, ${y}px) scale(${scaleA})`;
      a.style.opacity = opacityA;
      a.style.zIndex = zIndexA;

      b.style.transform = `translate(-50%, -50%) translate(${xB}px, ${y}px) scale(${scaleB})`;
      b.style.opacity = opacityB;
      b.style.zIndex = zIndexB;

      // Rung — only show when both strands are near the same depth plane
      // (near crossover, where zA ≈ 0), and only connect between words, not through them.
      // Shrink the rung inward from each word to avoid crossing text.
      const rungVisibility = Math.max(0, 0.06 - Math.abs(zA) * 0.08);

      if (rungVisibility > 0.001) {
        // Inset the rung endpoints so they don't overlap word bounding boxes
        const wordInset = 50; // px to pull inward from each word center
        const rawLeft = Math.min(xA, xB);
        const rawRight = Math.max(xA, xB);
        const rungLeft = rawLeft + wordInset;
        const rungWidth = Math.max(0, (rawRight - wordInset) - rungLeft);

        rung.style.transform = `translate(0, ${y}px)`;
        rung.style.left = `${rungLeft}px`;
        rung.style.width = `${rungWidth}px`;
        rung.style.opacity = rungVisibility;
        rung.style.display = rungWidth > 10 ? "" : "none";
      } else {
        rung.style.display = "none";
      }
    }
  }

  function tick(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    phase += (Math.PI * 2 / ROTATION_PERIOD) * dt;
    updatePositions();
    requestAnimationFrame(tick);
  }

  // Parallax on scroll
  window.addEventListener("scroll", () => {
    const scrollOffset = window.scrollY * 0.15;
    container.style.transform = `translateY(${-scrollOffset}px)`;
  }, { passive: true });

  window.addEventListener("resize", () => {
    measure();
    updatePositions();
  });

  requestAnimationFrame(tick);
}
