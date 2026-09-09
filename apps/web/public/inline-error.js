export function clearInlineError(container, className) {
  container.querySelector(`.${className}`)?.remove();
}

export function showInlineError(container, className, message) {
  let error = container.querySelector(`.${className}`);
  if (!error) {
    error = document.createElement("p"); error.className = className; error.setAttribute("role", "alert"); container.append(error);
  }
  error.textContent = message;
  return error;
}
