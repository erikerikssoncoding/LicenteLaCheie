(() => {
  const GA_ID = 'G-TC8YJRQQHH';
  let analyticsInitialized = false;

  const loadGtag = () => {
    if (analyticsInitialized) {
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    window.gtag = window.gtag || gtag;

    gtag('js', new Date());
    gtag('config', GA_ID);

    analyticsInitialized = true;
  };

  const handleConsent = (prefs) => {
    if (prefs && prefs.analytics) {
      loadGtag();
    }
  };

  document.addEventListener('cookieconsent:ready', (event) => {
    const preferences = event.detail?.preferences;
    handleConsent(preferences);
  });

  document.addEventListener('cookieconsent:updated', (event) => {
    handleConsent(event.detail);
  });
})();
