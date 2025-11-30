(() => {
  const STORAGE_KEY = 'cookieconsent.preferences';
  const COOKIE_NAME = 'cookie_preferences';
  const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
  const POLICY_URL = '/politica-cookie';

  const defaultPreferences = {
    necessary: true,
    analytics: false,
    marketing: false
  };

  const readPreferences = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultPreferences };
      const parsed = JSON.parse(raw);
      return {
        ...defaultPreferences,
        analytics: Boolean(parsed.analytics),
        marketing: Boolean(parsed.marketing)
      };
    } catch (error) {
      console.warn('Nu am putut citi preferințele de cookies.', error);
      return { ...defaultPreferences };
    }
  };

  const persistPreferences = (prefs) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      console.warn('Nu am putut salva preferințele de cookies.', error);
    }

    try {
      const encoded = encodeURIComponent(JSON.stringify(prefs));
      document.cookie = `${COOKIE_NAME}=${encoded}; max-age=${ONE_YEAR_SECONDS}; path=/; SameSite=Lax`;
    } catch (error) {
      console.warn('Nu am putut salva cookie-ul de preferințe.', error);
    }
  };

  const dispatchReady = (prefs) => {
    document.dispatchEvent(
      new CustomEvent('cookieconsent:ready', {
        detail: { preferences: prefs, policyUrl: POLICY_URL }
      })
    );
  };

  const dispatchUpdated = (prefs) => {
    document.dispatchEvent(new CustomEvent('cookieconsent:updated', { detail: prefs }));
  };

  const updateStatus = (statusEl, message) => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.add('text-success');
    statusEl.classList.remove('d-none');
  };

  const bindPreferencesForm = (prefs) => {
    const form = document.querySelector('[data-cookie-preferences-form]');
    if (!form) return;

    const analyticsInput = form.querySelector('input[name="analytics"]');
    const marketingInput = form.querySelector('input[name="marketing"]');
    const statusEl = form.querySelector('[data-cookie-status]');

    if (analyticsInput) analyticsInput.checked = Boolean(prefs.analytics);
    if (marketingInput) marketingInput.checked = Boolean(prefs.marketing);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const updated = {
        necessary: true,
        analytics: analyticsInput ? analyticsInput.checked : false,
        marketing: marketingInput ? marketingInput.checked : false
      };

      persistPreferences(updated);
      dispatchUpdated(updated);
      updateStatus(statusEl, 'Preferințele au fost actualizate.');
    });

    const acceptAllBtn = form.querySelector('[data-cookie-accept-all]');
    if (acceptAllBtn) {
      acceptAllBtn.addEventListener('click', (event) => {
        event.preventDefault();
        const updated = { necessary: true, analytics: true, marketing: true };
        if (analyticsInput) analyticsInput.checked = true;
        if (marketingInput) marketingInput.checked = true;
        persistPreferences(updated);
        dispatchUpdated(updated);
        updateStatus(statusEl, 'Ai activat toate categoriile de cookies.');
      });
    }

    const essentialsBtn = form.querySelector('[data-cookie-essentials]');
    if (essentialsBtn) {
      essentialsBtn.addEventListener('click', (event) => {
        event.preventDefault();
        const updated = { necessary: true, analytics: false, marketing: false };
        if (analyticsInput) analyticsInput.checked = false;
        if (marketingInput) marketingInput.checked = false;
        persistPreferences(updated);
        dispatchUpdated(updated);
        updateStatus(statusEl, 'Sunt activate doar cookie-urile esențiale.');
      });
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const preferences = readPreferences();
    dispatchReady(preferences);
    bindPreferencesForm(preferences);
  });
})();
