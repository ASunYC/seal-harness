export interface DirectoryEntry { readonly name: string; readonly path?: string; readonly hidden?: boolean }
export interface DirectoryCrumb { readonly name: string; readonly path: string; readonly hidden: boolean }
export interface DirectoryListing {
  readonly home: string;
  readonly path?: string;
  readonly crumbs?: readonly DirectoryCrumb[];
  readonly entries?: readonly DirectoryEntry[];
}
export function displayDirectoryCrumbs(listing: DirectoryListing & { readonly crumbs: readonly DirectoryCrumb[] }, homeLabel: string): DirectoryCrumb[];
export function visibleDirectoryEntries<T extends DirectoryEntry>(entries: readonly T[], showHidden: boolean, filterPrefix?: string | null, selectedPath?: string | null): T[];
export function validDirectoryName(name: string): boolean;
export function editableDirectoryPath(listing: DirectoryListing & { readonly path: string }): string;
export function directoryDraftParts(listing: DirectoryListing & { readonly path: string }, draft: string, scanned?: { readonly directory: string; readonly landed: string } | null): { directory: string | null; tail: string | null };
export function parentDirectoryCrumb(listing: DirectoryListing & { readonly crumbs: readonly DirectoryCrumb[] }, homeLabel: string): DirectoryCrumb | null;
export function matchingDirectoryEntry<T extends DirectoryEntry>(listing: DirectoryListing & { readonly entries: readonly T[] }, path: string): T | null;
