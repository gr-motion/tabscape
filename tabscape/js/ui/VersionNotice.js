/**
 * VersionNotice - one-time "new version available" popup shown on page open.
 * Self-contained: builds its own DOM and styles hooks, removes itself on close.
 */
(function () {
  const V5_URL = 'https://tabscape-v5.vercel.app/tabscape/';

  function build() {
    const backdrop = document.createElement('div');
    backdrop.className = 'version-notice';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'version-notice-title');

    const card = document.createElement('div');
    card.className = 'version-notice__card';

    const title = document.createElement('h2');
    title.id = 'version-notice-title';
    title.className = 'version-notice__title';
    title.textContent = 'New version available';

    const body = document.createElement('p');
    body.className = 'version-notice__body';
    body.textContent = 'Tabscape v5 is out — with interactive HTML export.';

    const actions = document.createElement('div');
    actions.className = 'version-notice__actions';

    const stayBtn = document.createElement('button');
    stayBtn.type = 'button';
    stayBtn.className = 'settings-bar__btn version-notice__btn';
    stayBtn.textContent = 'Stay';

    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'settings-bar__btn version-notice__btn version-notice__btn--primary';
    goBtn.textContent = 'Go to v5';

    actions.append(stayBtn, goBtn);
    card.append(title, body, actions);
    backdrop.append(card);

    function close() {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    }

    stayBtn.addEventListener('click', close);
    goBtn.addEventListener('click', () => {
      window.location.href = V5_URL;
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(backdrop);
    stayBtn.focus();
  }

  function init() {
    try {
      build();
    } catch (err) {
      console.warn('VersionNotice failed to render', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
