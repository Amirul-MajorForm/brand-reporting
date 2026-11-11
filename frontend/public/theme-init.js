// Runs before first paint (loaded from index.html): applies the theme the
// viewer chose last time, so the loading screen does not flash light in dark mode.
try {
  if (localStorage.getItem('os_theme') === 'dark') document.documentElement.dataset.theme = 'dark';
} catch { /* storage unavailable: light theme */ }
