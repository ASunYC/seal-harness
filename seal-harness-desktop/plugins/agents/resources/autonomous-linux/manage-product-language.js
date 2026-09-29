(() => {
  // STRATEX_MANAGE_PRODUCT_LANGUAGE_V1
  const replacements = [
    [/运行时（Runtime）/gu, '智能体运行服务'],
    [/AgentEarth Manager/giu, '智能体管理'],
    [/AgentEarth/giu, 'Seal Harness'],
    [/从\s+Hermes\s+同步智能体/gu, '从模型服务同步智能体'],
    [/HERMES\s+原生通道/giu, '模型服务原生通道'],
    [/Hermes\s+智能体目录同步/gu, '模型服务智能体目录同步'],
    [
      /来源为\s+Hermes Dashboard\s+的\s+Profiles：default\s+为主智能体/gu,
      '来源为模型服务管理页面的智能体档案：默认档案为主智能体',
    ],
    [/打开 SDK 对话/gu, '打开调用接口对话'],
    [/Agent 管理/gu, '智能体管理'],
    [/Agent Catalog/gu, '智能体目录'],
    [/Runtime Key/gu, '运行服务访问令牌'],
    [/Runtime 鉴权凭据/gu, '运行服务访问凭据'],
    [/本机管理入口/gu, '管理入口'],
    [/Runtime MCP Tool/gu, '智能体运行 MCP 工具'],
    [/Manager 内置智能体/gu, '管理页面内置智能体'],
    [/Manager MCP 与 Skill 架构助手/gu, '管理页面 MCP 与 Skill 架构助手'],
    [/HERMES/gu, '模型服务'],
    [/Hermes/gu, '模型服务'],
    [/Runtime/gu, '运行服务'],
    [/运行时/gu, '智能体运行'],
    [/Snapshot/gu, '发布版本'],
    [/Profiles/gu, '智能体档案'],
    [/Profile/gu, '智能体档案'],
    [/Manager/gu, '管理页面'],
    [/Catalog/gu, '目录'],
    [/Supervisor/gu, '后台服务'],
    [/Docker Desktop/gu, '容器环境'],
    [/SOUL/gu, '角色说明'],
    [/Dashboard/gu, '管理页面'],
    [/Journal/gu, '事务日志'],
    [/Phase/gu, '阶段'],
    [/Transaction/gu, '事务'],
    [/Recovery/gu, '恢复状态'],
  ];
  const attributes = ['aria-label', 'title', 'placeholder'];
  const translate = (value) => {
    let current = replacements.reduce(
      (translated, [pattern, replacement]) => translated.replace(pattern, replacement),
      value,
    );
    return current
      .replace(/从\s+模型服务\s+同步/gu, '从模型服务同步')
      .replace(/模型服务\s+原生通道/gu, '模型服务原生通道')
      .replace(/发布版本\s+→\s+模型服务\s+的/gu, '发布版本 → 模型服务的')
      .replace(/来源为\s+模型服务\s+管理页面/gu, '来源为模型服务管理页面')
      .replace(/模型服务\s+管理页面/gu, '模型服务管理页面')
      .replace(/管理页面（管理页面）/gu, '管理页面')
      .replace(/事务日志（事务日志）/gu, '事务日志')
      .replace(/阶段（阶段）/gu, '阶段')
      .replace(/事务（事务）/gu, '事务')
      .replace(/恢复状态（恢复状态）/gu, '恢复状态');
  };
  const visit = (root) => {
    if (root.nodeType === Node.TEXT_NODE && root.nodeValue) {
      const translated = translate(root.nodeValue);
      if (translated !== root.nodeValue) root.nodeValue = translated;
    }
    if (root instanceof Element) {
      for (const attribute of attributes) {
        const value = root.getAttribute(attribute);
        if (value) {
          const translated = translate(value);
          if (translated !== value) root.setAttribute(attribute, translated);
        }
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue) {
        const translated = translate(node.nodeValue);
        if (translated !== node.nodeValue) node.nodeValue = translated;
      }
      if (node instanceof Element) {
        for (const attribute of attributes) {
          const value = node.getAttribute(attribute);
          if (value) {
            const translated = translate(value);
            if (translated !== value) node.setAttribute(attribute, translated);
          }
        }
      }
    }
  };
  visit(document.documentElement);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') visit(mutation.target);
      for (const node of mutation.addedNodes) visit(node);
    }
  }).observe(document.documentElement, { childList: true, characterData: true, subtree: true });
})();
