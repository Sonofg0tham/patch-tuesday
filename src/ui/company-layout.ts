/** Rearranges the existing controls without duplicating input handlers. */
export function createCompanyLayout(onFit: () => void): { dispose(): void } {
  const find = (id: string): HTMLElement => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Company layout requires #${id}`);
    return element;
  };
  const hud = find('hud');
  const header = document.createElement('header');
  header.id = 'command-header';
  const identity = document.createElement('div');
  identity.className = 'company-identity';
  identity.append(find('hud-title'), find('hud-subtitle'));
  const metrics = document.createElement('div');
  metrics.className = 'company-metrics';
  metrics.append(find('hud-clockrow'), find('hud-resources'), find('hud-pressure'));
  const objective = document.createElement('section');
  objective.id = 'company-objective';
  objective.setAttribute('aria-label', 'Current objective');
  objective.append(find('situation-objective'), find('situation-threat'), find('hud-notice'));
  header.append(identity, metrics, objective);

  const sidebar = document.createElement('aside');
  sidebar.id = 'company-sidebar';
  sidebar.setAttribute('aria-label', 'Asset inspection');
  const toolbar = document.createElement('div');
  toolbar.className = 'company-tools';
  const register = document.createElement('button');
  register.type = 'button';
  register.textContent = 'Asset register';
  register.setAttribute('aria-expanded', 'false');
  register.setAttribute('aria-controls', 'roster');
  register.id = 'register-toggle';
  const fit = document.createElement('button');
  fit.type = 'button';
  fit.textContent = 'Fit estate';
  fit.id = 'fit-estate';
  fit.addEventListener('click', onFit);
  toolbar.append(register, fit);
  const inspector = find('inspector');
  const history = document.createElement('details');
  history.id = 'company-history';
  const summary = document.createElement('summary');
  summary.textContent = 'Incident history';
  history.append(summary, find('timeline-panel'));
  const roster = find('roster');
  roster.hidden = true;
  sidebar.append(toolbar, inspector, history, roster);
  const tray = document.createElement('footer');
  tray.id = 'command-tray';
  tray.append(find('action-bar'), find('incident-controls'), find('action-reason'), find('hud-help'));
  find('situation-panel').hidden = true;
  // All situation elements remain under #hud for the existing renderer.
  hud.append(header, sidebar, tray);
  hud.classList.add('company-layout');

  function toggle(open: boolean): void {
    roster.hidden = !open;
    inspector.hidden = open;
    history.hidden = open;
    for (const id of ['response-guide', 'response-help']) {
      const element = document.getElementById(id);
      if (element) element.hidden = open;
    }
    register.setAttribute('aria-expanded', String(open));
    register.textContent = open ? 'Close register' : 'Asset register';
    if (open) roster.querySelector<HTMLButtonElement>('button')?.focus();
    else register.focus();
  }
  register.addEventListener('click', () => toggle(roster.hidden));
  const escape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || roster.hidden) return;
    // A modal above us owns Escape while the game is paused.
    if (sidebar.closest('[inert]') || ['pause', 'settings', 'handover', 'menu'].some((id) => !find(id).hidden)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle(false);
  };
  window.addEventListener('keydown', escape, true);
  const observer = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--company-top', `${header.getBoundingClientRect().bottom + 12}px`);
    document.documentElement.style.setProperty('--company-bottom', `${window.innerHeight - tray.getBoundingClientRect().top + 12}px`);
    onFit();
  });
  observer.observe(header);
  observer.observe(tray);
  observer.observe(sidebar);
  return { dispose() { observer.disconnect(); window.removeEventListener('keydown', escape, true); } };
}
