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

(() => {
  const pad = (value) => String(value).padStart(2, '0');
  document.querySelectorAll('[data-countdown-target]').forEach((element) => {
    const targetValue = element.getAttribute('data-countdown-target');
    if (!targetValue) {
      return;
    }
    const targetDate = new Date(targetValue);
    if (Number.isNaN(targetDate.getTime())) {
      return;
    }
    const finishedText = element.getAttribute('data-countdown-finished-text') || '00:00:00';
    const update = () => {
      const now = new Date();
      const diff = targetDate.getTime() - now.getTime();
      if (diff <= 0) {
        element.textContent = finishedText;
        return false;
      }
      const totalSeconds = Math.floor(diff / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      element.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
      return true;
    };
    if (!update()) {
      return;
    }
    const interval = setInterval(() => {
      const shouldContinue = update();
      if (!shouldContinue) {
        clearInterval(interval);
      }
    }, 1000);
  });
})();
