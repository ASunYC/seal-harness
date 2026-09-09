import { installProxyFromEnvironment } from "@deepseek-ai/dsh-http-proxy";
import { Kernel, type EventMap, type KernelOptions } from "@seal-harness/kernel";
import type { Profile } from "./profile.js";

const processProxyEnvironment = {
  get(name: string): { readonly value: string } | undefined {
    const value = process.env[name];
    return value === undefined ? undefined : { value };
  },
};

export async function startProfile<TEvents extends EventMap = EventMap>(
  profile: Profile<TEvents>,
  options: KernelOptions = {},
): Promise<Kernel<TEvents>> {
  const disposeProxy = await installProxyFromEnvironment(processProxyEnvironment, (diagnostic) => {
    process.stderr.write(`seal-harness: ${diagnostic}\n`);
  });
  const kernel = new Kernel<TEvents>(options);
  try { await kernel.start(profile); }
  catch (error) { await disposeProxy(); throw error; }
  const stopKernel = kernel.stop.bind(kernel); let proxyDisposed = false;
  kernel.stop = async () => {
    try { await stopKernel(); }
    finally { if (!proxyDisposed) { proxyDisposed = true; await disposeProxy(); } }
  };
  return kernel;
}
