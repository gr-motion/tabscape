document.addEventListener('DOMContentLoaded', () => {
  app = new App();
  app.init();
  // Window-level drop only for settings JSON, not images
  // Images load via their respective upload controls
});