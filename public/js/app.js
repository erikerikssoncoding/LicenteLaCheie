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
  const phoneFields = document.querySelectorAll('[data-phone-input]');
  if (!phoneFields.length) {
    return;
  }
  const repeatedMessage = 'Numărul de telefon nu poate avea toate cifrele identice.';
  const sanitizePhoneValue = (value) => {
    if (typeof value !== 'string') {
      return '';
    }
    const compact = value.replace(/[\s().-]+/g, '');
    if (compact.startsWith('00')) {
      return `+${compact.slice(2)}`;
    }
    if (/^0[0-9]{9}$/u.test(compact)) {
      return `+4${compact}`;
    }
    return compact;
  };
  const flagVisibleClass = 'phone-input-flag-visible';
  let prefixEntries = [];

  const validateField = (field) => {
    field.setCustomValidity('');
    const digits = field.value.replace(/\D/g, '').slice(-9);
    if (digits && digits.length >= 6 && /^([0-9])\1+$/u.test(digits)) {
      field.setCustomValidity(repeatedMessage);
      return;
    }
    if (field.validity.patternMismatch && field.hasAttribute('data-phone-message')) {
      field.setCustomValidity(field.getAttribute('data-phone-message'));
    }
  };

  const updateFlag = (field) => {
    const wrapper = field.closest('[data-phone-input-wrapper]');
    const flagElement = wrapper ? wrapper.querySelector('[data-phone-flag]') : null;
    if (!flagElement) {
      return;
    }
    if (!prefixEntries.length) {
      flagElement.textContent = '';
      flagElement.classList.remove(flagVisibleClass);
      flagElement.removeAttribute('title');
      return;
    }
    const sanitized = sanitizePhoneValue(field.value || '');
    const match = sanitized.startsWith('+')
      ? prefixEntries.find((entry) => sanitized.startsWith(entry.code))
      : null;
    if (match) {
      flagElement.textContent = match.emoji || '';
      flagElement.title = match.country ? `${match.country} (${match.code})` : match.code;
      flagElement.classList.add(flagVisibleClass);
    } else {
      flagElement.textContent = '';
      flagElement.classList.remove(flagVisibleClass);
      flagElement.removeAttribute('title');
    }
  };

  phoneFields.forEach((field) => {
    field.addEventListener('input', () => {
      validateField(field);
      updateFlag(field);
    });
    field.addEventListener('blur', () => validateField(field));
    validateField(field);
  });

  fetch('/data/phone-prefixes.json')
    .then((response) => (response.ok ? response.json() : []))
    .then((data) => {
      prefixEntries = (Array.isArray(data) ? data : [])
        .map((entry) => ({
          emoji: entry.emoji,
          country: entry.country,
          code: typeof entry.code === 'string' ? entry.code.replace(/[^+\d]/g, '') : ''
        }))
        .filter((entry) => entry.code && entry.code.startsWith('+'))
        .sort((a, b) => b.code.length - a.code.length);
      phoneFields.forEach(updateFlag);
    })
    .catch(() => {
      /* prefix list optional */
    });
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
