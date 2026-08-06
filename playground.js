/**
 * Interaction Tax — Experiment Simulator
 * App-like mockup demonstrating how communication protocols
 * affect solution diversity across model families.
 * Data calibrated to actual ICML 2026 paper findings.
 */

const AGENTS = [
  { model: "Claude",  family: 0 },
  { model: "GPT-4o",  family: 1 },
  { model: "Gemini",  family: 2 },
  { model: "Claude",  family: 0 },
  { model: "GPT-4o",  family: 1 },
  { model: "Gemini",  family: 2 },
];

/* Initial solution scores — spread across families.
   Claude agents cluster high, GPT-4o mid, Gemini variable.
   This mirrors paper finding: different families find
   structurally different solutions. */
const INITIAL_SCORES = [0.82, 0.58, 0.93, 0.71, 0.52, 0.87];
const TOTAL_ROUNDS = 5;

const PROTOCOLS = {
  "full-exchange": {
    convergence: 0.38,
    towardMean: true,
    shiftProb: 1.0,
    insight: "Full-solution exchange collapsed diversity within 2 rounds. Chain, MAgICoRe, and Debate all produce negative diverse-model MIG. The damage comes from the exchange step, not synthesis.",
  },
  "critique": {
    convergence: 0.10,
    towardMean: false,
    shiftProb: 0.50,
    insight: "Critique helps when the fault is easy to locate \u2014 Knapsack (clear constraint violation) improves to 10/10 feasibility. But 3AP-Free (hard to find triple) drops to 0/10. Same signal, different outcomes.",
  },
  "independent": {
    convergence: 0,
    towardMean: false,
    shiftProb: 0,
    insight: "Independent generation preserves full solution diversity. No communication overhead, no convergence pressure. This is the baseline for measuring the interaction tax.",
  },
  "moa": {
    convergence: 0,
    towardMean: false,
    shiftProb: 0,
    insight: "MoA keeps proposers independent \u2014 they never see each other\u2019s outputs. Synthesis happens separately. The only configuration whose diverse-model MIG stays positive (+0.08).",
  },
};

/* ── State ────────────────────────────────────────────── */

let scores = [...INITIAL_SCORES];
let currentRound = 0;
let currentProtocol = "full-exchange";
let running = false;
let initialDiv = 0;

/* ── DOM ──────────────────────────────────────────────── */

const container = document.querySelector("#experimentSim");
if (container) {

const agentsEl   = document.querySelector("#expAgents");
const roundLabel = document.querySelector("#expRoundLabel");
const divBar     = document.querySelector("#expDivBar");
const divVal     = document.querySelector("#expDivVal");
const taxBar     = document.querySelector("#expTaxBar");
const taxVal     = document.querySelector("#expTaxVal");
const insightEl  = document.querySelector("#expInsight");
const runBtn     = document.querySelector("#expRun");
const resetBtn   = document.querySelector("#expReset");
const tabsEl     = document.querySelector("#expTabs");

/* ── Diversity calc ───────────────────────────────────── */

const calcDiv = (arr) => {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
};

/* ── Render agents ────────────────────────────────────── */

const renderAgents = () => {
  if (!agentsEl) return;
  agentsEl.innerHTML = AGENTS.map((agent, i) => `
    <div class="experiment__agent" data-family="${agent.family}">
      <span class="experiment__agent-label">${agent.model}</span>
      <div class="experiment__agent-bar">
        <div class="experiment__agent-fill" id="agentBar${i}" style="width:${scores[i] * 100}%"></div>
      </div>
      <span class="experiment__agent-score" id="agentScore${i}">${scores[i].toFixed(2)}</span>
    </div>
  `).join("");
};

/* ── Update UI ────────────────────────────────────────── */

const updateUI = () => {
  AGENTS.forEach((_, i) => {
    const bar = document.querySelector(`#agentBar${i}`);
    const score = document.querySelector(`#agentScore${i}`);
    if (bar) bar.style.width = `${scores[i] * 100}%`;
    if (score) score.textContent = scores[i].toFixed(2);
  });

  const div = calcDiv(scores);
  const divNorm = initialDiv > 0 ? Math.min(1, div / initialDiv) : 1;
  const tax = Math.max(0, 1 - divNorm);

  if (divBar) divBar.style.width = `${divNorm * 100}%`;
  if (divVal) divVal.textContent = divNorm.toFixed(2);
  if (taxBar) taxBar.style.width = `${tax * 100}%`;
  if (taxVal) taxVal.textContent = `${Math.round(tax * 100)}%`;

  if (roundLabel) {
    const status = currentRound === 0 ? "Ready" : currentRound >= TOTAL_ROUNDS ? "Complete" : "Running";
    roundLabel.textContent = `${status} \u2014 Round ${currentRound} / ${TOTAL_ROUNDS}`;
  }
};

/* ── Simulation step ──────────────────────────────────── */

const runRound = () => {
  const proto = PROTOCOLS[currentProtocol];
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;

  if (proto.towardMean) {
    scores = scores.map((s) => {
      const delta = (mean - s) * proto.convergence;
      return Math.max(0.05, Math.min(0.99, s + delta));
    });
  } else if (proto.shiftProb > 0) {
    for (let p = 0; p < 3; p++) {
      const a = Math.floor(Math.random() * 6);
      let b = Math.floor(Math.random() * 5);
      if (b >= a) b++;
      if (Math.random() < proto.shiftProb) {
        const delta = (scores[a] - scores[b]) * proto.convergence;
        scores[b] = Math.max(0.05, Math.min(0.99, scores[b] + delta));
      }
    }
  } else {
    scores = scores.map((s) => {
      const drift = (Math.random() - 0.5) * 0.04;
      return Math.max(0.05, Math.min(0.99, s + drift));
    });
  }

  currentRound++;
};

/* ── Run experiment ───────────────────────────────────── */

const runExperiment = async () => {
  if (running) return;
  running = true;
  if (runBtn) runBtn.disabled = true;

  scores = [...INITIAL_SCORES];
  currentRound = 0;
  initialDiv = calcDiv(scores);
  renderAgents();
  updateUI();

  if (insightEl) insightEl.textContent = "Running\u2026";

  for (let i = 0; i < TOTAL_ROUNDS; i++) {
    await new Promise((r) => setTimeout(r, 550));
    runRound();
    updateUI();
  }

  if (insightEl) insightEl.textContent = PROTOCOLS[currentProtocol].insight;

  running = false;
  if (runBtn) runBtn.disabled = false;
};

/* ── Reset ────────────────────────────────────────────── */

const resetExperiment = () => {
  if (running) return;
  scores = [...INITIAL_SCORES];
  currentRound = 0;
  initialDiv = calcDiv(scores);
  renderAgents();
  updateUI();
  if (insightEl) insightEl.textContent = "Select a protocol and run to see how communication affects solution diversity across model families.";
};

/* ── Tab switching ────────────────────────────────────── */

if (tabsEl) {
  tabsEl.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-protocol]");
    if (!tab || running) return;
    currentProtocol = tab.dataset.protocol;
    tabsEl.querySelectorAll(".experiment__tab").forEach((t) =>
      t.classList.toggle("is-active", t === tab)
    );
    resetExperiment();
  });
}

if (runBtn) runBtn.addEventListener("click", runExperiment);
if (resetBtn) resetBtn.addEventListener("click", resetExperiment);

/* ── Init ─────────────────────────────────────────────── */

initialDiv = calcDiv(scores);
renderAgents();
updateUI();

} // end container check
