(function () {
  const links = [
    { href: 'index.html', label: 'Home' },
    { href: 'parser.html', label: 'Parser' },
    { href: 'generator.html', label: 'Generator' },
    { href: 'checkout.html', label: 'Checkout' },
    { href: 'validator.html', label: 'Validator' },
    { href: 'about.html', label: 'About' },
  ];

  function currentPageName() {
    const path = window.location.pathname.split('/').pop();
    return path || 'index.html';
  }

  function closeMenu(button, panel, backdrop) {
    button.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove('site-menu-open');
  }

  function openMenu(button, panel, backdrop) {
    button.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    backdrop.hidden = false;
    document.body.classList.add('site-menu-open');
  }

  function toggleMenu(button, panel, backdrop) {
    if (panel.hidden) {
      openMenu(button, panel, backdrop);
    } else {
      closeMenu(button, panel, backdrop);
    }
  }

  function createLinkList() {
    const list = document.createElement('nav');
    list.className = 'site-menu-links';
    list.setAttribute('aria-label', 'Site pages');
    const pageName = currentPageName();

    for (const linkData of links) {
      const link = document.createElement('a');
      link.href = linkData.href;
      link.textContent = linkData.label;
      if (pageName === linkData.href) {
        link.setAttribute('aria-current', 'page');
      }
      list.appendChild(link);
    }

    return list;
  }

  function initSiteMenu() {
    if (document.querySelector('.site-menu-button')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'site-menu-button';
    button.setAttribute('aria-label', 'Open site menu');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span></span><span></span><span></span>';

    const backdrop = document.createElement('div');
    backdrop.className = 'site-menu-backdrop';
    backdrop.hidden = true;

    const panel = document.createElement('section');
    panel.className = 'site-menu-panel';
    panel.hidden = true;
    panel.appendChild(createLinkList());

    button.addEventListener('click', () => {
      toggleMenu(button, panel, backdrop);
    });
    backdrop.addEventListener('click', () => {
      closeMenu(button, panel, backdrop);
    });
    panel.addEventListener('click', event => {
      if (event.target.tagName === 'A') closeMenu(button, panel, backdrop);
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeMenu(button, panel, backdrop);
    });

    document.body.append(button, backdrop, panel);
  }

  window.emvSiteMenu = { initSiteMenu };
  initSiteMenu();
}());
