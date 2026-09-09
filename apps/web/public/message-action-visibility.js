/** Latest message of each conversational role keeps its actions visible. */
export function messageActionRevealModes(roles) {
  const seen = new Set();
  const modes = Array(roles.length).fill("hover");
  for (let index = roles.length - 1; index >= 0; index -= 1) {
    const role = roles[index];
    if ((role === "user" || role === "assistant") && !seen.has(role)) { modes[index] = "always"; seen.add(role); }
  }
  return modes;
}
