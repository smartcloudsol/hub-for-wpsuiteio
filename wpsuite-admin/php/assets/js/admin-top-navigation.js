/* Shared admin navigation: disclosure semantics, normal links and tab order. */
(() => {
  document.querySelectorAll('.wpsuite-top-navigation').forEach((navigation) => {
    const advanced = navigation.querySelector('.wpsuite-top-navigation__advanced');
    const toggle = advanced?.querySelector('.wpsuite-top-navigation__toggle');
    const panel = advanced?.querySelector('.wpsuite-top-navigation__panel');
    if (!advanced || !toggle || !panel || navigation.dataset.navigationReady) return;
    navigation.dataset.navigationReady = 'true';
    let closeTimer;
    let pointerInside = false;
    let pinned = false;
    let ignoreFocusOpen = false;
    const cancelClose = () => window.clearTimeout(closeTimer);
    const setOpen = (open) => {
      cancelClose();
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (!open) pinned = false;
    };
    const scheduleClose = () => {
      cancelClose();
      closeTimer = window.setTimeout(() => {
        if (!pinned && !pointerInside && !advanced.contains(document.activeElement)) setOpen(false);
      }, 160);
    };
    advanced.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      pointerInside = true;
      setOpen(true);
    });
    advanced.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      pointerInside = false;
      scheduleClose();
    });
    advanced.addEventListener('focusin', () => {
      cancelClose();
      if (!ignoreFocusOpen) setOpen(true);
    });
    advanced.addEventListener('focusout', () => {
      // Wait until focus has moved, then close if keyboard navigation left the group.
      window.setTimeout(() => {
        if (!advanced.contains(document.activeElement)) { pinned = false; scheduleClose(); }
      }, 0);
    });
    toggle.addEventListener('click', () => {
      if (pinned) { setOpen(false); return; }
      pinned = true;
      setOpen(true);
    });
    advanced.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        ignoreFocusOpen = true;
        toggle.focus();
        ignoreFocusOpen = false;
      } else if (event.key === 'ArrowDown' && event.target === toggle) {
        event.preventDefault();
        setOpen(true);
        panel.querySelector('a')?.focus();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!advanced.contains(event.target)) setOpen(false);
    });
  });
})();
