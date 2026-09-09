export const SIDEBAR_MIN = 264;
export const SIDEBAR_MAX = 420;
export const SIDEBAR_DEFAULT = 280;
export const SIDEBAR_COLLAPSED = 56;
export const SIDEBAR_AUTO_COLLAPSE = 1024;
export const CENTER_MIN = 640;
export const DETAILS_MIN = 300;
export const DETAILS_MAX = 520;
export const DETAILS_DEFAULT = 360;

export function clampWidth(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function computeColumns(viewport, sidebar, details) {
  const resolvedSidebar = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX);
  const preferredDetails = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX);
  if (resolvedSidebar + preferredDetails + CENTER_MIN <= viewport) return { sidebar: resolvedSidebar, center: viewport - resolvedSidebar - preferredDetails, details: preferredDetails };
  const reducedDetails = preferredDetails === 0 ? 0 : Math.max(DETAILS_MIN, viewport - resolvedSidebar - CENTER_MIN);
  if (resolvedSidebar + reducedDetails + CENTER_MIN <= viewport) return { sidebar: resolvedSidebar, center: CENTER_MIN, details: reducedDetails };
  return { sidebar: resolvedSidebar, center: Math.max(0, viewport - resolvedSidebar), details: 0 };
}

export function effectiveSidebarCollapsed(viewport, wideCollapsed, narrowExpanded) {
  return viewport < SIDEBAR_AUTO_COLLAPSE ? !narrowExpanded : wideCollapsed;
}
