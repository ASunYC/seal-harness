import { renderReviewSnapshot } from "./review-view.js?v=0.3.4-2";
const names = {
  read_file: ["读取文件", "Read file"], write_file: ["写入文件", "Write file"],
  replace_text: ["修改文本", "Replace text"], make_directory: ["创建目录", "Create directory"],
  list_files: ["浏览文件", "List files"], search_text: ["搜索文本", "Search text"], shell: ["执行命令", "Run command"],
};
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = value => typeof value === "string" ? value : "";

// Native search output uses path:line:text. Fall back to raw output if it
// cannot be interpreted without dropping a diagnostic or ambiguous record.
function searchGroups(output) {
  if (!output || output.length > 50_000) return undefined;
  const groups = new Map();
  const lines = output.replace(/\n$/, "").split("\n");
  for (const value of lines) {
    const match = /^(.+?):([1-9]\d*):(.*)$/.exec(value);
    if (!match || !Number.isSafeInteger(Number(match[2]))) return undefined;
  }
  for (const value of lines.slice(0, 200)) {
    const [, path, line, content] = /^(.+?):([1-9]\d*):(.*)$/.exec(value);
    const rows = groups.get(path) ?? []; rows.push({ line, content }); groups.set(path, rows);
  }
  return { groups: [...groups].map(([path, rows]) => ({ path, rows })), hidden: Math.max(0, lines.length - 200) };
}

export function toolCardModel(call, result, locale = "zh-CN") {
  if (!Object.hasOwn(names, call.name)) return undefined;
  const zh = locale === "zh-CN";
  const label = (cn, en) => zh ? cn : en;
  const args = object(call.arguments);
  const meta = object(result?.details ?? result?.meta);
  const output = (result?.content ?? []).filter(block => block.type === "text").map(block => text(block.text)).join("\n");
  const blocks = [];
  const add = (title, content, kind = "code") => { if (typeof content === "string" && content.length) blocks.push({ title, content, kind }); };
  const completed = result !== undefined;
  const failed = completed && (result.isError === true || (call.name === "shell" && typeof meta.exitCode === "number" && meta.exitCode !== 0));
  const badges = [];
  if (typeof meta.exitCode === "number") badges.push(`${label("退出码", "Exit")} ${meta.exitCode}`);
  if (typeof meta.count === "number") badges.push(`${meta.count} ${call.name === "search_text" ? label("处匹配", "matches") : label("项", "items")}`);
  if (meta.truncated === true) badges.push(label("结果已截断", "Result truncated"));
  if (meta.timedOut === true) badges.push(label("超时", "Timed out"));
  if (call.name === "shell") {
    add(label("命令", "Command"), args.command);
    if (typeof meta.stdout === "string" || typeof meta.stderr === "string") {
      add(label("标准输出", "Standard output"), meta.stdout);
      add(label("错误输出", "Standard error"), meta.stderr, "error");
    } else add(label("输出", "Output"), output, failed ? "error" : "code");
  } else if (call.name === "replace_text") {
    add(label("替换前（请求）", "Before (requested)"), args.oldText, "removed");
    add(label("替换后（请求）", "After (requested)"), args.newText, "added");
    add(label("执行结果", "Result"), output, failed ? "error" : "note");
  } else if (call.name === "write_file") {
    add(label("写入内容（请求）", "Content (requested)"), args.content);
    add(label("执行结果", "Result"), output, failed ? "error" : "note");
  } else {
    if (call.name === "search_text") add(label("搜索条件", "Query"), args.query, "note");
    const matches = call.name === "search_text" && !failed ? searchGroups(output) : undefined;
    if (matches) blocks.push({ title: label("匹配结果", "Matches"), kind: "matches", ...matches });
    else add(label("结果", "Result"), output, failed ? "error" : call.name === "list_files" || call.name === "search_text" ? "list" : "code");
  }
  if (completed && !output && !text(meta.stdout) && !text(meta.stderr) && !failed) {
    add(label("结果", "Result"), label("执行完成，无文本输出", "Completed without text output"), "note");
  }
  return {
    title: names[call.name][zh ? 0 : 1], subject: text(args.path) || (call.name === "shell" ? text(args.command) : ""),
    phase: !completed ? "running" : failed ? "error" : "completed",
    status: !completed ? label("执行中", "Running") : failed ? label("失败", "Failed") : label("完成", "Completed"), badges, blocks,
  };
}

export function createToolCard(call, locale = "zh-CN", doc = document, { loadReview, rollbackReview } = {}) {
  if (!toolCardModel(call, undefined, locale)) return undefined;
  const root = doc.createElement("details"); root.className = "tool semantic-tool"; root.dataset.chatFlow = "";
  const summary = doc.createElement("summary"); const title = doc.createElement("strong");
  const subject = doc.createElement("span"); subject.className = "semantic-tool-subject";
  const status = doc.createElement("span"); status.className = "semantic-tool-status";
  summary.append(title, subject, status);
  const body = doc.createElement("div"); body.className = "semantic-tool-body"; root.append(summary, body);
  let settled = false;
  let preview;
  function progress(content) {
    if (settled) return;
    const value = (content ?? []).filter(block => block.type === "text").map(block => text(block.text)).join("\n");
    if (!value) return;
    if (!preview) {
      const section = doc.createElement("section"); section.className = "semantic-tool-block tool-progress";
      const heading = doc.createElement("h4"); heading.textContent = locale === "zh-CN" ? "运行中输出（尚未完成）" : "Live output (not completed)";
      const pre = doc.createElement("pre"); const limit = doc.createElement("p"); limit.className = "semantic-tool-limit";
      limit.textContent = locale === "zh-CN" ? "预览仅显示前 400 行 / 50,000 字符。" : "Preview limited to 400 lines / 50,000 characters.";
      section.append(heading, pre, limit); body.append(section); preview = { pre, limit };
    }
    const lines = value.slice(0, 50_000).split("\n");
    // Runtime progress contains the latest partial result, not text deltas.
    preview.pre.textContent = lines.slice(0, 400).join("\n");
    preview.limit.hidden = value.length <= 50_000 && lines.length <= 400;
  }
  function update(result) {
    settled = result !== undefined; preview = undefined;
    const model = toolCardModel(call, result, locale);
    root.dataset.phase = model.phase; title.textContent = model.title;
    if (settled) root.dataset.activityPhase = "waiting";
    else delete root.dataset.activityPhase;
    subject.textContent = model.subject.replace(/\s+/g, " ").slice(0, 160); subject.title = model.subject;
    status.textContent = model.status; body.replaceChildren();
    const review = object(object(result?.details ?? result?.meta).review);
    if (review.available === true && typeof review.snapshotId === "string" && loadReview) {
      const button = doc.createElement("button"); button.type = "button"; button.textContent = locale === "zh-CN" ? "查看实际修改" : "Review recorded change";
      body.append(button);
      button.onclick = async () => {
        button.disabled = true;
        try {
          const snapshot = await loadReview(review.snapshotId);
          if (body.contains(button)) { body.querySelector(".review-error")?.remove(); button.replaceWith(renderReviewSnapshot(snapshot, locale, doc, { rollback: rollbackReview })); }
        } catch (error) {
          if (!body.contains(button)) return;
          let note = body.querySelector(".review-error");
          if (!note) { note = doc.createElement("p"); note.className = "review-error"; note.setAttribute("role", "alert"); button.after(note); }
          note.textContent = error.message; button.disabled = false;
        }
      };
    } else if (review.available === false) {
      const note = doc.createElement("p"); note.textContent = locale === "zh-CN" ? "未保存修改快照：文件超过快照大小上限。" : "Change snapshot unavailable: file exceeds the snapshot size limit."; body.append(note);
    }
    if (model.badges.length) { const badges = doc.createElement("div"); badges.className = "semantic-tool-badges"; badges.textContent = model.badges.join(" · "); body.append(badges); }
    for (const block of model.blocks) {
      const section = doc.createElement("section"); section.className = `semantic-tool-block ${block.kind}`;
      const heading = doc.createElement("h4"); heading.textContent = block.title; section.append(heading);
      if (block.kind === "matches") {
        for (const group of block.groups) {
          const file = doc.createElement("div"); file.className = "search-match-file";
          const name = doc.createElement("h5"); name.textContent = group.path; file.append(name);
          const rows = doc.createElement("ol");
          for (const match of group.rows) {
            const row = doc.createElement("li");
            const number = doc.createElement("span"); number.className = "search-match-line"; number.textContent = match.line;
            number.setAttribute("aria-label", `${locale === "zh-CN" ? "行号" : "Line"} ${match.line}`);
            const code = doc.createElement("code"); code.textContent = match.content;
            row.append(number, code); rows.append(row);
          }
          file.append(rows); section.append(file);
        }
        if (block.hidden) {
          const note = doc.createElement("p"); note.className = "semantic-tool-limit";
          note.textContent = locale === "zh-CN" ? `另有 ${block.hidden} 处匹配未展示；完整内容见会话日志。` : `${block.hidden} more matches; full content is in the session log.`;
          section.append(note);
        }
        body.append(section); continue;
      }
      const pre = doc.createElement("pre");
      // Bound DOM/text layout work; the original result remains in the session log.
      const lines = block.content.slice(0, 50_000).split("\n");
      pre.textContent = lines.slice(0, 400).join("\n"); section.append(pre);
      if (block.content.length > 50_000 || lines.length > 400) {
        const note = doc.createElement("p"); note.className = "semantic-tool-limit";
        note.textContent = locale === "zh-CN" ? "仅展示前 400 行 / 50,000 字符；完整内容见会话日志。" : "Preview limited to 400 lines / 50,000 characters; full content is in the session log.";
        section.append(note);
      }
      body.append(section);
    }
  }
  update(undefined);
  return { root, update, progress };
}
