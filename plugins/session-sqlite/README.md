# @piharness/session-sqlite

基于 Node 内置 `node:sqlite` 的事务 Session Store。支持乐观版本控制、原子多事件
append 和原子 fork，无第三方运行时依赖。
