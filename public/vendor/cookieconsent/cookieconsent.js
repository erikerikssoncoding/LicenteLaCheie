(() => {
  const CONSENT_STORAGE_KEY = 'cookieconsent.preferences';
  const CONSENT_COOKIE_NAME = 'cookie_preferences';
  const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

  const defaultConfig = {
    policyUrl: '/politica-cookie',
    palette: {},
    strings: {
      bannerTitle: 'Respectăm confidențialitatea ta',
      bannerDescription:
        'Folosim cookies pentru a personaliza conținutul, a analiza traficul și a îmbunătăți experiența pe site. Poți alege ce tipuri de cookie permiți.',
      acceptAll: 'Accept toate',
      rejectNonEssential: 'Doar esențiale',
      managePreferences: 'Preferințe',
      modalTitle: 'Preferințe cookies',
      modalDescription: 'Alege ce tipuri de cookies permiți. Poți schimba oricând preferințele.',
      saveSettings: 'Salvează preferințele',
      categoryNecessaryTitle: 'Esențiale',
      categoryNecessaryDescription:
        'Necesare pentru funcționarea de bază a site-ului și pentru securitate. Sunt activate permanent.',
      categoryAnalyticsTitle: 'Analitice',
      categoryAnalyticsDescription: 'Ne ajută să înțelegem cum este utilizat site-ul și să îl optimizăm.',
      categoryMarketingTitle: 'Marketing',
      categoryMarketingDescription: 'Permit personalizarea conținutului și a reclamelor pentru a fi mai relevante.',
      reopenSettings: 'Preferințe cookie',
      close: 'Închide',
      saveSuccess: 'Preferințele au fost salvate.'
    }
  };

  const mergeObjects = (target, source) => {
    const output = { ...target };
    if (!source || typeof source !== 'object') return output;
    return Object.keys(source).reduce((acc, key) => {
      const value = source[key];
      if (Array.isArray(value)) {
        acc[key] = [...value];
      } else if (value && typeof value === 'object') {
        acc[key] = mergeObjects(target[key] || {}, value);
      } else {
        acc[key] = value;
      }
      return acc;
    }, output);
  };

  const readPreferences = () => {
    try {
      const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.warn('Nu am putut citi preferințele de cookies.', error);
      return null;
    }
  };

  const writeCookie = (prefs) => {
    try {
      const encoded = encodeURIComponent(JSON.stringify(prefs));
      document.cookie = `${CONSENT_COOKIE_NAME}=${encoded}; max-age=${ONE_YEAR_SECONDS}; path=/; SameSite=Lax`;
    } catch (error) {
      console.warn('Nu am putut salva cookie-ul de preferințe.', error);
    }
  };

  const savePreferences = (prefs) => {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(prefs));
    } catch (error) {
      console.warn('Nu am putut salva preferințele de cookies.', error);
    }
    writeCookie(prefs);
    document.dispatchEvent(new CustomEvent('cookieconsent:updated', { detail: prefs }));
  };

  const createToggle = (checked, disabled) => {
    const toggle = document.createElement('div');
    toggle.className = 'cookie-toggle';
    const knob = document.createElement('div');
    knob.className = 'cookie-toggle__knob';
    toggle.appendChild(knob);
    if (checked) {
      toggle.classList.add('cookie-toggle--active');
    }
    if (disabled) {
      toggle.classList.add('cookie-toggle--disabled');
    }
    return toggle;
  };

  const createBanner = (config, onAcceptAll, onReject, onOpenSettings) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'cookie-consent-banner';

    const title = document.createElement('h3');
    title.className = 'cookie-consent-banner__title';
    title.textContent = config.strings.bannerTitle;

    const description = document.createElement('p');
    description.className = 'cookie-consent-banner__description';
    description.textContent = config.strings.bannerDescription;

    if (config.policyUrl) {
      const policyLink = document.createElement('a');
      policyLink.href = config.policyUrl;
      policyLink.textContent = 'Vezi politica de cookies';
      policyLink.className = 'cookie-consent-banner__policy-link';
      policyLink.target = '_blank';
      policyLink.rel = 'noreferrer noopener';
      policyLink.style.marginLeft = '6px';
      description.appendChild(policyLink);
    }

    const actions = document.createElement('div');
    actions.className = 'cookie-consent-banner__actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'cookie-btn cookie-btn--primary';
    acceptBtn.type = 'button';
    acceptBtn.textContent = config.strings.acceptAll;
    acceptBtn.addEventListener('click', onAcceptAll);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'cookie-btn cookie-btn--ghost';
    rejectBtn.type = 'button';
    rejectBtn.textContent = config.strings.rejectNonEssential;
    rejectBtn.addEventListener('click', onReject);

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'cookie-btn cookie-btn--ghost';
    settingsBtn.type = 'button';
    settingsBtn.textContent = config.strings.managePreferences;
    settingsBtn.addEventListener('click', onOpenSettings);

    actions.append(settingsBtn, rejectBtn, acceptBtn);
    wrapper.append(title, description, actions);
    return wrapper;
  };

  const createModal = (config, preferences, onSave) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'cookie-consent-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'cookie-consent-modal';

    const header = document.createElement('div');
    header.className = 'cookie-consent-modal__header';

    const title = document.createElement('div');
    title.className = 'cookie-consent-modal__title';
    title.textContent = config.strings.modalTitle;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cookie-btn cookie-btn--ghost';
    closeBtn.textContent = config.strings.close;
    closeBtn.addEventListener('click', () => backdrop.classList.remove('cookie-consent-modal-backdrop--visible'));

    const headerDescription = document.createElement('p');
    headerDescription.className = 'cookie-consent-modal__description';
    headerDescription.textContent = config.strings.modalDescription;

    header.append(title, closeBtn);
    modal.append(header, headerDescription);

    const categoriesGrid = document.createElement('div');
    categoriesGrid.className = 'cookie-consent-categories';

    const sections = [
      {
        key: 'necessary',
        title: config.strings.categoryNecessaryTitle,
        description: config.strings.categoryNecessaryDescription,
        locked: true
      },
      {
        key: 'analytics',
        title: config.strings.categoryAnalyticsTitle,
        description: config.strings.categoryAnalyticsDescription,
        locked: false
      },
      {
        key: 'marketing',
        title: config.strings.categoryMarketingTitle,
        description: config.strings.categoryMarketingDescription,
        locked: false
      }
    ];

    sections.forEach((section) => {
      const card = document.createElement('div');
      card.className = 'cookie-category-card';

      const headerEl = document.createElement('div');
      headerEl.className = 'cookie-category-card__header';

      const heading = document.createElement('h4');
      heading.className = 'cookie-category-card__title';
      heading.textContent = section.title;

      const toggle = createToggle(Boolean(preferences[section.key]), section.locked);
      if (!section.locked) {
        toggle.addEventListener('click', () => {
          toggle.classList.toggle('cookie-toggle--active');
          preferences[section.key] = toggle.classList.contains('cookie-toggle--active');
        });
      }

      headerEl.append(heading, toggle);

      const description = document.createElement('p');
      description.className = 'cookie-category-card__description';
      description.textContent = section.description;

      card.append(headerEl, description);
      categoriesGrid.append(card);
    });

    modal.append(categoriesGrid);

    const footer = document.createElement('div');
    footer.className = 'cookie-consent-modal__footer';

    const acceptAll = document.createElement('button');
    acceptAll.type = 'button';
    acceptAll.className = 'cookie-btn cookie-btn--ghost';
    acceptAll.textContent = config.strings.acceptAll;
    acceptAll.addEventListener('click', () => {
      preferences.analytics = true;
      preferences.marketing = true;
      onSave({ ...preferences });
      backdrop.classList.remove('cookie-consent-modal-backdrop--visible');
    });

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'cookie-btn cookie-btn--primary';
    saveBtn.textContent = config.strings.saveSettings;
    saveBtn.addEventListener('click', () => {
      onSave({ ...preferences });
      backdrop.classList.remove('cookie-consent-modal-backdrop--visible');
    });

    footer.append(acceptAll, saveBtn);
    modal.append(footer);
    backdrop.append(modal);
    return backdrop;
  };

  const createReopenButton = (label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cookie-preferences-trigger';
    btn.setAttribute('aria-label', label);
    btn.innerHTML =
      '<span aria-hidden="true">⚙️</span><span class="cookie-preferences-trigger__label"></span>';
    const text = btn.querySelector('.cookie-preferences-trigger__label');
    if (text) {
      text.textContent = label;
    }
    return btn;
  };

  const applyPalette = (palette) => {
    if (!palette) return;
    const entries = Object.entries(palette).filter(([_, value]) => typeof value === 'string');
    if (!entries.length) return;
    const style = document.createElement('style');
    const variables = entries.map(([key, value]) => `--cc-${key}: ${value};`).join('\n');
    style.textContent = `:root {\n${variables}\n}`;
    document.head.appendChild(style);
  };

  const initializeConsent = (userConfig = {}) => {
    const config = mergeObjects(defaultConfig, userConfig);
    applyPalette(config.palette);

    const banner = createBanner(
      config,
      () => {
        const preferences = { necessary: true, analytics: true, marketing: true };
        savePreferences(preferences);
        hideBanner();
        showReopen();
      },
      () => {
        const preferences = { necessary: true, analytics: false, marketing: false };
        savePreferences(preferences);
        hideBanner();
        showReopen();
      },
      () => openModal()
    );

    const storedPreferences = readPreferences();
    const preferences =
      storedPreferences && typeof storedPreferences === 'object'
        ? { necessary: true, analytics: !!storedPreferences.analytics, marketing: !!storedPreferences.marketing }
        : { necessary: true, analytics: false, marketing: false };

    const modal = createModal(config, preferences, (prefs) => {
      const normalized = {
        necessary: true,
        analytics: Boolean(prefs.analytics),
        marketing: Boolean(prefs.marketing)
      };
      savePreferences(normalized);
      showReopen();
    });

    const reopenBtn = createReopenButton(config.strings.reopenSettings);
    reopenBtn.addEventListener('click', () => openModal());

    const hideBanner = () => banner.classList.remove('cookie-consent-banner--visible');
    const showBanner = () => banner.classList.add('cookie-consent-banner--visible');
    const showReopen = () => reopenBtn.classList.add('cookie-preferences-trigger--visible');

    const openModal = () => {
      modal.classList.add('cookie-consent-modal-backdrop--visible');
      hideBanner();
      showReopen();
    };

    document.body.append(banner, modal, reopenBtn);

    if (storedPreferences) {
      showReopen();
    } else {
      showBanner();
    }

    document.dispatchEvent(
      new CustomEvent('cookieconsent:ready', {
        detail: { preferences: storedPreferences, policyUrl: config.policyUrl }
      })
    );

    return {
      openSettings: openModal,
      getPreferences: () => ({ ...(readPreferences() || {}), necessary: true })
    };
  };

  window.initLocalCookieConsent = initializeConsent;
})();
