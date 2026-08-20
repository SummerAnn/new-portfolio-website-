import { notes, research, startups, apps, experience } from "./content.js";
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


/* ── Contextual Cursor (desktop only) ──────────────────── */

const cursorLabel = document.querySelector("#cursorLabel");

if (cursorLabel && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.addEventListener("mousemove", (e) => {
    cursorLabel.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`;
  });

  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-cursor]");
    if (target) {
      cursorLabel.textContent = target.dataset.cursor;
      cursorLabel.classList.add("is-visible");
    } else {
      cursorLabel.classList.remove("is-visible");
    }
  });
}

/* ── Magnetic Hover + Text Scramble (nav — desktop only) ── */

const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

if (isDesktop) {
  /* Magnetic: each nav item pulls toward cursor, springs back */
  document.querySelectorAll(".nav__links a, .nav__links button").forEach((el) => {
    el.addEventListener("mousemove", (e) => {
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const tx = Math.max(-10, Math.min(10, dx * 0.2));
      const ty = Math.max(-8, Math.min(8, dy * 0.3));
      el.style.transition = "transform 80ms ease-out";
      el.style.transform = `translate(${tx}px, ${ty}px)`;
    });

    el.addEventListener("mouseleave", () => {
      el.style.transition = "transform 400ms cubic-bezier(0.16, 1, 0.3, 1)";
      el.style.transform = "translate(0, 0)";
    });
  });

  /* Text scramble: on hover, characters cycle through random glyphs
     before resolving to the real letter, staggered left-to-right. */
  const scrambleChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  document.querySelectorAll(".nav__links a").forEach((link) => {
    const original = link.textContent.trim();
    let active = false;

    link.addEventListener("mouseenter", () => {
      if (active) return;
      active = true;
      const len = original.length;
      const stepMs = 350 / (len + 3);
      let resolved = 0;

      const interval = setInterval(() => {
        let out = "";
        for (let i = 0; i < len; i++) {
          if (i < resolved) {
            out += original[i];
          } else if (original[i] === " ") {
            out += " ";
          } else {
            out += scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
          }
        }
        link.textContent = out;
        resolved++;
        if (resolved > len + 2) {
          clearInterval(interval);
          link.textContent = original;
          active = false;
        }
      }, stepMs);
    });
  });
}

/* ── Content Rendering ─────────────────────────────────── */

const researchGrid = document.querySelector("#researchGrid");
const startupGrid = document.querySelector("#startupGrid");
const homeNotes = document.querySelector("#homeNotes");
const footerYear = document.querySelector("#footerYear");

if (researchGrid) {
  researchGrid.innerHTML = research
    .map(
      (entry, index) => `
        <article class="research-entry" data-cursor="view">
          <span class="research-entry__number">${String(index + 1).padStart(2, "0")}</span>
          <div class="research-entry__content">
            <div class="research-entry__meta">
              <span>${entry.year}</span>
              <span>${entry.venue}</span>
              <span>${entry.role}</span>
            </div>
            <h3 class="research-entry__title">${entry.link ? `<a href="${entry.link}" target="_blank" rel="noopener noreferrer">${entry.title}</a>` : entry.title}</h3>
            <p class="research-entry__desc">${entry.blurb}</p>
            <div class="tag-row">
              ${entry.stack.map((item) => `<span class="tag">${item}</span>`).join("")}
            </div>
            ${entry.link ? `<a class="research-entry__link" href="${entry.link}" target="_blank" rel="noopener noreferrer">View &#8594;</a>` : ""}
            <button class="research-entry__toggle" data-details="details-${index}">+ Details</button>
            <ul class="research-entry__details" id="details-${index}">
              ${entry.details.map((item) => `<li>${item}</li>`).join("")}
            </ul>
          </div>
        </article>
      `,
    )
    .join("");
}

// Toggle research details
document.querySelectorAll(".research-entry__toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const details = document.getElementById(btn.dataset.details);
    if (!details) return;
    const isOpen = details.classList.toggle("is-open");
    btn.textContent = isOpen ? "- Details" : "+ Details";
  });
});

if (startupGrid) {
  startupGrid.innerHTML = startups
    .map(
      (entry) => `
        <article class="startup-entry">
          <span class="startup-entry__type">${entry.type}</span>
          <h3 class="startup-entry__title">${entry.title}</h3>
          <p class="startup-entry__desc">${entry.blurb}</p>
        </article>
      `,
    )
    .join("");

  /* ── Startup Carousel: drag-to-scroll ── */
  let sIsDragging = false, sStartX = 0, sScrollStart = 0, sHasDragged = false;

  startupGrid.addEventListener("mousedown", (e) => {
    sIsDragging = true;
    sHasDragged = false;
    sStartX = e.pageX - startupGrid.offsetLeft;
    sScrollStart = startupGrid.scrollLeft;
    startupGrid.style.scrollBehavior = "auto";
  });

  startupGrid.addEventListener("mousemove", (e) => {
    if (!sIsDragging) return;
    e.preventDefault();
    const x = e.pageX - startupGrid.offsetLeft;
    const walk = (x - sStartX) * 1.5;
    if (Math.abs(walk) > 4) sHasDragged = true;
    startupGrid.scrollLeft = sScrollStart - walk;
  });

  const stopStartupDrag = () => {
    sIsDragging = false;
    startupGrid.style.scrollBehavior = "smooth";
  };
  startupGrid.addEventListener("mouseup", stopStartupDrag);
  startupGrid.addEventListener("mouseleave", stopStartupDrag);

  startupGrid.addEventListener("click", (e) => {
    if (sHasDragged) e.preventDefault();
  }, true);

  /* ── Startup Carousel: dot indicators ── */
  const startupDotsWrap = document.querySelector("#startupDots");
  if (startupDotsWrap) {
    const cards = startupGrid.querySelectorAll(".startup-entry");
    cards.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.className = "carousel-dot" + (i === 0 ? " is-active" : "");
      dot.ariaLabel = `Go to startup ${i + 1}`;
      dot.addEventListener("click", () => {
        cards[i].scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      });
      startupDotsWrap.appendChild(dot);
    });

    const dots = startupDotsWrap.querySelectorAll(".carousel-dot");
    startupGrid.addEventListener("scroll", () => {
      const scrollLeft = startupGrid.scrollLeft;
      const cardWidth = cards[0].offsetWidth + 24;
      const activeIdx = Math.round(scrollLeft / cardWidth);
      dots.forEach((d, i) => d.classList.toggle("is-active", i === activeIdx));
    });
  }
}

const appsGrid = document.querySelector("#appsGrid");
if (appsGrid) {
  appsGrid.innerHTML = apps
    .map(
      (entry) => `
        <a class="app-entry" href="${entry.link}" target="_blank" rel="noopener" data-cursor="open">
          <h3 class="app-entry__title">${entry.title}</h3>
          <p class="app-entry__desc">${entry.desc}</p>
          <span class="app-entry__link">${entry.linkLabel}</span>
        </a>
      `,
    )
    .join("");

  /* ── Carousel: drag-to-scroll ── */
  let isDragging = false, startX = 0, scrollStart = 0, hasDragged = false;

  appsGrid.addEventListener("mousedown", (e) => {
    isDragging = true;
    hasDragged = false;
    startX = e.pageX - appsGrid.offsetLeft;
    scrollStart = appsGrid.scrollLeft;
    appsGrid.style.scrollBehavior = "auto";
  });

  appsGrid.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - appsGrid.offsetLeft;
    const walk = (x - startX) * 1.5;
    if (Math.abs(walk) > 4) hasDragged = true;
    appsGrid.scrollLeft = scrollStart - walk;
  });

  const stopDrag = () => {
    isDragging = false;
    appsGrid.style.scrollBehavior = "smooth";
  };
  appsGrid.addEventListener("mouseup", stopDrag);
  appsGrid.addEventListener("mouseleave", stopDrag);

  // Prevent click navigation when dragging
  appsGrid.addEventListener("click", (e) => {
    if (hasDragged) e.preventDefault();
  }, true);

  /* ── Carousel: dot indicators ── */
  const dotsWrap = document.querySelector("#carouselDots");
  if (dotsWrap) {
    const cards = appsGrid.querySelectorAll(".app-entry");
    cards.forEach((_, i) => {
      const dot = document.createElement("button");
      dot.className = "carousel-dot" + (i === 0 ? " is-active" : "");
      dot.ariaLabel = `Go to app ${i + 1}`;
      dot.addEventListener("click", () => {
        cards[i].scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      });
      dotsWrap.appendChild(dot);
    });

    const dots = dotsWrap.querySelectorAll(".carousel-dot");
    appsGrid.addEventListener("scroll", () => {
      const scrollLeft = appsGrid.scrollLeft;
      const cardWidth = cards[0].offsetWidth + 24; // card + gap
      const activeIdx = Math.round(scrollLeft / cardWidth);
      dots.forEach((d, i) => d.classList.toggle("is-active", i === activeIdx));
    });
  }
}

const experienceRow = document.querySelector("#experienceRow");
if (experienceRow) {
  experienceRow.innerHTML = experience
    .map(
      (entry) => `
        <div class="experience-item">
          <span class="experience-item__title">${entry.title}</span>
          <span class="experience-item__role">${entry.role}</span>
          <span class="experience-item__desc">${entry.blurb}</span>
        </div>
      `,
    )
    .join("");
}

if (homeNotes) {
  homeNotes.innerHTML = notes
    .slice(-3).reverse()
    .map(
      (note) => `
        <article class="note-preview" data-cursor="read">
          <div class="note-preview__meta">
            <span>${note.kicker}</span>
            <span>${note.date}</span>
          </div>
          <h3>${note.title}</h3>
          <p>${note.excerpt}</p>
          <a class="note-preview__link" href="./article.html#${note.slug}">Read note</a>
        </article>
      `,
    )
    .join("");
}

if (footerYear) {
  footerYear.textContent = String(new Date().getFullYear());
}

/* ── Daily Quote Randomizer ───────────────────────────── */

const DAILY_QUOTES = [
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "Vision without action is a daydream. Action without vision is a nightmare.", author: "Japanese proverb" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Aristotle" },
  { text: "Learn from yesterday, live for today, hope for tomorrow.", author: "Albert Einstein" },
  { text: "To accomplish great things, we must not only act, but also dream; not only plan, but also believe.", author: "Anatole France" },
  { text: "Your vision will become clear only when you look into your heart. Who looks outside, dreams. Who looks inside, awakens.", author: "Carl Jung" },
  { text: "Each time we face a fear, we gain strength, courage, and confidence in the doing.", author: "Unknown" },
  { text: "Never mistake activity for achievement.", author: "John Wooden" },
  { text: "What we achieve inwardly will change outer reality.", author: "Plutarch" },
  { text: "All great achievements require time.", author: "Maya Angelou" },
  { text: "The reasonable man adapts himself to the world; the unreasonable man persists in trying to adapt the world to himself. Therefore, all progress depends on the unreasonable man.", author: "George Shaw" },
  { text: "Good actions give strength to ourselves and inspire good actions in others.", author: "Plato" },
  { text: "It is impossible for a man to learn what he thinks he already knows.", author: "Epictetus" },
  { text: "Risk more than others think is safe. Care more than others think is wise. Dream more than others think is practical. Expect more than others think is possible.", author: "Cadet Maxim" },
  { text: "Life is a succession of moments. To live each one is to succeed.", author: "Corita Kent" },
  { text: "The purpose of learning is growth, and our minds, unlike our bodies, can continue growing as we continue to live.", author: "Mortimer Adler" },
  { text: "If one advances confidently in the direction of his dream, and endeavours to live the life which he had imagined, he will meet with a success unexpected in common hours.", author: "Henry David Thoreau" },
  { text: "Do not dwell in the past, do not dream of the future, concentrate the mind on the present moment.", author: "Buddha" },
  { text: "There is nothing impossible to him who will try.", author: "Alexander the Great" },
  { text: "Goals are the fuel in the furnace of achievement.", author: "Brian Tracy" },
  { text: "To succeed, we must first believe that we can.", author: "Michael Korda" },
  { text: "Failure will never overtake me if my determination to succeed is strong enough.", author: "Og Mandino" },
  { text: "Gratitude makes sense of our past, brings peace for today, and creates a vision for tomorrow.", author: "Melody Beattie" },
  { text: "Four steps to achievement: Plan purposefully. Prepare prayerfully. Proceed positively. Pursue persistently.", author: "William Arthur Ward" },
  { text: "A little more persistence, a little more effort, and what seemed hopeless failure may turn to glorious success.", author: "Elbert Hubbard" },
  { text: "Aim for success, not perfection. Never give up your right to be wrong, because then you will lose the ability to learn new things and move forward with your life.", author: "Dr. David M. Burns" },
  { text: "The secret of joy in work is contained in one word — excellence. To know how to do something well is to enjoy it.", author: "Pearl Buck" },
  { text: "If your actions inspire others to dream more, learn more, do more and become more, you are a leader.", author: "John Quincy Adams" },
  { text: "Cherish your visions and your dreams as they are the children of your soul, the blueprints of your ultimate achievements.", author: "Napoleon Hill" },
  { text: "Success means having the courage, the determination, and the will to become the person you believe you were meant to be.", author: "George Sheehan" },
];

const dailyQuote = document.querySelector("#dailyQuote");
if (dailyQuote) {
  // Pick a random quote on each page load
  const quote = DAILY_QUOTES[Math.floor(Math.random() * DAILY_QUOTES.length)];
  const textEl = dailyQuote.querySelector(".daily-quote__text");
  const authorEl = dailyQuote.querySelector(".daily-quote__author");
  if (textEl) textEl.textContent = `\u201C${quote.text}\u201D`;
  if (authorEl) authorEl.textContent = `\u2014 ${quote.author}`;
}

/* ── Letter Stagger (project titles — desktop only) ────── */

if (isDesktop && researchGrid) {
  researchGrid.querySelectorAll(".research-entry__title").forEach((title) => {
    const text = title.textContent;
    title.innerHTML = text
      .split("")
      .map((char, i) =>
        char === " "
          ? " "
          : `<span class="char" style="--i:${i}">${char}</span>`
      )
      .join("");
  });
}

/* ── Cursor Preview (project hover — desktop only) ─────── */

const cursorPreview = document.querySelector("#cursorPreview");

if (isDesktop && cursorPreview && researchGrid) {
  let prevX = 0, prevY = 0, targetPX = 0, targetPY = 0;
  let previewRaf = null;
  const lerp = (a, b, t) => a + (b - a) * t;

  const tickPreview = () => {
    prevX = lerp(prevX, targetPX, 0.09);
    prevY = lerp(prevY, targetPY, 0.09);
    cursorPreview.style.transform = `translate(${prevX + 24}px, ${prevY + 24}px)`;
    previewRaf = requestAnimationFrame(tickPreview);
  };

  document.addEventListener("mousemove", (e) => {
    targetPX = e.clientX;
    targetPY = e.clientY;
  });

  researchGrid.querySelectorAll(".research-entry").forEach((entry) => {
    entry.addEventListener("mouseenter", () => {
      prevX = targetPX;
      prevY = targetPY;
      cursorPreview.classList.add("is-visible");
      if (!previewRaf) previewRaf = requestAnimationFrame(tickPreview);
    });

    entry.addEventListener("mouseleave", () => {
      cursorPreview.classList.remove("is-visible");
      if (previewRaf) {
        cancelAnimationFrame(previewRaf);
        previewRaf = null;
      }
    });
  });
}

/* ── Work Tabs ─────────────────────────────────────────── */

const workTabs = document.querySelectorAll(".work-tab");
const workPanels = document.querySelectorAll(".work-panel");

workTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    workTabs.forEach((t) => t.classList.remove("is-active"));
    workPanels.forEach((p) => p.classList.remove("is-active"));
    tab.classList.add("is-active");
    const panel = document.getElementById(`panel-${tab.dataset.tab}`);
    if (panel) {
      panel.classList.add("is-active");
      /* Staggered entrance animation for new panel items */
      if (window.gsap && !prefersReducedMotion()) {
        const items = panel.querySelectorAll(
          ".research-entry, .startup-entry, .app-entry, .experience-item"
        );
        if (items.length) {
          window.gsap.from(items, {
            y: 20,
            opacity: 0,
            stagger: 0.04,
            duration: 0.5,
            ease: "expo.out",
            clearProps: "all",
          });
        }
      }
    }
  });
});

/* ── Word Spotlight (Practice section — desktop only) ──── */

if (isDesktop) {
  document.querySelectorAll(".about-card p, .hero__tagline").forEach((el) => {
    el.innerHTML = el.innerHTML.replace(/(\S+)/g, '<span class="hw">$1</span>');

    el.addEventListener("mouseover", (e) => {
      const target = e.target.closest(".hw");
      if (!target) return;
      el.querySelectorAll(".hw.is-lit").forEach((h) => h.classList.remove("is-lit"));
      target.classList.add("is-lit");
    });

    el.addEventListener("mouseleave", () => {
      el.querySelectorAll(".hw.is-lit").forEach((h) => h.classList.remove("is-lit"));
    });
  });
}

/* ── Smooth anchor scrolling ───────────────────────────── */

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (event) => {
    const targetId = anchor.getAttribute("href");
    if (!targetId || targetId === "#") return;
    const target = document.querySelector(targetId);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
  });
});

/* ── Hero Critter SVGs (tiny animals that peek out on hover) ─ */

const CRITTER_SVGS = [
  // Cat
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 12l2.5-7 3 4M20 12l-2.5-7-3 4"/><path d="M5 17c2.5 3 5 4 7 4s4.5-1 7-4"/><circle cx="9" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"/><path d="M12 16v1M10.5 17.5c.7.7 2.3.7 3 0"/></svg>`,
  // Bear
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><ellipse cx="12" cy="14" rx="7" ry="6"/><circle cx="10" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="13" r="1" fill="currentColor" stroke="none"/><ellipse cx="12" cy="15.5" rx="1.5" ry="1" fill="currentColor" stroke="none"/></svg>`,
  // Bunny
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 11V3.5a1.5 1.5 0 013 0V11M12 11V3.5a1.5 1.5 0 013 0V11"/><ellipse cx="12" cy="16" rx="6" ry="5"/><circle cx="10" cy="15" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="15" r="1" fill="currentColor" stroke="none"/></svg>`,
  // Star
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 3l1.5 6 6 1.5-6 1.5L12 18l-1.5-6-6-1.5 6-1.5z"/></svg>`,
  // Flower
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="10" r="2" fill="currentColor" opacity="0.3" stroke="none"/><circle cx="12" cy="6" r="2.5"/><circle cx="15.5" cy="8" r="2.5"/><circle cx="15.5" cy="12" r="2.5"/><circle cx="12" cy="14" r="2.5"/><circle cx="8.5" cy="12" r="2.5"/><circle cx="8.5" cy="8" r="2.5"/></svg>`,
  // Heart
  `<svg viewBox="0 0 24 24" fill="currentColor" opacity="0.7"><path d="M12 21C12 21 3 13.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 12 5C12.09 3.81 13.76 3 15.5 3C18.58 3 21 5.42 21 8.5C21 13.5 12 21 12 21Z"/></svg>`,
];

let crittersInitialized = false;

function initHeroCritters() {
  if (crittersInitialized) return;
  const chars = document.querySelectorAll("#heroName .hero-char");
  if (!chars.length) return;
  crittersInitialized = true;

  /* Ensure critters can overflow above the word container */
  document.querySelectorAll("#heroName .word").forEach((w) => (w.style.overflow = "visible"));

  const tilts = [-6, -3, 0, 3, 6];

  chars.forEach((char) => {
    char.dataset.critter = Math.floor(Math.random() * CRITTER_SVGS.length);
    char.style.setProperty("--char-tilt", tilts[Math.floor(Math.random() * tilts.length)] + "deg");

    char.addEventListener("mouseenter", () => {
      const existing = char.querySelector(".hero-critter");
      if (existing) existing.remove();

      const el = document.createElement("span");
      el.className = "hero-critter";
      el.innerHTML = CRITTER_SVGS[char.dataset.critter];
      char.appendChild(el);
    });

    char.addEventListener("mouseleave", () => {
      const el = char.querySelector(".hero-critter");
      if (el) {
        el.classList.add("is-leaving");
        el.addEventListener("animationend", () => el.remove());
      }
    });
  });
}

/* ── GSAP Animations ───────────────────────────────────── */

const setupGsap = () => {
  if (!window.gsap || prefersReducedMotion()) return;

  const { gsap } = window;
  const ST = window.ScrollTrigger;
  if (ST) gsap.registerPlugin(ST);

  /* Hero headline — split into individual chars for hover critters */
  const heroName = document.querySelector("#heroName");
  if (heroName) {
    heroName.querySelectorAll(".hero__name-line").forEach((line) => {
      const img = line.querySelector("img");
      const text = line.textContent.trim();
      const charSpans = text
        .split("")
        .map((ch) => (ch === " " ? " " : `<span class="hero-char">${ch}</span>`))
        .join("");
      line.innerHTML = `<span class="word"><span class="word-inner">${charSpans}</span></span>`;
      if (img) line.appendChild(img);
    });

    gsap.set("#heroName .word-inner", { y: "110%", opacity: 0 });
    gsap.to("#heroName .word-inner", {
      y: "0%",
      opacity: 1,
      stagger: 0.12,
      duration: 0.9,
      ease: "expo.out",
      delay: 0.3,
    });

    /* Init critters after the entrance animation finishes */
    if (isDesktop) gsap.delayedCall(1.5, initHeroCritters);
  }

  /* Hero elements fade up */
  gsap.from(".anim-hero", {
    y: 30,
    opacity: 0,
    stagger: 0.08,
    duration: 0.8,
    ease: "expo.out",
    delay: 0.6,
  });

  if (!ST) return;

  /* About photo — clip-path directional wipe on scroll */
  const aboutPhoto = document.querySelector("#aboutPhoto");
  if (aboutPhoto) {
    ST.create({
      trigger: aboutPhoto,
      start: "top 85%",
      once: true,
      onEnter: () => aboutPhoto.classList.add("is-revealed"),
    });
  }

  /* Section reveals — staggered, obvious offset */
  gsap.utils
    .toArray(".section__header, .work-panel.is-active .research-entry, .note-preview, .contact-body")
    .forEach((item) => {
      gsap.from(item, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "expo.out",
        scrollTrigger: {
          trigger: item,
          start: "top 88%",
        },
      });
    });

  /* Practice cards — progressive blur reveal on scroll */
  document.querySelectorAll(".about-card").forEach((card, i) => {
    ScrollTrigger.create({
      trigger: card,
      start: "top 85%",
      once: true,
      onEnter: () => {
        setTimeout(() => card.classList.add("is-revealed"), i * 150);
      },
    });
  });
};

window.addEventListener("load", setupGsap);

/* ── Subscribe Form ──────────────────────────────────── */

function handleSubscribe(form) {
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.querySelector('input[name="email"]').value;
    if (!email) return;

    // Store locally (connect to Buttondown/Formspree/etc later)
    const subs = JSON.parse(localStorage.getItem("subscribers") || "[]");
    if (!subs.includes(email)) {
      subs.push(email);
      localStorage.setItem("subscribers", JSON.stringify(subs));
    }

    // Replace form with success message
    const parent = form.parentElement;
    form.remove();
    const msg = document.createElement("p");
    msg.className = "subscribe-success";
    msg.textContent = "You're in. I'll email you when something new goes up.";
    parent.insertBefore(msg, parent.querySelector(".subscribe-rss"));
  });
}

handleSubscribe(document.querySelector("#subscribeForm"));
handleSubscribe(document.querySelector("#subscribeFormHome"));
