/** Contiguous replacement hunk from verified snapshots, not tool arguments. */
export function reviewLines(before, after, limit = 400) {
  const left = before === null ? [] : before.split("\n"), right = after.split("\n");
  let head = 0, tail = 0;
  while (head < left.length && head < right.length && left[head] === right[head]) head++;
  if (head === left.length && head === right.length) return { lines: [], truncated: false };
  while (tail < left.length - head && tail < right.length - head && left[left.length - tail - 1] === right[right.length - tail - 1]) tail++;
  const lines = []; let total = 0;
  function add(kind, text, oldLine, newLine) { total++; if (lines.length < limit) lines.push({ kind, text, oldLine, newLine }); }
  for (let i = Math.max(0, head - 3); i < head; i++) add("context", left[i], i + 1, i + 1);
  for (let i = head; i < left.length - tail; i++) add("removed", left[i], i + 1, null);
  for (let i = head; i < right.length - tail; i++) add("added", right[i], null, i + 1);
  for (let i = 0; i < Math.min(tail, 3); i++) add("context", left[left.length - tail + i], left.length - tail + i + 1, right.length - tail + i + 1);
  return { lines, truncated: total > lines.length };
}

export function renderReviewSnapshot(snapshot, locale = "zh-CN", doc = document, { rollback } = {}) {
  const zh = locale === "zh-CN"; const root = doc.createElement("section"); root.className = "review-evidence";
  const title = doc.createElement("h4"); title.textContent = `${zh ? "当次修改快照" : "Recorded change"} · ${snapshot.path}`; root.append(title);
  if (snapshot.status === "rolled-back") {
    const note = doc.createElement("p"); note.textContent = zh ? "此次修改已回退，以下保留原修改记录。" : "This change was rolled back; its original evidence is retained."; root.append(note);
  } else if (snapshot.status !== "applied") {
    const warning = doc.createElement("p"); warning.setAttribute("role", "alert");
    warning.textContent = zh ? "写后核对发生冲突；下方目标内容不能确认已完整应用。" : "Post-write verification conflicted; the target below is not confirmed as applied."; root.append(warning);
  }
  const diff = reviewLines(snapshot.before, snapshot.after);
  const code = doc.createElement("pre"); code.className = "review-diff";
  for (const line of diff.lines) {
    const row = doc.createElement("span"); row.className = `review-line ${line.kind}`;
    const gutter = doc.createElement("span"); gutter.className = "review-gutter"; gutter.setAttribute("aria-hidden", "true"); gutter.textContent = `${line.oldLine ?? ""}`.padStart(4) + " " + `${line.newLine ?? ""}`.padStart(4) + " ";
    row.append(gutter, doc.createTextNode(`${line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "} ${line.text}\n`)); code.append(row);
  }
  root.append(code);
  if (!diff.lines.length || diff.truncated) {
    const note = doc.createElement("p"); note.textContent = diff.truncated ? (zh ? "差异预览限 400 行；可展开完整快照。" : "Diff preview limited to 400 lines; expand the full snapshots.") : (zh ? "文本内容没有变化。" : "No text changes."); root.append(note);
  }
  for (const [label, value] of [[zh ? "完整修改前" : "Full before", snapshot.before], [zh ? "完整修改后" : "Full after", snapshot.after]]) {
    const details = doc.createElement("details"); const summary = doc.createElement("summary"); summary.textContent = label; details.append(summary);
    details.addEventListener("toggle", () => {
      if (details.open && !details.querySelector("pre")) { const pre = doc.createElement("pre"); pre.textContent = value === null ? (zh ? "文件此前不存在" : "File did not exist") : value; details.append(pre); }
    }); root.append(details);
  }
  if (snapshot.status === "applied" && rollback) {
    const actions = doc.createElement("div"); actions.className = "review-actions";
    const start = doc.createElement("button"); start.type = "button"; start.textContent = zh ? "回退此次修改" : "Roll back this change"; actions.append(start); root.append(actions);
    start.onclick = () => {
      start.hidden = true;
      const confirmation = doc.createElement("div"); confirmation.className = "review-confirmation";
      const warning = doc.createElement("p");
      warning.textContent = snapshot.before === null
        ? (zh ? `确认删除此次新建的文件 ${snapshot.path}？文件有后续修改时会拒绝回退。` : `Delete the newly created file ${snapshot.path}? Later edits will block rollback.`)
        : (zh ? `确认将 ${snapshot.path} 恢复到此次修改之前？请先停止相关任务和外部编辑。` : `Restore ${snapshot.path} to its prior content? Stop related tasks and external editing first.`);
      const confirm = doc.createElement("button"); confirm.type = "button"; confirm.textContent = zh ? "确认回退" : "Confirm rollback";
      const cancel = doc.createElement("button"); cancel.type = "button"; cancel.textContent = zh ? "取消" : "Cancel";
      const error = doc.createElement("p"); error.setAttribute("role", "alert"); error.hidden = true;
      confirmation.append(warning, cancel, confirm, error); actions.append(confirmation); cancel.focus();
      cancel.onclick = () => { confirmation.remove(); start.hidden = false; start.focus(); };
      confirm.onclick = async () => {
        if (confirm.disabled) return;
        confirm.disabled = true; cancel.disabled = true; error.hidden = true;
        try {
          const result = await rollback(snapshot.id);
          if (!["rolled-back", "already-rolled-back"].includes(result?.outcome)) throw new Error(zh ? "未确认回退成功，请刷新查看。" : "Rollback was not confirmed; refresh to check.");
          const done = doc.createElement("p"); done.setAttribute("role", "status"); done.textContent = zh ? "此次修改已回退，原修改记录保留。" : "Change rolled back; original evidence retained."; actions.replaceChildren(done);
        } catch (failure) { error.textContent = failure.message; error.hidden = false; confirm.disabled = false; cancel.disabled = false; }
      };
    };
  }
  return root;
}
