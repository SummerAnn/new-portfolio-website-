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

/* ── Article Rendering ─────────────────────────────────── */

const articleContent = document.querySelector("#articleContent");
const articleToc = document.querySelector("#articleToc");
const articleAside = document.querySelector("#articleAside");
const footerYear = document.querySelector("#footerYear");

const tocLabel = (str, maxLen) => {
  const words = str.split(" ");
  let result = "";
  for (const word of words) {
    if ((result + " " + word).trim().length > maxLen) break;
    result = (result + " " + word).trim();
  }
  return result + "\u2026";
};

const renderArticle = (note) => {
  if (!articleContent) return;

  document.title = `${note.title} \u2014 Summer Ann`;

  articleContent.innerHTML = `
    <div class="article-header">
      <a class="article-back" href="./journal.html">\u2190 Journal</a>
      <div class="article-meta">
        <span>${note.kicker}</span>
        <span>${note.date}</span>
        <span>${note.readTime}</span>
      </div>
      <h1 class="article-title">${note.title}</h1>
      <p class="article-lede">${note.excerpt}</p>
      <div class="article-tags">
        ${note.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
      </div>
    </div>
    <div class="article-body">
      ${note.body
        .map(
          (paragraph, i) =>
            `<p id="section-${i + 1}">${paragraph}</p>`
        )
        .join("")}
    </div>
  `;

  if (articleToc) {
    articleToc.innerHTML = `
      <div class="article-toc__inner">
        <span class="article-toc__label">Contents <img class="sidebar-doodle" src="./assets/icons/6.png" alt="" /></span>
        <nav class="article-toc__nav">
          ${note.body
            .map((paragraph, i) => {
              const label = tocLabel(paragraph, 36);
              return `<a class="article-toc__item" href="#section-${i + 1}">${String(i + 1).padStart(2, "0")} ${label}</a>`;
            })
            .join("")}
        </nav>
      </div>
    `;
  }

  if (articleAside) {
    articleAside.innerHTML = `
      <div class="article-aside__inner">
        <span class="article-aside__label">Author <img class="sidebar-doodle" src="./assets/icons/11.png" alt="" /></span>
        <p class="article-aside__name">Summer Ann</p>
        <p class="article-aside__role">PhD Researcher, UChicago CS</p>
        <div class="article-aside__links">
          <a href="./index.html">Portfolio</a>
          <a href="./journal.html">All notes</a>
        </div>
      </div>
      <img class="sidebar-doodle sidebar-doodle--bottom" src="./assets/icons/21.png" alt="" />
    `;
  }

  document.querySelectorAll(".article-toc__item").forEach((link) => {
    link.addEventListener("click", (e) => {
      const targetId = link.getAttribute("href");
      if (!targetId) return;
      const target = document.querySelector(targetId);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    });
  });
};

const slug = window.location.hash.replace("#", "");
if (slug) {
  const note = notes.find((n) => n.slug === slug);
  if (note) renderArticle(note);
}

window.addEventListener("hashchange", () => {
  const newSlug = window.location.hash.replace("#", "");
  const note = notes.find((n) => n.slug === newSlug);
  if (note) renderArticle(note);
});

if (footerYear) {
  footerYear.textContent = String(new Date().getFullYear());
}
