import { spawn, execFile } from 'node:child_process';
import { stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { isAbsolute, join } from 'node:path';

// 本组件只操作固定前缀的本机容器；仅准备发布清单锁定的运行镜像。
const allowedActions = new Set([
  'doctor',
  'delete',
  'prepare',
  'preflight',
  'start',
  'stop',
  'restart',
  'status',
  'install-resources',
]);
const action = process.argv[2];
const idPattern = /^flow-[a-f0-9]{24}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
let seq = 0;
const emit = (type, data) =>
  process.stdout.write(JSON.stringify({ schemaVersion: 1, seq: ++seq, type, data }) + '\n');
const fail = (code) => Object.assign(new Error(code), { code });
let docker;
let dockerHost =
  process.platform === 'win32' ? 'npipe:////./pipe/docker_engine' : 'unix:///var/run/docker.sock';
function envValue(name) {
  return Object.entries(process.env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}
async function dockerPath() {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
          ...[envValue('ProgramW6432'), envValue('ProgramFiles')]
            .filter(Boolean)
            .map((root) => join(root, 'Docker/Docker/resources/bin/docker.exe')),
          join(
            envValue('LOCALAPPDATA') ?? '',
            'Programs',
            'DockerDesktop',
            'resources',
            'bin',
            'docker.exe',
          ),
          ...[envValue('LOCALAPPDATA')]
            .filter(Boolean)
            .map((root) => join(root, 'Docker/resources/bin/docker.exe')),
          ...(envValue('PATH') ?? '')
            .split(';')
            .map((root) => root.trim().replace(/^"(.*)"$/u, '$1'))
            .filter((root) => isAbsolute(root))
            .map((root) => join(root, 'docker.exe')),
        ]
      : [
          '/usr/local/bin/docker',
          '/usr/bin/docker',
          '/Applications/Docker.app/Contents/Resources/bin/docker',
        ];
  for (const candidate of candidates) {
    try {
      if (!isAbsolute(candidate) || !(await stat(candidate)).isFile()) continue;
      return candidate;
    } catch {
      /* 只检查受控安装位置。 */
    }
  }
  if (process.platform === 'win32') {
    for (const hive of ['HKCU', 'HKLM']) {
      const output = await new Promise((resolve) => {
        execFile(
          join(envValue('SystemRoot') ?? 'C:/Windows', 'System32/reg.exe'),
          [
            'query',
            `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Docker Desktop`,
            '/v',
            'InstallLocation',
          ],
          { windowsHide: true, timeout: 2000, maxBuffer: 16384, encoding: 'utf8' },
          (error, stdout) => resolve(error ? '' : stdout),
        );
      });
      const root = output
        .match(/InstallLocation\s+REG_SZ\s+(.+)/iu)?.[1]
        ?.trim()
        .replace(/^"(.*)"$/u, '$1');
      if (!root || !isAbsolute(root)) continue;
      const candidate = join(root, 'resources/bin/docker.exe');
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
        /* 安装记录可能已过期。 */
      }
    }
  }
  throw fail('runtimeUnavailable');
}
async function importRuntime(pack) {
  if (!pack || !digestPattern.test(pack.image) || !/^[a-f0-9]{64}$/u.test(pack.sha256))
    throw fail('runtimeUnavailable');
  try { await stat(pack.archive); }
  catch (error) {
    if (error.code !== 'ENOENT' || !/^metaversedockerrepo\.geovisearth\.com\/agentearth\/stratex-langgraph:0\.1\.[1-9]\d*$/u.test(pack.imageReference ?? '')) throw error;
    await run(['pull', '--platform', 'linux/amd64', pack.imageReference], '', 30 * 60_000);
    const actual = await run(['image', 'inspect', pack.imageReference, '--format', '{{.Id}}']);
    if (actual.trim() !== pack.image) throw fail('invalidResponse');
    return;
  }
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(pack.archive)) hash.update(bytes);
  if (hash.digest('hex') !== pack.sha256) throw fail('invalidResponse');
  await run(['load', '--input', pack.archive]);
}
// Docker's classic store addresses config digests; containerd addresses OCI
// manifest digests. Derive the alternative from the same archive, never a tag.
async function archivedManifestImages(pack) {
  const file = await open(pack.archive, 'r');
  try {
    const length = (await file.stat()).size;
    const entries = new Map();
    const header = Buffer.alloc(512);
    for (let offset = 0; offset + 512 <= length;) {
      const { bytesRead } = await file.read(header, 0, 512, offset);
      if (bytesRead !== 512) throw fail('invalidResponse');
      if (header.every((byte) => byte === 0)) break;
      const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/su, '');
      const rawSize = header.subarray(124, 136).toString('ascii').replace(/\0.*$/su, '').trim();
      if (!/^[0-7]+$/u.test(rawSize)) throw fail('invalidResponse');
      const size = Number.parseInt(rawSize, 8);
      if (!Number.isSafeInteger(size) || offset + 512 + size > length)
        throw fail('invalidResponse');
      if (name === 'index.json' || /^blobs\/sha256\/[a-f0-9]{64}$/u.test(name)) {
        if (entries.has(name)) throw fail('invalidResponse');
        entries.set(name, { offset: offset + 512, size });
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    async function readJson(name, digest) {
      const entry = entries.get(name);
      if (!entry || entry.size > 1024 * 1024) throw fail('invalidResponse');
      const bytes = Buffer.alloc(entry.size);
      const result = await file.read(bytes, 0, bytes.length, entry.offset);
      if (result.bytesRead !== bytes.length) throw fail('invalidResponse');
      if (digest && `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== digest)
        throw fail('invalidResponse');
      return JSON.parse(bytes.toString('utf8'));
    }
    if (!entries.has('index.json')) return [];
    const index = await readJson('index.json');
    if (!Array.isArray(index.manifests) || index.manifests.length > 32)
      throw fail('invalidResponse');
    const images = [];
    for (const descriptor of index.manifests) {
      if (!digestPattern.test(descriptor.digest ?? '')) throw fail('invalidResponse');
      const manifest = await readJson(
        `blobs/sha256/${descriptor.digest.slice(7)}`,
        descriptor.digest,
      );
      if (manifest.config?.digest === pack.image) images.push(descriptor.digest);
    }
    return images;
  } finally {
    await file.close();
  }
}
async function resolveBundleImage(pack, images) {
  if (!pack || images.bundleImage !== pack.image) return;
  try {
    await run(['image', 'inspect', pack.image, '--format', '{{.Id}}']);
    return;
  } catch {
    // The imported OCI image may be present under its manifest digest instead.
  }
  for (const image of await archivedManifestImages(pack)) {
    try {
      const actual = await run(['image', 'inspect', image, '--format', '{{.Id}}']);
      if (actual !== image) continue;
      images.bundleImage = image;
      return;
    } catch {
      // Only an already imported, content-addressed image is accepted.
    }
  }
  throw fail('runtimeUnavailable');
}
async function connectDocker() {
  const hosts =
    process.platform === 'win32'
      ? ['npipe:////./pipe/docker_engine', 'npipe:////./pipe/dockerDesktopLinuxEngine']
      : ['unix:///var/run/docker.sock'];
  for (const host of hosts) {
    dockerHost = host;
    try {
      // doctor/status 的上层读取限时为 8 秒，给备用 pipe 和结果回传留出时间。
      const type = await run(['info', '--format', '{{.OSType}}'], '', 2_000);
      if (type.trim().toLowerCase() === 'linux') return;
    } catch {
      // Select a local engine for every CLI invocation, including status and
      // doctor; an earlier prepare process cannot preserve its selected pipe.
    }
  }
  throw fail('runtimeUnavailable');
}
async function prepare(pack) {
  try {
    docker = await dockerPath();
    await connectDocker();
  } catch {
    if (process.platform !== 'win32') throw fail('runtimeUnavailable');
    const helper = fileURLToPath(new URL('./prepare-docker.ps1', import.meta.url));
    await new Promise((resolve, reject) => {
      const child = spawn(
        join(
          envValue('SystemRoot') ?? 'C:/Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        ),
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper],
        { windowsHide: true, stdio: 'ignore' },
      );
      child.on('error', () => reject(fail('runtimeUnavailable')));
      child.on('close', (code) => (code === 0 ? resolve() : reject(fail('runtimeUnavailable'))));
    });
    docker = await dockerPath();
    await connectDocker();
  }
  if (pack) await importRuntime(pack);
}
function run(args, stdin = '', timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const host = dockerHost;
    const child = spawn(docker, ['--host', host, ...args], {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          [
            'systemroot',
            'programfiles',
            'programdata',
            'windir',
            'path',
            'home',
            'userprofile',
            'localappdata',
            'appdata',
            'temp',
            'tmp',
          ].includes(key.toLowerCase()),
        ),
      ),
    });
    let output = '',
      errorOutput = '',
      size = 0,
      settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(output.trim());
    };
    const timer = setTimeout(() => finish(fail('runtimeUnavailable')), timeoutMs);
    child.on('error', () => finish(fail('runtimeUnavailable')));
    child.stdin.on('error', () => finish(fail('runtimeUnavailable')));
    child.stdout.on('data', (data) => {
      size += data.length;
      if (size > 1024 * 1024) finish(fail('invalidResponse'));
      else output += data;
    });
    child.stderr.on('data', (data) => {
      size += data.length;
      if (size > 1024 * 1024) finish(fail('invalidResponse'));
      else errorOutput += data;
    });
    child.on('close', (code) => {
      // Docker Desktop 的端口转发可能绕过宿主 socket 预检。只分类启动时的明确绑定冲突，
      // stderr 仅在受限内存中用于判断，绝不返回或记录原始内容（可能含运行配置）。
      const portConflict =
        args[0] === 'compose' &&
        args.includes('up') &&
        /(?:port is already allocated|(?:bind|listen)[^\r\n]*(?:address already in use|only one usage of each socket address))/iu.test(
          errorOutput,
        );
      finish(
        code === 0
          ? undefined
          : fail(
              portConflict
                ? 'portUnavailable'
                : /all predefined address pools have been fully subnetted/iu.test(errorOutput)
                  ? 'networkPoolExhausted'
                  : 'runtimeUnavailable',
            ),
      );
    });
    child.stdin.end(stdin);
  });
}
const origin = (port) => `http://127.0.0.1:${port}`;
const validPort = (value) => Number.isInteger(value) && value >= 1024 && value <= 65535;
async function record(input) {
  const rows = JSON.parse(
    await run([
      'ps',
      '-a',
      '--filter',
      `name=^${input.id}-runtime$`,
      '--format',
      '{{json .}}',
    ]).then((s) => `[${s.split('\n').filter(Boolean).join(',')}]`),
  );
  const state = rows[0]?.State;
  if (rows.length) {
    const project = await run([
      'inspect',
      `${input.id}-runtime`,
      '--format',
      '{{index .Config.Labels "com.docker.compose.project"}}',
    ]);
    if (project !== input.id) throw fail('runtimeUnavailable');
  }
  let status = state === 'running' ? 'starting' : 'stopped';
  if (state === 'running') {
    try {
      const response = await fetch(`${origin(input.port)}/health/ready`, {
        redirect: 'error',
        signal: AbortSignal.timeout(2500),
      });
      status = response.ok ? 'ready' : 'starting';
    } catch {
      status = 'unavailable';
    }
  }
  return {
    id: input.id,
    name: input.name,
    status,
    apiUrl: `${origin(input.port)}/api/v1`,
    adminUrl: `${origin(input.port)}/admin/`,
    serviceUrl: origin(input.port),
  };
}
async function preflight(input, images, runtimePack) {
  await run(['info', '--format', '{{.ServerVersion}}']);
  await run(['compose', 'version', '--short']);
  if (input.runtimeKind !== 'separate') await resolveBundleImage(runtimePack, images);
  const requiredImages =
    input.runtimeKind === 'separate' || !images.bundleImage
      ? [images.runtimeImage, images.postgresImage]
      : [images.bundleImage];
  for (const image of requiredImages) {
    if (!digestPattern.test(image ?? '')) throw fail('runtimeUnavailable');
    await run(['image', 'inspect', image, '--format', '{{.Id}}']);
  }
  if (input?.port !== undefined) {
    if (!validPort(input.port)) throw fail('invalidResponse');
    if (input.id && idPattern.test(input.id)) {
      const current = await record({ ...input, name: '' });
      if (current.status !== 'stopped') return;
    }
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', () => reject(fail('portUnavailable')));
      server.listen(input.port, '0.0.0.0', () => server.close(resolve));
    });
  }
}
function compose(input, images) {
  const config = input.input;
  if (
    !config ||
    !validPort(config.port) ||
    typeof config.name !== 'string' ||
    !/^[a-f0-9]{48}$/u.test(input.databasePassword ?? '') ||
    !/^[a-f0-9]{64}$/u.test(input.encryptionKey ?? '') ||
    !input.model ||
    typeof input.model.model !== 'string'
  )
    throw fail('invalidResponse');
  const protocol = input.model.protocol ?? 'chat-completions';
  if (!['chat-completions', 'responses'].includes(protocol)) throw fail('invalidResponse');
  const endpoint = new URL(input.model.baseUrl);
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw fail('invalidResponse');
  if (['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
    endpoint.hostname = 'host.docker.internal';
  const environment = {
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    PORT: '3000',
    WS_PORT: '0',
    DATABASE_URL: `postgresql://flow:${input.databasePassword}@postgres:5432/flow`,
    INSTANCE_ID: input.id,
    INSTANCE_NAME: config.name,
    LOCAL_ACCESS: 'true',
    LAN_ACCESS: config.access === 'lan' ? 'true' : 'false',
    LAN_ORIGINS: JSON.stringify(input.lanOrigins ?? []),
    STATE_ENCRYPTION_KEY: input.encryptionKey,
    PUBLIC_ORIGIN: origin(config.port),
    ALLOW_LOOPBACK_HTTP: 'true',
    MODEL_NAME: input.model.model,
    MODEL_PROTOCOL: protocol,
    MODEL_BASE_URL: endpoint.href,
    MODEL_API_KEY: input.model.apiKey ?? '',
    DATA_DIR: '/data',
    ADMIN_WEB_DIR: '/app/packages/admin-web/dist',
  };
  if (input.runtimeKind === 'bundled') {
    if (!digestPattern.test(images.bundleImage ?? '')) throw fail('runtimeUnavailable');
    const bundledEnvironment = Object.fromEntries(
      Object.entries(environment).filter(([key]) => !['DATABASE_URL', 'DATA_DIR'].includes(key)),
    );
    return {
      name: input.id,
      services: {
        runtime: {
          image: images.bundleImage,
          container_name: `${input.id}-runtime`,
          pull_policy: 'never',
          init: true,
          read_only: true,
          cap_drop: ['ALL'],
          security_opt: ['no-new-privileges:true'],
          stop_grace_period: '35s',
          tmpfs: ['/tmp:size=128m,mode=1777'],
          ports: [`${config.access === 'lan' ? '0.0.0.0' : '127.0.0.1'}:${config.port}:3000`],
          extra_hosts: ['host.docker.internal:host-gateway'],
          environment: bundledEnvironment,
          volumes: ['bundle-state:/var/lib/postgresql/data'],
        },
      },
      volumes: { 'bundle-state': {} },
    };
  }
  return {
    name: input.id,
    services: {
      runtime: {
        image: images.runtimeImage,
        container_name: `${input.id}-runtime`,
        pull_policy: 'never',
        init: true,
        read_only: true,
        cap_drop: ['ALL'],
        security_opt: ['no-new-privileges:true'],
        tmpfs: ['/tmp:size=128m,mode=1777'],
        ports: [`${config.access === 'lan' ? '0.0.0.0' : '127.0.0.1'}:${config.port}:3000`],
        extra_hosts: ['host.docker.internal:host-gateway'],
        environment,
        volumes: ['runtime-state:/data'],
        depends_on: { postgres: { condition: 'service_healthy' } },
      },
      postgres: {
        image: images.postgresImage,
        container_name: `${input.id}-postgres`,
        pull_policy: 'never',
        environment: {
          POSTGRES_DB: 'flow',
          POSTGRES_USER: 'flow',
          POSTGRES_PASSWORD: input.databasePassword,
        },
        volumes: ['postgres-state:/var/lib/postgresql/data'],
        healthcheck: {
          test: ['CMD', 'pg_isready', '-U', 'flow', '-d', 'flow'],
          interval: '2s',
          timeout: '3s',
          retries: 30,
        },
      },
    },
    volumes: { 'runtime-state': {}, 'postgres-state': {} },
  };
}
try {
  let text = '';
  for await (const bytes of process.stdin) {
    text += bytes;
    if (text.length > (action === 'install-resources' ? 2 * 1024 * 1024 : 64 * 1024))
      throw fail('invalidResponse');
  }
  const envelope = JSON.parse(text);
  if (!allowedActions.has(action) || !envelope || typeof envelope.input !== 'object')
    throw fail('invalidResponse');
  const { input, images, runtimePack } = envelope;
  if (action === 'prepare') {
    await prepare(runtimePack);
    await preflight({}, images, runtimePack);
    emit('result', { available: true });
    process.exit(0);
  }
  try {
    docker = await dockerPath();
  } catch (cause) {
    if (action !== 'doctor') throw cause;
    emit('result', {
      available: false,
      packAvailable: Boolean(runtimePack),
      dockerInstalled: false,
      runtimeReason: 'runtimeUnavailable',
    });
    process.exit(0);
  }
  if (action === 'doctor') {
    try {
      await connectDocker();
      await preflight({}, images, runtimePack);
      emit('result', {
        available: true,
        packAvailable: Boolean(runtimePack),
        dockerInstalled: true,
      });
    } catch (error) {
      const reason =
        error?.code === 'networkPoolExhausted'
          ? 'networkPoolExhausted'
          : error?.code === 'portUnavailable'
            ? 'portUnavailable'
            : 'runtimeUnavailable';
      emit('result', {
        available: false,
        packAvailable: Boolean(runtimePack),
        dockerInstalled: true,
        runtimeReason: reason,
      });
    }
  } else if (action === 'preflight') {
    await connectDocker();
    await preflight(input, images, runtimePack);
    emit('result', { ready: true });
  } else {
    await connectDocker();
    if (!idPattern.test(input.id ?? '')) throw fail('invalidResponse');
    if (action === 'delete') {
      const containers = (
        await run(['ps', '-aq', '--filter', `label=com.docker.compose.project=${input.id}`])
      )
        .split(/\s+/u)
        .filter(Boolean);
      if (containers.length) await run(['rm', '-f', ...containers]);
      const networks = (
        await run([
          'network',
          'ls',
          '-q',
          '--filter',
          `label=com.docker.compose.project=${input.id}`,
        ])
      )
        .split(/\s+/u)
        .filter(Boolean);
      for (const network of networks) await run(['network', 'rm', network]);
      emit('result', { deleted: true });
      process.exit(0);
    }
    if (action === 'install-resources') {
      if (!validPort(input.port) || (await record(input)).status !== 'ready')
        throw fail('runtimeUnavailable');
      // Fixed container endpoint. Publisher credentials travel on stdin, never argv or host HTTP.
      const program = `let text='';for await(const chunk of process.stdin)text+=chunk;
          const origin=process.env.PUBLIC_ORIGIN,host=new URL(origin).host;
          const session=await fetch('http://127.0.0.1:3000/api/v1/auth/session',{headers:{host},redirect:'error',signal:AbortSignal.timeout(10000)});
          if(!session.ok)process.exit(1);const auth=await session.json();
          const result=await fetch('http://127.0.0.1:3000/api/v1/publisher-resource-installations',{
            method:'POST',headers:{'content-type':'application/json',host,origin,'x-csrf-token':auth.csrfToken},body:text,redirect:'error',signal:AbortSignal.timeout(90000)});
        if(!result.ok)process.exit(1);const value=await result.json();
        if(typeof value.snapshotId!=='string')process.exit(1);
        process.stdout.write(JSON.stringify({snapshotId:value.snapshotId,revision:value.revision}));`;
      const value = JSON.parse(
        await run(
          ['exec', '-i', `${input.id}-runtime`, 'node', '--input-type=module', '-e', program],
          JSON.stringify(input.bundle),
        ),
      );
      emit('result', value);
    } else if (action === 'start' || action === 'restart') {
      await preflight(
        { id: input.id, port: input.input?.port, runtimeKind: input.runtimeKind ?? 'separate' },
        images,
        runtimePack,
      );
      const document = compose(input, images);
      if (action === 'restart') await run(['stop', `${input.id}-runtime`]);
      // JSON 是有效 Compose 文档；凭据仅走 stdin，且禁止 Compose 的 $ 插值改变密钥。
      const body = JSON.stringify(document).replaceAll('$', '$$');
      await run(
        [
          'compose',
          '--project-directory',
          join(process.cwd()),
          '-f',
          '-',
          '-p',
          input.id,
          'up',
          '-d',
          '--pull',
          'never',
          '--wait',
          '--wait-timeout',
          '90',
        ],
        body,
      );
      let result;
      const deadline = Date.now() + 40_000;
      do {
        result = await record({ id: input.id, name: input.input.name, port: input.input.port });
        if (result.status === 'ready') break;
        await new Promise((resolve) => setTimeout(resolve, 750));
      } while (Date.now() < deadline);
      if (result.status !== 'ready') throw fail('runtimeUnavailable');
      emit('result', result);
    } else {
      if (!validPort(input.port) || typeof input.name !== 'string') throw fail('invalidResponse');
      if (action === 'stop') {
        await record(input);
        if (input.runtimeKind === 'bundled') {
          await run(['stop', '-t', '35', `${input.id}-runtime`]);
          emit('result', await record(input));
          process.exit(0);
        }
        const project = await run([
          'inspect',
          `${input.id}-postgres`,
          '--format',
          '{{index .Config.Labels "com.docker.compose.project"}}',
        ]);
        if (project !== input.id) throw fail('runtimeUnavailable');
        await run(['stop', `${input.id}-runtime`, `${input.id}-postgres`]);
      }
      emit('result', await record(input));
    }
  }
} catch (error) {
  const code = [
    'runtimeUnavailable',
    'portUnavailable',
    'invalidResponse',
    'networkPoolExhausted',
  ].includes(error?.code)
    ? error.code
    : 'runtimeUnavailable';
  emit('error', { code });
  process.exitCode = 1;
}
