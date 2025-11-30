document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.initLocalCookieConsent !== 'function') {
    return;
  }

  window.initLocalCookieConsent({
    policyUrl: '/politica-cookie',
    palette: {
      bg: 'var(--surface-strong)',
      text: 'var(--text-primary)',
      muted: 'var(--text-secondary)',
      border: 'var(--border-color)',
      accent: 'var(--accent)',
      shadow: '0 18px 38px rgba(15, 23, 42, 0.1)',
      radius: '18px'
    },
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
      close: 'Închide'
    }
  });
});
