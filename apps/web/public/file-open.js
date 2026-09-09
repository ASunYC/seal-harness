export function isFolderOpenPath(path) {
  return path === ".";
}

export function openFailureMessage(error, fallback) {
  const message = error instanceof Error ? error.message : String(error);
  return message === "" ? fallback : message;
}
