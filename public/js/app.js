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

(() => {
  const requiredFields = document.querySelectorAll('[data-required-message]');
  requiredFields.forEach((field) => {
    const message = field.getAttribute('data-required-message');
    if (!message) {
      return;
    }
    field.addEventListener('invalid', (event) => {
      const target = event.target;
      target.setCustomValidity('');
      if (target.validity.valueMissing) {
        target.setCustomValidity(message);
      } else if (target.validity.patternMismatch && target.hasAttribute('data-phone-message')) {
        target.setCustomValidity(target.getAttribute('data-phone-message'));
      }
    });
    field.addEventListener('input', (event) => {
      event.target.setCustomValidity('');
    });
  });
})();

(() => {
  const phoneField = document.querySelector('[data-phone-message]');
  if (!phoneField) {
    return;
  }
  const repeatedMessage = 'Numărul de telefon nu poate avea toate cifrele identice.';
  const validatePhone = () => {
    phoneField.setCustomValidity('');
    const digits = phoneField.value.replace(/\D/g, '').slice(-9);
    if (digits && digits.length >= 6 && /^([0-9])\1+$/u.test(digits)) {
      phoneField.setCustomValidity(repeatedMessage);
      return;
    }
    if (phoneField.validity.patternMismatch) {
      phoneField.setCustomValidity(phoneField.getAttribute('data-phone-message'));
    }
  };
  phoneField.addEventListener('input', validatePhone);
  phoneField.addEventListener('blur', validatePhone);
})();

(() => {
  const input = document.querySelector('[data-attachment-input]');
  const list = document.querySelector('[data-attachment-list]');
  if (!input || !list) {
    return;
  }
  const renderList = () => {
    const files = Array.from(input.files);
    list.innerHTML = '';
    if (!files.length) {
      list.textContent = 'Niciun fișier selectat.';
      return;
    }
    files.forEach((file) => {
      const row = document.createElement('div');
      const size = file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'dimensiune necunoscută';
      row.textContent = `${file.name} (${size})`;
      list.appendChild(row);
    });
  };
  input.addEventListener('change', renderList);
})();
