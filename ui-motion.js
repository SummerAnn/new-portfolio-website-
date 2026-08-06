const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export const prefersReducedMotion = () => reducedMotionQuery.matches;

export const setupMotionPreferences = () => {
  const root = document.documentElement;
  const syncPreference = () => {
    root.classList.toggle("reduced-motion", prefersReducedMotion());
  };

  syncPreference();

  if (root.dataset.motionPreferenceBound === "true") return;
  reducedMotionQuery.addEventListener("change", syncPreference);
  root.dataset.motionPreferenceBound = "true";
};
