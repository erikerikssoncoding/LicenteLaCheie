(() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion) {
    document.querySelectorAll('.timeline-item').forEach((item, index) => {
      item.style.transition = 'transform 0.4s ease, opacity 0.4s ease';
      item.style.transform = 'translateY(20px)';
      item.style.opacity = '0';
      setTimeout(() => {
        item.style.transform = 'translateY(0)';
        item.style.opacity = '1';
      }, 120 * index);
    });
  }
})();
