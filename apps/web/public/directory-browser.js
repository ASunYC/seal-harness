export function displayDirectoryCrumbs(listing, homeLabel) {
  const index = listing.crumbs.findIndex((crumb) => crumb.path === listing.home);
  return index < 0 ? listing.crumbs : [{ name: homeLabel, path: listing.home, hidden: false }, ...listing.crumbs.slice(index + 1)];
}

export function visibleDirectoryEntries(entries, showHidden, filterPrefix = null, selectedPath = null) {
  const needle = filterPrefix === null ? "" : filterPrefix.toLowerCase();
  const displayable = (entry) => showHidden || !entry.hidden || needle.startsWith(".");
  const matches = (entry) => displayable(entry) && entry.name.toLowerCase().startsWith(needle);
  const narrowing = needle !== "" && entries.some(matches);
  return entries.filter((entry) => entry.path === selectedPath || (narrowing ? matches(entry) : showHidden || !entry.hidden));
}

export function validDirectoryName(name) {
  return name.trim() !== "" && name !== "." && name !== ".." && !/[/\\]/.test(name);
}

export function editableDirectoryPath(listing) {
  const separator = listing.home.includes("\\") ? "\\" : "/";
  return listing.path.endsWith(separator) ? listing.path : `${listing.path}${separator}`;
}

export function directoryDraftParts(listing, draft, scanned = null) {
  const cut = listing.home.includes("\\") ? Math.max(draft.lastIndexOf("\\"), draft.lastIndexOf("/")) : draft.lastIndexOf("/");
  if (cut < 0) return { directory: null, tail: null };
  const directory = draft.slice(0, cut + 1);
  const answers = directory === editableDirectoryPath(listing) || (scanned?.directory === directory && scanned.landed === listing.path);
  return { directory, tail: answers ? draft.slice(cut + 1) : null };
}

export function parentDirectoryCrumb(listing, homeLabel) {
  return displayDirectoryCrumbs(listing, homeLabel).length < 2 ? null : listing.crumbs.at(-2) ?? null;
}

export function matchingDirectoryEntry(listing, path) {
  const windows = listing.home.includes("\\");
  const target = windows ? path.toLowerCase() : path;
  return listing.entries.find((entry) => (windows ? entry.path.toLowerCase() : entry.path) === target) ?? null;
}
