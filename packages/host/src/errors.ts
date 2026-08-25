export class ProfileNotFoundError extends Error {
  override readonly name = "ProfileNotFoundError";

  constructor(
    readonly cwd: string,
    readonly candidates: readonly string[],
  ) {
    super(`No PiHarness profile found in ${cwd}; tried: ${candidates.join(", ")}`);
  }
}

export class InvalidProfileError extends Error {
  override readonly name = "InvalidProfileError";

  constructor(
    message: string,
    readonly configPath?: string,
    options?: ErrorOptions,
  ) {
    super(configPath === undefined ? message : `${message}: ${configPath}`, options);
  }
}
