import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const COOKIE = "seal_harness_web";

export class WebAuthenticator {
  readonly launchToken = randomBytes(32).toString("base64url");
  #cookieToken = "";
  authority = "";
  wildcardPort: number | undefined;

  constructor(readonly credentialPath: string, readonly cookieMaxAgeDays = 30) {}

  async start(): Promise<void> {
    try { this.#cookieToken = (await readFile(this.credentialPath, "utf8")).trim(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(dirname(this.credentialPath), { recursive: true });
      const generated = randomBytes(32).toString("base64url");
      const temporary = `${this.credentialPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(`${generated}\n`, "utf8"); await handle.sync(); }
        finally { await handle.close(); }
        try { await link(temporary, this.credentialPath); this.#cookieToken = generated; }
        catch (createError) { if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw createError; this.#cookieToken = (await readFile(this.credentialPath, "utf8")).trim(); }
      } finally { await unlink(temporary).catch((cleanupError: NodeJS.ErrnoException) => { if (cleanupError.code !== "ENOENT") throw cleanupError; }); }
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(this.#cookieToken)) throw new Error("Invalid Web authentication credential");
    await chmod(this.credentialPath, 0o600);
  }

  authorize(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    if (!this.#acceptsAuthority(request.headers.host)) return this.#reject(response);
    const supplied = url.searchParams.get("token");
    if (request.method === "GET" && url.pathname === "/" && supplied !== null && secureEqual(supplied, this.launchToken)) {
      response.writeHead(303, {
        location: "/",
        "set-cookie": `${COOKIE}=${this.#cookieToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${this.cookieMaxAgeDays * 86_400}`,
        "cache-control": "no-store",
      });
      response.end(); return false;
    }
    const cookie = parseCookie(request.headers.cookie, COOKIE);
    if (cookie === undefined || !secureEqual(cookie, this.#cookieToken)) return this.#reject(response);
    return true;
  }

  isAuthenticated(request: IncomingMessage): boolean {
    const cookie = parseCookie(request.headers.cookie, COOKIE);
    return this.#acceptsAuthority(request.headers.host) && cookie !== undefined && secureEqual(cookie, this.#cookieToken);
  }

  #reject(response: ServerResponse): false {
    response.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("unauthorized"); return false;
  }

  #acceptsAuthority(host: string | undefined): boolean {
    if (host === undefined) return false;
    if (this.wildcardPort === undefined) return this.authority !== "" && host === this.authority;
    try { const parsed = new URL(`http://${host}`); return parsed.hostname !== "" && Number(parsed.port || 80) === this.wildcardPort; }
    catch { return false; }
  }
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) { const [key, ...rest] = part.trim().split("="); if (key === name) return rest.join("="); }
  return undefined;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
