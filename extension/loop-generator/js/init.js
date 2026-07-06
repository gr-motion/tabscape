document.addEventListener('DOMContentLoaded', () => {
  app = new App();
  app.init();
  windowDropHandler.init(app.parameterPanel);
});