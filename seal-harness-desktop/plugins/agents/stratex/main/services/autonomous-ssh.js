import { Client } from 'ssh2';
const MAX_EVENT_LINE = 64 * 1024;
const MAX_OUTPUT = 2 * 1024 * 1024;
const TERMINAL_EVENT_GRACE_MS = 100;
const CONNECT_RETRY_DELAYS_MS = [750, 1_750];
export class AutonomousSshClient {
    constructor(signal) { this.signal = signal; }
    async execute(target, command, input = '', timeoutMs = 30 * 60_000, onLine) {
        const client = await connectSsh(target, { signal: this.signal });
        try {
            return await exec(client, command, input, timeoutMs, onLine);
        }
        finally {
            client.end();
        }
    }
    async upload(target, files) {
        const client = await connectSsh(target, { signal: this.signal });
        try {
            const sftp = await openSftp(client);
            for (const file of files)
                await writeRemoteFile(sftp, file.remotePath, file.content, file.mode ?? 0o600);
            sftp.end();
        }
        finally {
            client.end();
        }
    }
}
export function classifySshConnectionError(error) {
    const detail = error instanceof Error
        ? `${error.message} ${error.code ?? ''} ${error.level ?? ''}`.toLowerCase()
        : String(error).toLowerCase();
    if (detail.includes('client-authentication'))
        return 'remoteAuthenticationFailed';
    if (/timed?\s*out|etimedout|ready timeout/u.test(detail))
        return 'remoteConnectionTimeout';
    if (/econnrefused|connection refused/u.test(detail))
        return 'remoteConnectionRefused';
    if (/ehostunreach|enetunreach|enotfound|no route to host/u.test(detail))
        return 'remoteHostUnreachable';
    if (/handshake|identification|before greeting|connection (?:closed|reset)|econnreset|socket hang up|protocol/u.test(detail))
        return 'remoteHandshakeRejected';
    return 'remoteConnectionFailed';
}
export async function connectSsh(target, dependencies = {}) {
    const createClient = dependencies.createClient ?? (() => new Client());
    const wait = dependencies.wait ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const retryDelays = dependencies.retryDelaysMs ?? CONNECT_RETRY_DELAYS_MS;
    let lastError = new Error('remoteConnectionFailed');
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        try {
            dependencies.signal?.throwIfAborted();
            return await connectOnce(createClient(), target, dependencies.signal);
        }
        catch (error) {
            dependencies.signal?.throwIfAborted();
            const code = classifySshConnectionError(error);
            lastError = new Error(code);
            if (code === 'remoteAuthenticationFailed' || attempt === retryDelays.length)
                throw lastError;
            await wait(retryDelays[attempt] ?? 0);
        }
    }
    throw lastError;
}
function connectOnce(client, target, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => client.destroy();
        signal?.addEventListener('abort', abort, { once: true });
        client.once('close', () => signal?.removeEventListener('abort', abort));
        let settled = false;
        const config = {
            host: target.host,
            port: target.port,
            username: target.username,
            password: target.password,
            readyTimeout: 20_000,
            keepaliveInterval: 10_000,
            keepaliveCountMax: 3,
        };
        const cleanup = () => {
            client.removeListener('ready', onReady);
            client.removeListener('error', onError);
            client.removeListener('close', onClose);
        };
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            try {
                client.end();
            }
            catch {
                // 连接可能在 ssh2 建立底层 socket 前失败；保留原始分类，不用清理异常覆盖它。
            }
            reject(error);
        };
        const onReady = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve(client);
        };
        const onError = (error) => fail(error);
        const onClose = () => fail(new Error('connection closed before handshake'));
        client.once('ready', onReady);
        client.once('error', onError);
        client.once('close', onClose);
        try {
            client.connect(config);
        }
        catch (error) {
            fail(error);
        }
    });
}
function exec(client, command, input, timeoutMs, onLine) {
    return new Promise((resolve, reject) => {
        client.exec(command, { env: {} }, (error, stream) => {
            if (error)
                return reject(error);
            void collectRemoteProcess(stream, input, timeoutMs, onLine).then(resolve, reject);
        });
    });
}
/**
 * 收集一个远端命令的有界输出。ssh2 的 exit 是可选事件，end 与 close 的先后也不固定；
 * 因此用三种终态共同收敛，并为 exit/end 留一个很短的互等窗口以保留真实退出码和尾行。
 */
export function collectRemoteProcess(stream, input, timeoutMs, onLine) {
    return new Promise((resolve, reject) => {
        let output = '';
        let pending = '';
        let bytes = 0;
        let settled = false;
        let exitCode;
        let exitObserved = false;
        let endObserved = false;
        let terminalTimer;
        const handleData = (chunk) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > MAX_OUTPUT) {
                abort(new Error('remote output exceeded limit'));
                return;
            }
            const clean = stripAnsi(chunk);
            output += clean;
            pending += clean;
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines)
                if (line)
                    onLine?.(line);
            if (pending.length > MAX_EVENT_LINE)
                abort(new Error('remote line exceeded limit'));
        };
        const handleExit = (code) => {
            exitObserved = true;
            exitCode = code ?? 1;
            if (endObserved)
                complete(exitCode);
            else
                scheduleTerminal(exitCode);
        };
        const handleEnd = () => {
            endObserved = true;
            if (exitObserved)
                complete(exitCode ?? 1);
            else
                scheduleTerminal(0);
        };
        const handleClose = () => complete(exitObserved ? (exitCode ?? 1) : endObserved ? 0 : 1);
        const removeListeners = () => {
            stream.removeListener('data', handleData);
            stream.removeListener('exit', handleExit);
            stream.removeListener('end', handleEnd);
            stream.removeListener('close', handleClose);
        };
        const finish = (value, error) => {
            if (settled)
                return;
            let finalError = error;
            if (!finalError && pending) {
                try {
                    onLine?.(pending);
                }
                catch {
                    finalError = new Error('remote progress handler failed');
                }
                pending = '';
            }
            settled = true;
            clearTimeout(timeoutTimer);
            if (terminalTimer)
                clearTimeout(terminalTimer);
            removeListeners();
            if (finalError)
                reject(finalError);
            else
                resolve(value ?? { code: 1, output });
        };
        function complete(code) {
            finish({ code, output });
        }
        function scheduleTerminal(fallbackCode) {
            if (settled)
                return;
            if (terminalTimer)
                clearTimeout(terminalTimer);
            terminalTimer = setTimeout(() => complete(exitObserved ? (exitCode ?? 1) : endObserved ? 0 : fallbackCode), TERMINAL_EVENT_GRACE_MS);
        }
        function abort(error) {
            finish(undefined, error);
            try {
                stream.close();
            }
            catch {
                // 通道可能已经被远端关闭；Promise 终态仍以原始超时或容量错误为准。
            }
        }
        const timeoutTimer = setTimeout(() => abort(new Error('remote timeout')), timeoutMs);
        stream.setEncoding('utf8');
        stream.on('data', handleData);
        stream.once('exit', handleExit);
        stream.once('end', handleEnd);
        stream.once('close', handleClose);
        stream.stderr.resume();
        stream.end(input);
    });
}
function openSftp(client) {
    return new Promise((resolve, reject) => client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))));
}
function writeRemoteFile(sftp, path, content, mode) {
    return new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(path, { mode });
        stream.once('error', reject);
        stream.once('close', resolve);
        stream.end(content);
    });
}
function stripAnsi(value) {
    return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, '');
}
