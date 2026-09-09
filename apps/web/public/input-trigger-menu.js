export function renderInputTriggerOptions(menu, candidates, accept) {
  menu.replaceChildren();
  for (const [index, candidate] of candidates.entries()) {
    const option = document.createElement("button");
    option.type = "button";
    option.id = `input-trigger-option-${index}`;
    option.className = `input-trigger-option${index === 0 ? " active" : ""}`;
    option.role = "option";
    option.setAttribute("aria-selected", String(index === 0));
    option.dataset.candidate = JSON.stringify(candidate);
    const name = document.createElement("span"); name.textContent = `@${candidate.name}`;
    const description = document.createElement("small"); description.textContent = candidate.description || candidate.source || "";
    option.append(name, description);
    option.addEventListener("mousedown", (event) => { event.preventDefault(); accept(candidate); });
    menu.append(option);
  }
  menu.hidden = candidates.length === 0;
  syncInputTriggerSelection(menu, 0);
}

export function syncInputTriggerSelection(menu, index) {
  const options = [...menu.querySelectorAll(".input-trigger-option")];
  for (const [optionIndex, option] of options.entries()) {
    const selected = optionIndex === index;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-selected", String(selected));
  }
  const selected = options[index];
  const controller = menu.id ? document.querySelector(`[aria-controls="${menu.id}"]`) : undefined;
  if (selected?.id) controller?.setAttribute("aria-activedescendant", selected.id);
  else controller?.removeAttribute("aria-activedescendant");
  return selected;
}

export function inputTriggerKeyAction(key, candidate) {
  if (key === "Escape") return "dismiss";
  if (key === "ArrowDown") return "next";
  if (key === "ArrowUp") return "previous";
  if (key === "Enter") return "accept";
  if (key === "Tab" && candidate?.drill === true) return "drill";
}

export function detectActiveAtTrigger(value, caret) {
  const before = value.slice(0, caret);
  const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(before);
  const match = quoted?.[1] !== undefined ? quoted : /(?:^|\s)(@([^\s]*))$/u.exec(before);
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  const start = caret - match[1].length;
  return { trigger: "@", query: match[2], quoted: quoted?.[1] !== undefined, position: value.search(/\S/u) === start ? "leading" : "inline", start, end: caret };
}
