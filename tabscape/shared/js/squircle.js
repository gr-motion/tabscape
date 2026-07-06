/**
 * Squircle clip-path utility.
 * Applies Figma-style continuous corner rounding to any element with
 * the [data-squircle] attribute. Uses the same algorithm as the
 * GridRenderer tab shapes.
 *
 * Usage: add data-squircle (default 20px radius) or data-squircle="16"
 * to any element. The script auto-discovers and keeps them updated on resize.
 */
(function () {
  const DEFAULT_RADIUS = 20;
  const SMOOTHING = 1.0; // full iOS-style smoothing

  function figmaCornerParams(cornerRadius, cornerSmoothing, budget) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    let p = (1 + cornerSmoothing) * cornerRadius;
    const maxSmoothing = budget / cornerRadius - 1;
    cornerSmoothing = Math.min(cornerSmoothing, maxSmoothing);
    p = Math.min(p, budget);

    const arcMeasure = 90 * (1 - cornerSmoothing);
    const arcSectionLength =
      Math.sin(toRad(arcMeasure / 2)) * cornerRadius * Math.sqrt(2);

    const angleAlpha = (90 - arcMeasure) / 2;
    const p3ToP4Distance = cornerRadius * Math.tan(toRad(angleAlpha / 2));
    const angleBeta = 45 * cornerSmoothing;
    const c = p3ToP4Distance * Math.cos(toRad(angleBeta));
    const d = c * Math.tan(toRad(angleBeta));
    const b = (p - arcSectionLength - c - d) / 3;
    const a = 2 * b;

    return { a, b, c, d, p, arcSectionLength, R: cornerRadius };
  }

  function squirclePath(width, height, radius) {
    const budget = Math.min(width, height) / 2;
    radius = Math.min(radius, budget);
    if (radius <= 0) {
      return `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
    }

    const { a, b, c, d, p, arcSectionLength, R } =
      figmaCornerParams(radius, SMOOTHING, budget);
    const r = (v) => v.toFixed(4);

    let path = `M ${r(width - p)} 0`;

    // Top-right
    path += ` c ${r(a)} 0 ${r(a + b)} 0 ${r(a + b + c)} ${r(d)}`;
    if (arcSectionLength > 0)
      path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(arcSectionLength)} ${r(arcSectionLength)}`;
    path += ` c ${r(d)} ${r(c)} ${r(d)} ${r(b + c)} ${r(d)} ${r(a + b + c)}`;
    path += ` L ${r(width)} ${r(height - p)}`;

    // Bottom-right
    path += ` c 0 ${r(a)} 0 ${r(a + b)} ${r(-d)} ${r(a + b + c)}`;
    if (arcSectionLength > 0)
      path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(-arcSectionLength)} ${r(arcSectionLength)}`;
    path += ` c ${r(-c)} ${r(d)} ${r(-(b + c))} ${r(d)} ${r(-(a + b + c))} ${r(d)}`;
    path += ` L ${r(p)} ${r(height)}`;

    // Bottom-left
    path += ` c ${r(-a)} 0 ${r(-(a + b))} 0 ${r(-(a + b + c))} ${r(-d)}`;
    if (arcSectionLength > 0)
      path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(-arcSectionLength)} ${r(-arcSectionLength)}`;
    path += ` c ${r(-d)} ${r(-c)} ${r(-d)} ${r(-(b + c))} ${r(-d)} ${r(-(a + b + c))}`;
    path += ` L 0 ${r(p)}`;

    // Top-left
    path += ` c 0 ${r(-a)} 0 ${r(-(a + b))} ${r(d)} ${r(-(a + b + c))}`;
    if (arcSectionLength > 0)
      path += ` a ${r(R)} ${r(R)} 0 0 1 ${r(arcSectionLength)} ${r(-arcSectionLength)}`;
    path += ` c ${r(c)} ${r(-d)} ${r(b + c)} ${r(-d)} ${r(a + b + c)} ${r(-d)}`;

    path += ' Z';
    return path;
  }

  function applySquircle(el) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w === 0 || h === 0) return;
    const radius = parseFloat(el.dataset.squircle) || DEFAULT_RADIUS;
    el.style.clipPath = `path('${squirclePath(w, h, radius)}')`;
  }

  function applyAll() {
    document.querySelectorAll('[data-squircle]').forEach(applySquircle);
  }

  // Observe size changes
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) applySquircle(entry.target);
  });

  // Watch for new elements added to the DOM
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.hasAttribute('data-squircle')) {
          applySquircle(node);
          ro.observe(node);
        }
        node.querySelectorAll?.('[data-squircle]').forEach((child) => {
          applySquircle(child);
          ro.observe(child);
        });
      }
    }
  });

  // Init on DOMContentLoaded (or immediately if already loaded)
  function init() {
    applyAll();
    document.querySelectorAll('[data-squircle]').forEach((el) => ro.observe(el));
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual use
  window.applySquircle = applySquircle;
  window.squirclePath = squirclePath;
})();
