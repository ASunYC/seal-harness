import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";

const environment = { ...process.env, SEAL_DESKTOP_NODE: process.execPath,
  SEAL_DESKTOP_WORKSPACE: process.env.INIT_CWD || process.cwd() };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [fileURLToPath(new URL("..", import.meta.url))], {
  stdio: "inherit", windowsHide: true,
  env: environment,
});
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
