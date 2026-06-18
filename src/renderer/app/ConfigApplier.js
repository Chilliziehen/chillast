export function applyConfig(config) {
  if (!config) return;
  const root = document.documentElement;
  const set = (name, val) => root.style.setProperty(name, String(val));
  const kebab = (k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

  if (config.spacing) {
    for (const [name, val] of Object.entries(config.spacing)) {
      set(`--sp-${name}`, val);
    }
  }

  if (config.type) {
    for (const [name, val] of Object.entries(config.type)) {
      set(`--fs-${name}`, val);
    }
  }

  if (config.weight) {
    for (const [name, val] of Object.entries(config.weight)) {
      set(`--fw-${name}`, String(val));
    }
  }

  if (config.colors) {
    for (const [key, val] of Object.entries(config.colors)) {
      set(`--${kebab(key)}`, val);
    }
  }

  if (config.radii) {
    for (const [name, val] of Object.entries(config.radii)) {
      set(`--radius-${name}`, val);
    }
  }

  if (config.shadows) {
    for (const [name, val] of Object.entries(config.shadows)) {
      set(`--shadow-${name}`, val);
    }
  }

  if (config.layout) {
    const l = config.layout;
    if (l.sidebarWidth != null) set('--sidebar-width', `${l.sidebarWidth}px`);
    if (l.chartCanvasMaxWidth != null) set('--chart-max-width', `${l.chartCanvasMaxWidth}px`);
    if (l.workbenchGridColumns != null) set('--workbench-grid', l.workbenchGridColumns);
  }
}
