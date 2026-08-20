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
const sortRow = document.querySelector("#sortRow");
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

/* ── Sorting helpers ──────────────────────────────────── */

const MONTH_ORDER = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseDateValue(dateStr) {
  // "August 19, 2026", "July 2026", "Summer 2023" etc.
  const parts = dateStr.toLowerCase().replace(",", "").split(/\s+/);
  const year = parseInt(parts.find((p) => /^\d{4}$/.test(p)) || "0", 10);
  const monthStr = parts.find((p) => p in MONTH_ORDER);
  const month = monthStr ? MONTH_ORDER[monthStr] : 6; // default mid-year
  const dayStr = parts.find((p) => /^\d{1,2}$/.test(p));
  const day = dayStr ? parseInt(dayStr, 10) : 15; // default mid-month
  return year * 372 + month * 31 + day;
}

function parseReadMin(readTime) {
  const m = readTime.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function sortNotes(list, mode) {
  const sorted = [...list];
  if (mode === "recent") {
    sorted.sort((a, b) => parseDateValue(b.date) - parseDateValue(a.date));
  } else if (mode === "oldest") {
    sorted.sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date));
  } else if (mode === "popular") {
    sorted.sort((a, b) => parseReadMin(b.readTime) - parseReadMin(a.readTime));
  }
  return sorted;
}

/* ── State ────────────────────────────────────────────── */

let currentSort = "recent";
let currentFilter = "all";

function renderList() {
  if (!journalList) return;
  const sorted = sortNotes(notes, currentSort);
  journalList.innerHTML = sorted.map(renderEntry).join("");
  applyFilter();
}

function applyFilter() {
  if (!journalList) return;
  journalList.querySelectorAll(".journal-entry").forEach((entry) => {
    const matches =
      currentFilter === "all" ||
      entry.getAttribute("data-category") === currentFilter;
    entry.classList.toggle("is-hidden", !matches);
  });
}

renderList();

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

    currentFilter = filter;

    filterRow.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip === button);
    });

    applyFilter();
  });
}

/* ── Sort ─────────────────────────────────────────────── */

if (sortRow && journalList) {
  sortRow.addEventListener("click", (event) => {
    const button = event.target;
    if (!(button instanceof HTMLButtonElement)) return;
    const sort = button.dataset.sort;
    if (!sort) return;

    currentSort = sort;

    sortRow.querySelectorAll(".filter-chip").forEach((chip) => {
      chip.classList.toggle("is-active", chip === button);
    });

    renderList();
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

/* ── Subscribe Form ──────────────────────────────────── */

const subForm = document.querySelector("#subscribeForm");
if (subForm) {
  subForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = subForm.querySelector('input[name="email"]').value;
    if (!email) return;
    const subs = JSON.parse(localStorage.getItem("subscribers") || "[]");
    if (!subs.includes(email)) {
      subs.push(email);
      localStorage.setItem("subscribers", JSON.stringify(subs));
    }
    const parent = subForm.parentElement;
    subForm.remove();
    const msg = document.createElement("p");
    msg.className = "subscribe-success";
    msg.textContent = "You're in. I'll email you when something new goes up.";
    parent.insertBefore(msg, parent.querySelector(".subscribe-rss"));
  });
}
