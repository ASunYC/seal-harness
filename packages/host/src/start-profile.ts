import { Kernel, type EventMap, type KernelOptions } from "@piharness/kernel";
import type { Profile } from "./profile.js";

export async function startProfile<TEvents extends EventMap = EventMap>(
  profile: Profile<TEvents>,
  options: KernelOptions = {},
): Promise<Kernel<TEvents>> {
  const kernel = new Kernel<TEvents>(options);
  await kernel.start(profile);
  return kernel;
}
