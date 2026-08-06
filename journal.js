import { notes } from "./content.js";
import { prefersReducedMotion, setupMotionPreferences } from "./ui-motion.js";

setupMotionPreferences();

/* ── Theme Toggle ──────────────────────────────────────── */

const themeToggle = document.querySelector("#themeToggle");

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  });
}

/* ── Journal List Rendering ───────────────────────────── */

const journalList = document.querySelector("#journalList");
const filterRow = document.querySelector("#filterRow");
const footerYear = document.querySelector("#footerYear");

const renderEntry = (note) => `
  <a class="journal-entry" href="./article.html#${note.slug}" data-category="${note.category}">
    <div class="journal-entry__meta">
      <span>${note.kicker}</span>
      <span>${note.date}</span>
      <span>${note.readTime}</span>
    </div>
    <h2 class="journal-entry__title">${note.title}</h2>
    <p class="journal-entry__excerpt">${note.excerpt}</p>
  </a>
`;

if (journalList) {
  journalList.innerHTML = notes.map(renderEntry).join("");
}

if (footerYear) {
  footerYear.textContent = String(new Date().getFullYear());
}

/* ── Filter ───────────────────────────────────────────── */

if (filterRow && journalList) {
  filterRow.addEventListener("click", (event) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement)) return;
    const filter = button.dataset.filter;
    if (!filter) return;

    filterRow.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip === button);
    });

    journalList.querySelectorAll(".journal-entry").forEach((entry) => {
      const matches =
        filter === "all" ||
        entry.getAttribute("data-category") === filter;
      entry.classList.toggle("is-hidden", !matches);
    });
  });
}

/* ── GSAP Animations ───────────────────────────────────── */

const setupGsap = () => {
  if (!window.gsap || prefersReducedMotion()) return;

  const { gsap } = window;
  const ST = window.ScrollTrigger;
  if (ST) gsap.registerPlugin(ST);

  gsap.from(".journal-index__header-text", {
    y: 30,
    opacity: 0,
    duration: 0.8,
    ease: "expo.out",
    delay: 0.3,
  });

  const journalPhoto = document.querySelector("#journalPhoto");
  if (journalPhoto) {
    journalPhoto.classList.add("is-revealed");
  }

  if (ST) {
    gsap.utils.toArray(".journal-entry").forEach((item) => {
      gsap.from(item, {
        y: 20,
        opacity: 0,
        duration: 0.6,
        ease: "expo.out",
        scrollTrigger: {
          trigger: item,
          start: "top 90%",
        },
      });
    });
  }
};

window.addEventListener("load", setupGsap);
