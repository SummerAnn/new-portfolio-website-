# Claude-Ready Portfolio Redesign Prompt

Paste the prompt below into Claude. If possible, attach the local reference files listed inside it.

```md
You are redesigning and implementing a personal portfolio + journal website for Summer Ann.

Work directly from the real local repo and improve the actual site, not a mockup:
- Repo: `/Users/summerann/Documents/newporfolio`
- Current preview URL: `http://127.0.0.1:4173/index.html`

Important: the current site content is directionally much closer to correct than the current visual design. Preserve the truthful substance, but replace the visual/system design aggressively.

## What Is Wrong Right Now

The current homepage is visually failing for a few specific reasons:

- The hero is dominated by a fake glass / chrome assembly sculpture that reads like a random decorative object.
- It gives off a pavilion-study / abstract demo / student-experiment vibe instead of a serious, high-taste portfolio.
- Motion is acting like the main event instead of supporting the work and the narrative.
- The hierarchy is not work-led enough.
- The UI feels too close to “animation demo” and too far from “designer-level portfolio for a research/product builder.”

The user explicitly dislikes the current direction and wants it replaced.

## Who This Site Is For

This is the portfolio + blog of Summer Ann. The site should communicate someone who sits at the intersection of:

- UChicago CS PhD research
- DevSecCode
- Agent4Science
- Flamebird
- Deva
- biomedical ML
- local-first / AI-native / iOS / product tooling

She should read as:

- technically serious
- systems-minded
- editorial and aesthetically sharp
- capable of both research depth and product taste

This should not feel like a generic startup landing page or a generic design template.

## Non-Negotiables

- Do not keep the current fake-glass centerpiece as the hero concept.
- Do not introduce random chrome blobs or decorative objects with no conceptual tie to the work.
- Do not turn the site into a generic SaaS page.
- Do not overwrite the real background/content with fabricated projects or vague placeholder copy.
- Do not let motion overpower readability, layout, or actual work.

If you keep any moving central object at all, it must feel like a precise, conceptually grounded instrument, artifact, model, or miniature built world tied to research/systems/product practice. If that cannot be done elegantly, remove the object-led hero entirely and build the experience around typography, layout, image treatment, and motion systems instead.

## Desired Direction

Create a designer-level portfolio that feels:

- editorial
- intelligent
- intentional
- high-end
- tactile
- cinematic
- work-led
- calm but unmistakably authored

Possible direction:

- strong typography first
- asymmetrical but disciplined composition
- technical mono only as a secondary/supporting voice
- a restrained palette with one sharp accent
- real depth from spacing, rhythm, contrast, texture, and light
- motion used as guidance, reveal, emphasis, and continuity

This should feel like a portfolio for someone building real systems, not a frontend exercise trying to impress with effects.

## Tech Constraints

- The current site is static HTML/CSS/JS.
- Use the existing stack unless there is a compelling reason to change it.
- GSAP is already loaded and can be used.
- Prefer performant animation using `transform` and `opacity`.
- Respect `prefers-reduced-motion`.
- Make desktop and mobile both feel designed, not merely “responsive.”
- Keep the homepage and journal page in the same visual world.

## Files To Inspect First

Core site files:
- `/Users/summerann/Documents/newporfolio/index.html`
- `/Users/summerann/Documents/newporfolio/styles.css`
- `/Users/summerann/Documents/newporfolio/main.js`
- `/Users/summerann/Documents/newporfolio/content.js`
- `/Users/summerann/Documents/newporfolio/journal.html`
- `/Users/summerann/Documents/newporfolio/journal.js`
- `/Users/summerann/Documents/newporfolio/ui-motion.js`

Resume / factual grounding:
- `/Users/summerann/Documents/newporfolio/assets/resume_summer.pdf`

Legacy / stale direction to remove or ignore:
- `/Users/summerann/Documents/newporfolio/assets/pavilion-hero.png`
- `/Users/summerann/Documents/newporfolio/assets/pavilion-hero-cutout.png`
- `/Users/summerann/Documents/newporfolio/README.md` (stale; do not let it override the current task)

## Content Guidance

Preserve the core truth of the current content:

- Summer Ann is building Deva, Agent4Science, Flamebird, and other local-first / AI-native tools.
- The work spans research, infrastructure, secure developer tooling, biomedical ML, and product engineering.
- The journal is a real build log / notes space, not a decorative afterthought.

The current `content.js` is a better factual starting point than the visual implementation.

## Distilled Design Guidance From The References

Use the references below for direction, but do not imitate them literally or produce trend-chasing slop.

1. Motion should be purposeful.
- Use motion for feedback, guidance, relationships, hierarchy, and emotional tone.
- Animations should clarify the interface, not distract from it.
- Keep most interaction timing in a tight, responsive range unless a larger reveal genuinely earns more duration.

2. Motion should feel consistent and performant.
- Use a coherent timing/easing system.
- Favor `transform` and `opacity`.
- Make the site feel expensive through precision, not through quantity of effects.

3. UI beauty comes from discipline before decoration.
- Solve the grayscale/spacing/hierarchy problem first.
- Build a strong composition before color theatrics.
- Use substantially more whitespace and breathing room than the current design.

4. Light, depth, and material should be believable.
- If you use depth, shadows, glow, glass, chrome, or reflective surfaces, they must obey a coherent light logic.
- “Light comes from above” is a useful heuristic.
- Avoid fake material effects that look like random translucent pills.

5. Typography has to carry more of the experience.
- The current site needs a more intentional type hierarchy and better page rhythm.
- Make large type feel art-directed, not default.
- Supporting text should be quieter and more precise.

6. Fight AI-era sameness.
- Avoid generic polished emptiness.
- Introduce texture, edge, authorship, and real composition.
- Use trend references selectively, not literally.

7. Let the work dominate.
- Portfolio pieces should own meaningful screen real estate.
- The layout should help the work shine instead of competing with it.
- Resume/contact/about credibility should remain easy to find.

8. Curate and contextualize the portfolio.
- Quality over quantity: do not overcrowd the homepage with too many equally loud pieces.
- Lead with the strongest work signal early, whether that is a featured case study, a hero project moment, or a tightly curated reel-like introduction.
- For each project, make the viewer understand the role, the problem space, and the type of work quickly.
- Navigation should be simple and low-friction.
- The About/Contact layer should feel deliberate and professional, not tacked on.

9. Iterate against the real result.
- Compare the code output to the rendered page repeatedly.
- Tighten spacing, alignment, and visual weight until the page feels genuinely designed.

## Reference URLs

Animation / libraries / inspiration:
- `https://github.com/greensock/gsap`
- `https://github.com/paper-design/liquid-logo`
- `https://github.com/dashersw/liquid-glass-js`
- `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill`

## Local Reference Files

Workflow reference:
- `/Users/summerann/.codex/attachments/ab924934-2e33-4d29-9976-7f2773d78727/pasted-text.txt`
  - Codex guide about moving from image/design references to real UI through iterative implementation.

Motion / interaction references:
- `/Users/summerann/.codex/attachments/cdaf32cf-36b9-4ebc-acc7-e9aedc0d0e42/pasted-text.txt`
  - Motion UI and interactive design: purposeful, accessible, performant animation.
- `/Users/summerann/.codex/attachments/e8bce3f4-3461-4273-a621-7f4e720f5425/pasted-text.txt`
  - Modern principles of interactive animation: purpose, consistency, feedback, reduced cognitive load, responsiveness.

Visual design references:
- `/Users/summerann/.codex/attachments/69f99dd8-6b22-441c-9e4a-1aa6ca59b24a/pasted-text.txt`
  - Erik D. Kennedy: light logic, grayscale-first design, generous whitespace, typography discipline.
- `/Users/summerann/.codex/attachments/74a8eb4a-3828-4351-aead-ca1d0b1beaa4/pasted-text.txt`
  - 2026 aesthetics article: react against AI sameness with stronger visual authorship, texture, contrast, and intentional recombination.
- `/Users/summerann/.codex/attachments/4e630396-7eee-4ace-a636-0d0685160334/pasted-text.txt`
  - Animation portfolio roundup: make the work prominent, keep layouts clean, and let the portfolio speak.
- `/Users/summerann/.codex/attachments/c526b2c0-5d38-4be1-b3a0-b772e637ac26/pasted-text.txt`
  - Animation portfolio guide: curate only the strongest work, open with a strong featured-work signal, provide concise context for each piece, keep navigation clean, and ensure the site works well on mobile.

## What I Want You To Do

1. Inspect the current repo files first.
2. Decide on one strong visual concept that actually fits Summer Ann’s profile.
3. Briefly state that concept in 8-12 concrete bullets before editing.
4. Then implement the redesign directly in the real files.
5. Redesign both the homepage and the journal so they feel like one authored system.
6. Replace the current object-led hero with something far more rigorous and aesthetically strong.
7. Improve typography, section rhythm, spacing, hover states, scroll behavior, and overall visual hierarchy.
8. Use GSAP only where it meaningfully improves the experience.
9. Keep the final result performant and mobile-responsible.
10. Summarize what changed and why.

## Acceptance Criteria

The redesign is successful only if:

- the first screen feels premium and authored immediately
- the site foregrounds work, identity, and point of view
- there is no leftover pavilion-study / random-sculpture energy
- typography and spacing feel intentional at a designer level
- motion feels subtle, confident, and expensive rather than busy
- the journal feels like part of the same brand system
- the site still reads as truthful to the resume and current work
- the result looks like a serious portfolio for a research/product builder, not a demo page for effects

Be opinionated, but grounded. Prioritize taste, hierarchy, and execution quality over novelty for its own sake.
```
