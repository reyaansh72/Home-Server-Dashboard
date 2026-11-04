const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { Server } = require('socket.io');

const publicDirectory = path.join(__dirname, 'public');
const storageDirectory = path.join(__dirname, 'data', 'files');
const repositoriesDirectory = path.join(__dirname, 'data', 'repos');
const repositoriesMetadataPath = path.join(__dirname, 'data', 'repos.json');
const minecraftDirectory = path.join(__dirname, 'data', 'minecraft');
const minecraftServerDirectory = path.join(minecraftDirectory, 'server');
const minecraftRuntimesDirectory = path.join(minecraftDirectory, 'runtimes');
const minecraftMetadataPath = path.join(minecraftDirectory, 'manager.json');
const shortsDirectory = path.join(storageDirectory, 'Shorts');
const shortsMetadataPath = path.join(__dirname, 'data', 'shorts.json');
const musicDirectory = path.join(__dirname, 'data', 'music');
const musicMetadataPath = path.join(musicDirectory, 'music.json');
const chatDirectory = path.join(__dirname, 'data', 'chat');
const chatUploadsDirectory = path.join(chatDirectory, 'uploads');
const chatMetadataPath = path.join(chatDirectory, 'chat.json');
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const maxUploadBytes = 250 * 1024 * 1024;
const apiToken = process.env.FILES_API_TOKEN || crypto.randomBytes(24).toString('hex');
const configuredDaypart = ['morning', 'day', 'evening', 'night'].includes(process.env.BG_TIME) ? process.env.BG_TIME : null;
const terminalTestMode = process.env.TEST_MODE === 'true';
const defaultTerminalCommands = ['date', 'df', 'free', 'hostname', 'id', 'ls', 'pwd', 'uname', 'uptime', 'whoami'];
let terminalAllowedCommands = new Set((process.env.TERMINAL_ALLOWED_COMMANDS === undefined
    ? defaultTerminalCommands
    : process.env.TERMINAL_ALLOWED_COMMANDS.split(','))
    .map((command) => command.trim())
    .filter((command) => /^[a-zA-Z0-9._+-]+$/.test(command)));
fs.mkdirSync(shortsDirectory, { recursive: true });
fs.mkdirSync(repositoriesDirectory, { recursive: true });
fs.mkdirSync(minecraftDirectory, { recursive: true });
fs.mkdirSync(minecraftRuntimesDirectory, { recursive: true });
fs.mkdirSync(musicDirectory, { recursive: true });
fs.mkdirSync(chatUploadsDirectory, { recursive: true });
let previousCpu = readCpuTimes();
let cpuUsage = 0;
let minecraftProcess = null;
let minecraftLogLines = [];
let minecraftInstallInProgress = false;

function readCpuTimes() {
    return os.cpus().reduce((totals, cpu) => {
        const values = Object.values(cpu.times);
        totals.total += values.reduce((sum, value) => sum + value, 0);
        totals.idle += cpu.times.idle;
        return totals;
    }, { total: 0, idle: 0 });
}

setInterval(() => {
    const currentCpu = readCpuTimes();
    const totalDelta = currentCpu.total - previousCpu.total;
    const idleDelta = currentCpu.idle - previousCpu.idle;
    cpuUsage = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
    previousCpu = currentCpu;
}, 1000).unref();

function getStats() {
    const memoryTotal = os.totalmem();
    const memoryFree = os.freemem();
    let storage = { total: 0, free: 0 };

    try {
        const filesystem = fs.statfsSync(publicDirectory);
        storage = {
            total: filesystem.blocks * filesystem.bsize,
            free: filesystem.bavail * filesystem.bsize
        };
    } catch (error) {
        console.error('Unable to read filesystem stats:', error.message);
    }

    return {
        cpu: { usage: cpuUsage, cores: os.cpus().length, load: os.loadavg()[0] },
        memory: { total: memoryTotal, used: memoryTotal - memoryFree, free: memoryFree },
        storage: { total: storage.total, used: storage.total - storage.free, free: storage.free },
        system: {
            hostname: os.hostname(),
            platform: `${os.type()} ${os.release()}`,
            nodeVersion: process.version,
            uptime: os.uptime()
        },
        updatedAt: new Date().toISOString()
    };
}

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(data));
}

function isSameOriginDashboardRequest(request) {
    if (request.headers['sec-fetch-site'] === 'same-origin') return true;
    const requestHost = request.headers.host;
    const referrer = request.headers.referer;
    if (!requestHost || !referrer) return false;
    try {
        const source = new URL(referrer);
        return source.host === requestHost && ['/', '/index.html', '/storage.html', '/shorts.html', '/repos.html', '/minecraft.html', '/games.html', '/music.html', '/terminal.html', '/weather.html', '/chat.html'].includes(source.pathname);
    } catch {
        return false;
    }
}

function readRequestBody(request, limit = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let length = 0;
        let tooLarge = false;
        request.on('data', (chunk) => {
            if (tooLarge) return;
            length += chunk.length;
            if (length > limit) {
                tooLarge = true;
                chunks.length = 0;
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (tooLarge) reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
            else resolve(Buffer.concat(chunks));
        });
        request.on('error', reject);
    });
}

function readJsonBody(request) {
    return readRequestBody(request).then((body) => {
        try {
            return JSON.parse(body.toString('utf8'));
        } catch {
            throw Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 });
        }
    });
}

function safeStoragePath(relativePath = '') {
    if (typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.includes('\0')) {
        throw Object.assign(new Error('Invalid storage path'), { statusCode: 400 });
    }
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..')) {
        throw Object.assign(new Error('Invalid storage path'), { statusCode: 400 });
    }
    const resolved = path.resolve(storageDirectory, ...segments);
    if (resolved !== storageDirectory && !resolved.startsWith(`${storageDirectory}${path.sep}`)) {
        throw Object.assign(new Error('Path is outside file storage'), { statusCode: 403 });
    }

    let current = storageDirectory;
    for (const segment of segments) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) {
                throw Object.assign(new Error('Symbolic links are not allowed'), { statusCode: 403 });
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return resolved;
}

function safeName(name) {
    if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[\\/\0]/.test(name)) {
        throw Object.assign(new Error('A valid file or folder name is required'), { statusCode: 400 });
    }
    return name.trim();
}

function publicPath(absolutePath) {
    return path.relative(storageDirectory, absolutePath).split(path.sep).join('/');
}

function copyStorageEntry(source, destination) {
    const metadata = fs.lstatSync(source);
    if (metadata.isSymbolicLink()) throw Object.assign(new Error('Symbolic links are not allowed'), { statusCode: 403 });
    if (metadata.isDirectory()) {
        fs.mkdirSync(destination);
        for (const entry of fs.readdirSync(source)) {
            copyStorageEntry(path.join(source, entry), path.join(destination, entry));
        }
        return;
    }
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
}

const { spawn } = require('node:child_process');
const maxRepoFileBytes = 2 * 1024 * 1024;

function safeRepositoryName(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name) || name === '.' || name === '..') {
        throw Object.assign(new Error('Repository names may contain letters, numbers, dots, underscores, and hyphens'), { statusCode: 400 });
    }
    return name;
}

function repositoryPath(name) {
    const safeName = safeRepositoryName(name);
    const repoPath = path.join(repositoriesDirectory, safeName);
    if (!repoPath.startsWith(`${repositoriesDirectory}${path.sep}`)) {
        throw Object.assign(new Error('Repository path is invalid'), { statusCode: 400 });
    }
    try {
        if (fs.lstatSync(repoPath).isSymbolicLink()) {
            throw Object.assign(new Error('Symbolic-link repositories are not allowed'), { statusCode: 403 });
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    return repoPath;
}

function safeRepositoryFile(repoPath, relativePath = '') {
    if (typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.includes('\0')) {
        throw Object.assign(new Error('Invalid repository file path'), { statusCode: 400 });
    }
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..' || segment.toLowerCase() === '.git')) {
        throw Object.assign(new Error('Invalid repository file path'), { statusCode: 400 });
    }
    const filePath = path.resolve(repoPath, ...segments);
    if (filePath !== repoPath && !filePath.startsWith(`${repoPath}${path.sep}`)) {
        throw Object.assign(new Error('File path is outside the repository'), { statusCode: 403 });
    }

    let current = repoPath;
    for (const segment of segments) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) {
                throw Object.assign(new Error('Symbolic links are not allowed in the repo editor'), { statusCode: 403 });
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return filePath;
}

function runGit(repoPath, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, {
            cwd: repoPath,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });
        const stdout = [];
        const stderr = [];
        let outputSize = 0;
        const timeout = setTimeout(() => child.kill('SIGTERM'), options.timeout || 30000);
        child.stdout.on('data', (chunk) => {
            outputSize += chunk.length;
            if (outputSize <= 4 * 1024 * 1024) stdout.push(chunk);
            else child.kill('SIGTERM');
        });
        child.stderr.on('data', (chunk) => {
            if (Buffer.concat(stderr).length < 64 * 1024) stderr.push(chunk);
        });
        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(Object.assign(new Error(`Unable to run Git: ${error.message}`), { statusCode: 503 }));
        });
        child.on('close', (code) => {
            clearTimeout(timeout);
            const result = {
                code,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8').trim()
            };
            if (code === 0 || options.allowFailure) resolve(result);
            else reject(Object.assign(new Error(result.stderr || `Git exited with code ${code}`), { statusCode: 400 }));
        });
    });
}

function assertRepository(repoPath) {
    if (!fs.existsSync(path.join(repoPath, '.git'))) {
        throw Object.assign(new Error('Repository not found'), { statusCode: 404 });
    }
}

function validateRemoteUrl(remoteUrl) {
    if (typeof remoteUrl !== 'string' || remoteUrl.length > 500 || /[\s\0]/.test(remoteUrl)) {
        throw Object.assign(new Error('Enter a valid HTTPS or SSH Git remote URL'), { statusCode: 400 });
    }
    const isHttps = /^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?\/[a-zA-Z0-9._/-]+(?:\.git)?$/.test(remoteUrl);
    const isSsh = /^ssh:\/\/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+(?::\d+)?\/[a-zA-Z0-9._/-]+(?:\.git)?$/.test(remoteUrl);
    const isScp = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+:[a-zA-Z0-9._/-]+(?:\.git)?$/.test(remoteUrl);
    if (!isHttps && !isSsh && !isScp) {
        throw Object.assign(new Error('Only HTTPS and SSH Git remotes are supported'), { statusCode: 400 });
    }
    return remoteUrl;
}

function safeBranchName(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,100}$/.test(name) || name.includes('..') || name.endsWith('/') || name.endsWith('.lock')) {
        throw Object.assign(new Error('Invalid branch name'), { statusCode: 400 });
    }
    return name;
}

function safeTagName(name) {
    if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(name) || name.includes('..')) {
        throw Object.assign(new Error('Release tags may contain letters, numbers, dots, underscores, and hyphens'), { statusCode: 400 });
    }
    return name;
}

const supportedJavaVersions = Array.from({ length: 18 }, (_, index) => index + 8);

function loadMinecraftMetadata() {
    try {
        const metadata = JSON.parse(fs.readFileSync(minecraftMetadataPath, 'utf8'));
        return metadata && metadata.configured ? metadata : { configured: false };
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Unable to read Minecraft manager data:', error.message);
        return { configured: false };
    }
}

function saveMinecraftMetadata(metadata) {
    fs.writeFileSync(minecraftMetadataPath, JSON.stringify(metadata, null, 2));
}

function safeMinecraftFile(relativePath = '') {
    if (typeof relativePath !== 'string' || relativePath.includes('\\') || relativePath.includes('\0')) {
        throw Object.assign(new Error('Invalid Minecraft file path'), { statusCode: 400 });
    }
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..' || segment === '.git')) {
        throw Object.assign(new Error('Invalid Minecraft file path'), { statusCode: 400 });
    }
    const filePath = path.resolve(minecraftServerDirectory, ...segments);
    if (filePath !== minecraftServerDirectory && !filePath.startsWith(`${minecraftServerDirectory}${path.sep}`)) {
        throw Object.assign(new Error('File path is outside the managed server'), { statusCode: 403 });
    }
    let current = minecraftServerDirectory;
    for (const segment of segments) {
        current = path.join(current, segment);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) throw Object.assign(new Error('Symbolic links are not allowed'), { statusCode: 403 });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    return filePath;
}

function httpsRequestBuffer(url, maxBytes = 512 * 1024 * 1024, redirects = 5) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return reject(Object.assign(new Error('Downloads must use HTTPS'), { statusCode: 400 }));
        const request = https.get(parsed, { headers: { 'User-Agent': 'HomeServerDashboard/1.0' } }, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
                response.resume();
                const destination = new URL(response.headers.location, parsed).toString();
                httpsRequestBuffer(destination, maxBytes, redirects - 1).then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                reject(Object.assign(new Error(`Download server returned ${response.statusCode}`), { statusCode: 502 }));
                return;
            }
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxBytes) {
                    request.destroy(Object.assign(new Error('Download exceeds the allowed size'), { statusCode: 413 }));
                    return;
                }
                chunks.push(chunk);
            });
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });
        request.setTimeout(120000, () => request.destroy(new Error('Download timed out')));
        request.on('error', reject);
    });
}

function runSystemTool(binary, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, args, { cwd: options.cwd || minecraftDirectory, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(chunk));
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', (error) => reject(Object.assign(new Error(error.message), { statusCode: 503 })));
        child.on('close', (code) => {
            if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
            else reject(Object.assign(new Error(Buffer.concat(stderr).toString('utf8').trim() || `${binary} exited with code ${code}`), { statusCode: 500 }));
        });
    });
}

function appendMinecraftLog(chunk) {
    const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
    minecraftLogLines.push(...lines.map((text) => ({ time: new Date().toISOString(), text })));
    if (minecraftLogLines.length > 2000) minecraftLogLines = minecraftLogLines.slice(-2000);
}

async function installMinecraftJava(version) {
    if (!supportedJavaVersions.includes(version)) throw Object.assign(new Error('Select a Java version from 8 to 25'), { statusCode: 400 });
    if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) {
        throw Object.assign(new Error('Automatic Java setup currently supports Linux x64 and arm64 hosts'), { statusCode: 501 });
    }
    const runtimeDirectory = path.join(minecraftRuntimesDirectory, `temurin-${version}`);
    const javaBinary = path.join(runtimeDirectory, 'bin', 'java');
    if (fs.existsSync(javaBinary)) return javaBinary;
    if (minecraftInstallInProgress) throw Object.assign(new Error('Another Java installation is already running'), { statusCode: 409 });
    minecraftInstallInProgress = true;
    const architecture = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const apiPath = `/v3/binary/latest/${version}/ga/linux/${architecture}/jre/hotspot/normal/eclipse`;
    const checksumPath = `/v3/checksum/latest/${version}/ga/linux/${architecture}/jre/hotspot/normal/eclipse`;
    const apiHost = 'https://api.adoptium.net';
    const tempDirectory = path.join(minecraftRuntimesDirectory, `.install-${crypto.randomUUID()}`);
    const archivePath = path.join(tempDirectory, 'runtime.tar.gz');

    try {
        fs.mkdirSync(tempDirectory, { recursive: false });
        const [archive, checksumResponse] = await Promise.all([
            httpsRequestBuffer(`${apiHost}${apiPath}`),
            httpsRequestBuffer(`${apiHost}${checksumPath}`, 1024 * 1024)
        ]);
        const expectedChecksum = checksumResponse.toString('utf8').trim().split(/\s+/)[0].toLowerCase();
        const actualChecksum = crypto.createHash('sha256').update(archive).digest('hex');
        if (!/^[a-f0-9]{64}$/.test(expectedChecksum) || actualChecksum !== expectedChecksum) {
            throw Object.assign(new Error('Downloaded Java runtime failed checksum verification'), { statusCode: 502 });
        }
        fs.writeFileSync(archivePath, archive, { flag: 'wx' });
        const extractDirectory = path.join(tempDirectory, 'extracted');
        fs.mkdirSync(extractDirectory);
        await runSystemTool('tar', ['-xzf', archivePath, '-C', extractDirectory]);
        const folders = fs.readdirSync(extractDirectory, { withFileTypes: true }).filter((entry) => entry.isDirectory());
        const extractedJava = folders.map((entry) => path.join(extractDirectory, entry.name, 'bin', 'java')).find((candidate) => fs.existsSync(candidate));
        if (!extractedJava) throw Object.assign(new Error('Java runtime archive did not contain a java executable'), { statusCode: 502 });
        fs.renameSync(path.dirname(path.dirname(extractedJava)), runtimeDirectory);
        fs.chmodSync(javaBinary, 0o755);
        return javaBinary;
    } finally {
        fs.rmSync(tempDirectory, { recursive: true, force: true });
        minecraftInstallInProgress = false;
    }
}

function stopMinecraftProcess() {
    if (!minecraftProcess) return Promise.resolve(false);
    const currentProcess = minecraftProcess;
    return new Promise((resolve) => {
        const forceTimer = setTimeout(() => {
            if (currentProcess.exitCode === null) currentProcess.kill('SIGKILL');
        }, 12000);
        currentProcess.once('close', () => {
            clearTimeout(forceTimer);
            if (minecraftProcess === currentProcess) minecraftProcess = null;
            resolve(true);
        });
        currentProcess.kill('SIGTERM');
    });
}

function receiveMinecraftUpload(request, targetPath, limit = 1024 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(targetPath, { flags: 'wx' });
        let received = 0;
        let settled = false;
        const fail = (error) => {
            if (settled) return;
            settled = true;
            output.destroy();
            fs.rmSync(targetPath, { force: true });
            reject(error);
        };
        request.on('data', (chunk) => {
            received += chunk.length;
            if (received > limit) {
                fail(Object.assign(new Error('Upload exceeds the 1 GiB limit'), { statusCode: 413 }));
                request.resume();
                return;
            }
            if (!output.write(chunk)) request.pause();
        });
        output.on('drain', () => request.resume());
        request.on('end', () => output.end());
        request.on('error', fail);
        output.on('error', fail);
        output.on('finish', () => {
            if (settled) return;
            settled = true;
            resolve(received);
        });
    });
}

function minecraftStatus() {
    const metadata = loadMinecraftMetadata();
    return {
        configured: Boolean(metadata.configured),
        name: metadata.name || '',
        javaVersion: metadata.javaVersion || 21,
        ramMb: metadata.ramMb || 2048,
        jarFile: metadata.jarFile || 'server.jar',
        eulaAccepted: Boolean(metadata.eulaAccepted),
        running: Boolean(minecraftProcess && minecraftProcess.exitCode === null),
        pid: minecraftProcess && minecraftProcess.exitCode === null ? minecraftProcess.pid : null,
        installInProgress: minecraftInstallInProgress,
        installedJavaVersions: supportedJavaVersions.filter((version) => fs.existsSync(path.join(minecraftRuntimesDirectory, `temurin-${version}`, 'bin', 'java'))),
        logs: minecraftLogLines.slice(-300)
    };
}

async function handleMinecraftApi(request, response, url) {
    const route = url.pathname.slice('/api/minecraft'.length).split('/').filter(Boolean).map(decodeURIComponent);
    const metadata = loadMinecraftMetadata();

    if (request.method === 'GET' && route.length === 0) {
        sendJson(response, 200, minecraftStatus());
        return;
    }

    if (request.method === 'POST' && route[0] === 'config' && route.length === 1) {
        if (metadata.configured) throw Object.assign(new Error('Only one Minecraft server can be managed at a time'), { statusCode: 409 });
        const body = await readJsonBody(request, 32 * 1024);
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : '';
        const javaVersion = Number(body.javaVersion);
        const ramMb = Number(body.ramMb);
        const mode = body.mode === 'folder' ? 'folder' : body.mode === 'jar' ? 'jar' : '';
        const jarFile = typeof body.jarFile === 'string' ? body.jarFile.trim() : 'server.jar';
        if (!name) throw Object.assign(new Error('Server name is required'), { statusCode: 400 });
        if (!supportedJavaVersions.includes(javaVersion)) throw Object.assign(new Error('Java version must be between 8 and 25'), { statusCode: 400 });
        if (!Number.isInteger(ramMb) || ramMb < 512 || ramMb > Math.floor(os.totalmem() / (1024 * 1024) * 0.8)) {
            throw Object.assign(new Error('RAM must be at least 512 MB and no more than 80% of host memory'), { statusCode: 400 });
        }
        if (!mode) throw Object.assign(new Error('Select JAR upload or full folder import'), { statusCode: 400 });
        if (!body.eulaAccepted) throw Object.assign(new Error('You must accept the Minecraft EULA before creating a server'), { statusCode: 400 });
        const jarPath = safeMinecraftFile(jarFile);
        fs.mkdirSync(minecraftServerDirectory, { recursive: false });
        fs.writeFileSync(path.join(minecraftServerDirectory, 'eula.txt'), 'eula=true\n', { flag: 'wx' });
        saveMinecraftMetadata({ configured: true, name, javaVersion, ramMb, mode, jarFile, eulaAccepted: true, createdAt: new Date().toISOString() });
        sendJson(response, 201, { configured: true, name, javaVersion, ramMb, mode, jarFile, uploadPath: path.relative(minecraftServerDirectory, jarPath).split(path.sep).join('/') });
        return;
    }

    if (!metadata.configured) throw Object.assign(new Error('Create a Minecraft server first'), { statusCode: 404 });

    if (request.method === 'PUT' && route[0] === 'config' && route.length === 1) {
        const body = await readJsonBody(request, 16 * 1024);
        const updated = { ...metadata };
        if (typeof body.name === 'string' && body.name.trim()) updated.name = body.name.trim().slice(0, 64);
        if (body.javaVersion !== undefined) {
            const version = Number(body.javaVersion);
            if (!supportedJavaVersions.includes(version)) throw Object.assign(new Error('Java version must be between 8 and 25'), { statusCode: 400 });
            updated.javaVersion = version;
        }
        if (body.ramMb !== undefined) {
            const ramMb = Number(body.ramMb);
            if (!Number.isInteger(ramMb) || ramMb < 512 || ramMb > Math.floor(os.totalmem() / (1024 * 1024) * 0.8)) throw Object.assign(new Error('RAM is outside the allowed host-memory range'), { statusCode: 400 });
            updated.ramMb = ramMb;
        }
        saveMinecraftMetadata(updated);
        sendJson(response, 200, { name: updated.name, javaVersion: updated.javaVersion, ramMb: updated.ramMb });
        return;
    }

    if (request.method === 'DELETE' && route.length === 0) {
        if (minecraftProcess) await stopMinecraftProcess();
        fs.rmSync(minecraftServerDirectory, { recursive: true, force: true });
        fs.rmSync(minecraftMetadataPath, { force: true });
        minecraftLogLines = [];
        sendJson(response, 200, { deleted: true });
        return;
    }

    if (request.method === 'POST' && route[0] === 'install-java' && route.length === 1) {
        const body = await readJsonBody(request, 4096);
        const version = Number(body.version);
        const javaPath = await installMinecraftJava(version);
        sendJson(response, 200, { version, javaPath });
        return;
    }

    if (request.method === 'POST' && route[0] === 'upload' && route.length === 1) {
        if (minecraftProcess && minecraftProcess.exitCode === null) throw Object.assign(new Error('Stop the Minecraft server before uploading files'), { statusCode: 409 });
        const relativePath = url.searchParams.get('path') || '';
        if (!relativePath) throw Object.assign(new Error('Upload path is required'), { statusCode: 400 });
        const target = safeMinecraftFile(relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (relativePath === 'eula.txt' && metadata.eulaAccepted) fs.rmSync(target, { force: true });
        const size = await receiveMinecraftUpload(request, target);
        if (relativePath === 'eula.txt' && metadata.eulaAccepted) fs.writeFileSync(target, 'eula=true\n');
        sendJson(response, 201, { path: relativePath, size });
        return;
    }

    if (request.method === 'GET' && route[0] === 'files' && route.length === 1) {
        const relativePath = url.searchParams.get('path') || '';
        const directory = safeMinecraftFile(relativePath);
        if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw Object.assign(new Error('Folder not found'), { statusCode: 404 });
        const entries = fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => !entry.isSymbolicLink()).map((entry) => {
            const entryPath = path.join(directory, entry.name);
            const stat = fs.statSync(entryPath);
            return { name: entry.name, path: relativePath ? `${relativePath}/${entry.name}` : entry.name, isFolder: entry.isDirectory(), size: entry.isDirectory() ? 0 : stat.size, modified: stat.mtime.toISOString() };
        }).sort((left, right) => (Number(right.isFolder) - Number(left.isFolder)) || left.name.localeCompare(right.name));
        sendJson(response, 200, { path: relativePath, entries });
        return;
    }

    if (request.method === 'POST' && route[0] === 'folder' && route.length === 1) {
        if (minecraftProcess && minecraftProcess.exitCode === null) throw Object.assign(new Error('Stop the Minecraft server before creating folders'), { statusCode: 409 });
        const body = await readJsonBody(request, 4096);
        const parent = safeMinecraftFile(body.path || '');
        const name = safeName(body.name);
        const folderPath = path.join(parent, name);
        safeMinecraftFile(path.relative(minecraftServerDirectory, folderPath).split(path.sep).join('/'));
        fs.mkdirSync(folderPath);
        sendJson(response, 201, { path: path.relative(minecraftServerDirectory, folderPath).split(path.sep).join('/') });
        return;
    }

    if (request.method === 'GET' && route[0] === 'file' && route.length === 1) {
        const relativePath = url.searchParams.get('path') || '';
        const filePath = safeMinecraftFile(relativePath);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw Object.assign(new Error('File not found'), { statusCode: 404 });
        const content = fs.readFileSync(filePath);
        if (content.length > maxRepoFileBytes) throw Object.assign(new Error('File exceeds the 2 MiB editor limit'), { statusCode: 413 });
        sendJson(response, 200, { path: relativePath, content: content.toString('utf8') });
        return;
    }

    if (request.method === 'GET' && ['download', 'preview'].includes(route[0]) && route.length === 1) {
        const relativePath = url.searchParams.get('path') || '';
        const filePath = safeMinecraftFile(relativePath);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw Object.assign(new Error('File not found'), { statusCode: 404 });
        const extension = path.extname(filePath).toLowerCase();
        const inline = route[0] === 'preview';
        const contentTypes = { '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
        response.writeHead(200, {
            'Content-Type': contentTypes[extension] || 'application/octet-stream',
            'Content-Length': fs.statSync(filePath).size,
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
            'X-Content-Type-Options': 'nosniff'
        });
        await pipeline(fs.createReadStream(filePath), response);
        return;
    }

    if (request.method === 'PUT' && route[0] === 'file' && route.length === 1) {
        if (minecraftProcess && minecraftProcess.exitCode === null) throw Object.assign(new Error('Stop the Minecraft server before editing files'), { statusCode: 409 });
        const relativePath = url.searchParams.get('path') || '';
        if (!relativePath) throw Object.assign(new Error('File path is required'), { statusCode: 400 });
        const filePath = safeMinecraftFile(relativePath);
        const content = await readRequestBody(request, maxRepoFileBytes);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        sendJson(response, 200, { path: relativePath, size: content.length });
        return;
    }

    if (request.method === 'DELETE' && route[0] === 'file' && route.length === 1) {
        if (minecraftProcess && minecraftProcess.exitCode === null) throw Object.assign(new Error('Stop the Minecraft server before deleting files'), { statusCode: 409 });
        const relativePath = url.searchParams.get('path') || '';
        if (!relativePath) throw Object.assign(new Error('File path is required'), { statusCode: 400 });
        const filePath = safeMinecraftFile(relativePath);
        if (!fs.existsSync(filePath)) throw Object.assign(new Error('File or folder not found'), { statusCode: 404 });
        fs.rmSync(filePath, { recursive: fs.statSync(filePath).isDirectory(), force: false });
        sendJson(response, 200, { deleted: relativePath });
        return;
    }

    if (request.method === 'POST' && route[0] === 'start' && route.length === 1) {
        if (minecraftProcess && minecraftProcess.exitCode === null) throw Object.assign(new Error('Minecraft server is already running'), { statusCode: 409 });
        if (!metadata.eulaAccepted || !fs.existsSync(path.join(minecraftServerDirectory, 'eula.txt')) || !fs.readFileSync(path.join(minecraftServerDirectory, 'eula.txt'), 'utf8').match(/^eula=true$/m)) {
            throw Object.assign(new Error('Accept the Minecraft EULA in the server files before starting'), { statusCode: 400 });
        }
        const jarPath = safeMinecraftFile(metadata.jarFile || 'server.jar');
        if (!fs.existsSync(jarPath) || !fs.statSync(jarPath).isFile()) throw Object.assign(new Error(`Server JAR not found: ${metadata.jarFile || 'server.jar'}`), { statusCode: 404 });
        const javaVersion = Number(metadata.javaVersion);
        const javaPath = path.join(minecraftRuntimesDirectory, `temurin-${javaVersion}`, 'bin', 'java');
        if (!fs.existsSync(javaPath)) {
            throw Object.assign(new Error(`Java ${javaVersion} is not installed. Install it from Runtime setup before starting the server.`), { statusCode: 409 });
        }
        minecraftLogLines = [];
        minecraftProcess = spawn(javaPath, ['-Xms512M', `-Xmx${Number(metadata.ramMb)}M`, '-jar', metadata.jarFile || 'server.jar', 'nogui'], { cwd: minecraftServerDirectory, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        minecraftProcess.stdout.on('data', appendMinecraftLog);
        minecraftProcess.stderr.on('data', appendMinecraftLog);
        minecraftProcess.on('error', (error) => appendMinecraftLog(`[manager] ${error.message}`));
        minecraftProcess.on('close', (code, signal) => {
            appendMinecraftLog(`[manager] Server stopped (code ${code ?? 'unknown'}, signal ${signal || 'none'})`);
            minecraftProcess = null;
        });
        appendMinecraftLog(`[manager] Starting ${metadata.name} with Java ${metadata.javaVersion}`);
        sendJson(response, 202, { started: true, pid: minecraftProcess.pid });
        return;
    }

    if (request.method === 'POST' && route[0] === 'stop' && route.length === 1) {
        await stopMinecraftProcess();
        sendJson(response, 200, { stopped: true });
        return;
    }

    if (request.method === 'POST' && route[0] === 'console' && route.length === 1) {
        if (!minecraftProcess || minecraftProcess.exitCode !== null) throw Object.assign(new Error('Minecraft server is not running'), { statusCode: 409 });
        const body = await readJsonBody(request, 4096);
        const command = typeof body.command === 'string' ? body.command.trim() : '';
        if (!command || command.length > 1000 || /[\r\n\0]/.test(command)) throw Object.assign(new Error('Enter one console command, up to 1000 characters'), { statusCode: 400 });
        minecraftProcess.stdin.write(`${command}\n`);
        appendMinecraftLog(`> ${command}`);
        sendJson(response, 200, { sent: true });
        return;
    }

    sendJson(response, 404, { error: 'Minecraft manager endpoint not found' });
}

async function handleOperationsTerminalApi(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/terminal') {
        sendJson(response, 200, { host: os.hostname(), platform: `${os.type()} ${os.release()}`, cwd: path.relative(__dirname, process.cwd()) || '.', actions: ['help', 'status', 'uptime', 'disk', 'memory', 'repos', 'minecraft'], shellCommands: [...terminalAllowedCommands].sort(), testMode: terminalTestMode });
        return;
    }
    if (request.method !== 'POST' || url.pathname !== '/api/terminal') {
        sendJson(response, 404, { error: 'Operations terminal endpoint not found' });
        return;
    }
    const body = await readJsonBody(request, 4096);
    if (Array.isArray(body.allowedCommands)) {
        if (body.allowedCommands.length > 100 || body.allowedCommands.some((command) => typeof command !== 'string' || !/^[a-zA-Z0-9._+-]+$/.test(command))) {
            throw Object.assign(new Error('Allowlist must contain at most 100 executable names'), { statusCode: 400 });
        }
        terminalAllowedCommands = new Set(body.allowedCommands);
        sendJson(response, 200, { shellCommands: [...terminalAllowedCommands].sort() });
        return;
    }
    const rawCommand = typeof body.command === 'string' ? body.command.trim() : '';
    const command = rawCommand.toLowerCase();
    const actions = {
        help: async () => `Available actions: help, status, uptime, disk, memory, repos, minecraft. Allowed host commands: ${[...terminalAllowedCommands].sort().join(', ') || 'none'}. Shell operators and expansions are disabled.`,
        status: async () => JSON.stringify(getStats(), null, 2),
        uptime: async () => `Host uptime: ${Math.floor(os.uptime())} seconds\nProcess uptime: ${Math.floor(process.uptime())} seconds`,
        disk: async () => {
            const stat = fs.statfsSync(__dirname);
            return `Total: ${(stat.blocks * stat.bsize / 1024 ** 3).toFixed(1)} GiB\nFree: ${(stat.bavail * stat.bsize / 1024 ** 3).toFixed(1)} GiB`;
        },
        memory: async () => `Total: ${(os.totalmem() / 1024 ** 3).toFixed(2)} GiB\nFree: ${(os.freemem() / 1024 ** 3).toFixed(2)} GiB`,
        repos: async () => fs.readdirSync(repositoriesDirectory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).join('\n') || 'No repositories yet.',
        minecraft: async () => JSON.stringify(minecraftStatus(), null, 2)
    };
    if (actions[command]) {
        sendJson(response, 200, { command, output: await actions[command](), time: new Date().toISOString() });
        return;
    }

    if (!rawCommand || rawCommand.length > 1000 || /[\r\n\0]/.test(rawCommand)) {
        throw Object.assign(new Error('Enter one command, up to 1000 characters'), { statusCode: 400 });
    }

    const tokens = [];
    let token = '';
    let tokenStarted = false;
    let quote = '';
    let escaped = false;
    for (const character of rawCommand) {
        if (escaped) {
            token += character;
            tokenStarted = true;
            escaped = false;
        } else if (character === '\\' && quote !== "'") {
            tokenStarted = true;
            escaped = true;
        } else if (quote) {
            if (character === quote) quote = '';
            else token += character;
            tokenStarted = true;
        } else if (character === '"' || character === "'") {
            quote = character;
            tokenStarted = true;
        } else if (/[;&|<>$`()]/.test(character)) {
            throw Object.assign(new Error('Shell operators and expansions are not supported'), { statusCode: 400 });
        } else if (/\s/.test(character)) {
            if (tokenStarted) tokens.push(token);
            token = '';
            tokenStarted = false;
        } else {
            token += character;
            tokenStarted = true;
        }
    }
    if (escaped || quote) throw Object.assign(new Error('Unclosed quote or escape in command'), { statusCode: 400 });
    if (tokenStarted) tokens.push(token);

    const executable = tokens.shift();
    if (!executable || (!terminalTestMode && !terminalAllowedCommands.has(executable))) {
        throw Object.assign(new Error('Command not allowed. Type help to see available operations.'), { statusCode: 400 });
    }

    const child = spawn(executable, tokens, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
    });
    const output = [];
    let outputSize = 0;
    let timedOut = false;
    let outputLimitReached = false;
    let spawnFailed = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
    }, 15000);
    const collectOutput = (chunk) => {
        outputSize += chunk.length;
        if (outputSize <= 1024 * 1024) output.push(chunk);
        else if (!outputLimitReached) {
            outputLimitReached = true;
            child.kill('SIGTERM');
        }
    };
    child.stdout.on('data', collectOutput);
    child.stderr.on('data', collectOutput);
    child.on('error', (error) => {
        spawnFailed = true;
        clearTimeout(timeout);
        sendJson(response, 500, { error: `Unable to run ${executable}: ${error.message}` });
    });
    child.on('close', (code) => {
        clearTimeout(timeout);
        if (spawnFailed) return;
        if (timedOut) {
            sendJson(response, 504, { error: 'Command exceeded the 15 second time limit' });
            return;
        }
        if (outputLimitReached) {
            sendJson(response, 413, { error: 'Command output exceeded the 1 MiB limit' });
            return;
        }
        sendJson(response, 200, { command: rawCommand, output: Buffer.concat(output).toString('utf8'), exitCode: code, time: new Date().toISOString() });
    });
}

function parseGitStatus(output) {
    const lines = output.split('\n').filter(Boolean);
    const header = lines.shift() || '';
    const changedFiles = lines.map((line) => ({
        index: line.slice(0, 1),
        worktree: line.slice(1, 2),
        path: line.slice(3).replace(/^"|"$/g, '')
    }));
    const branchHeader = header.startsWith('## ') ? header.slice(3).split('...')[0] : 'main';
    return {
        branch: branchHeader.replace(/^No commits yet on /, '').split(' ')[0] || 'main',
        upstream: header.includes('...') ? header.slice(header.indexOf('...') + 3).split(' ')[0] : null,
        ahead: Number(header.match(/ahead (\d+)/)?.[1] || 0),
        behind: Number(header.match(/behind (\d+)/)?.[1] || 0),
        changedFiles
    };
}

function loadRepositoryMetadata() {
    try {
        const data = JSON.parse(fs.readFileSync(repositoriesMetadataPath, 'utf8'));
        return data && typeof data === 'object' ? data : {};
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Unable to read repository metadata:', error.message);
        return {};
    }
}

function saveRepositoryMetadata(metadata) {
    fs.writeFileSync(repositoriesMetadataPath, JSON.stringify(metadata, null, 2));
}

async function handleRepositoryApi(request, response, url) {
    const route = url.pathname.slice('/api/repos'.length).split('/').filter(Boolean).map(decodeURIComponent);

    if (request.method === 'GET' && route.length === 0) {
        const metadata = loadRepositoryMetadata();
        const repositories = fs.readdirSync(repositoriesDirectory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && fs.existsSync(path.join(repositoriesDirectory, entry.name, '.git')))
            .map((entry) => ({ name: entry.name, updatedAt: fs.statSync(path.join(repositoriesDirectory, entry.name)).mtime.toISOString(), owner: metadata[entry.name]?.owner || null }))
            .sort((left, right) => left.name.localeCompare(right.name));
        sendJson(response, 200, { repositories });
        return;
    }

    if (request.method === 'POST' && route.length === 0) {
        const body = await readJsonBody(request);
        const userId = validChatUserId(body.userId);
        const profile = getChatProfile(loadChatStore(), userId);
        const name = safeRepositoryName(body.name);
        const repoPath = repositoryPath(name);
        if (fs.existsSync(repoPath)) throw Object.assign(new Error('A repository with that name already exists'), { statusCode: 409 });
        fs.mkdirSync(repoPath, { recursive: false });
        try {
            await runGit(repoPath, ['init', '--initial-branch=main']);
            const readme = `# ${name}\n\n${typeof body.description === 'string' ? body.description.trim().slice(0, 500) : ''}\n`;
            fs.writeFileSync(path.join(repoPath, 'README.md'), readme, { flag: 'wx' });
            const metadata = loadRepositoryMetadata();
            metadata[name] = { owner: { userId, username: profile.username, avatarId: profile.avatarId }, createdAt: new Date().toISOString() };
            saveRepositoryMetadata(metadata);
        } catch (error) {
            fs.rmSync(repoPath, { recursive: true, force: true });
            throw error;
        }
        sendJson(response, 201, { name, branch: 'main' });
        return;
    }

    if (route.length < 1) {
        sendJson(response, 404, { error: 'Repository route not found' });
        return;
    }
    const repoName = safeRepositoryName(route[0]);
    const repoPath = repositoryPath(repoName);
    assertRepository(repoPath);
    const action = route[1] || '';

    if (request.method === 'GET' && action === 'status') {
        const result = await runGit(repoPath, ['status', '--porcelain=v1', '-b']);
        const status = parseGitStatus(result.stdout);
        const remote = await runGit(repoPath, ['remote', 'get-url', 'origin'], { allowFailure: true });
        const remoteUrl = remote.code === 0 ? remote.stdout.trim().replace(/:\/\/[^/@]+:[^/@]+@/, '://[credentials]@') : '';
        sendJson(response, 200, { ...status, remote: remoteUrl });
        return;
    }

    if (request.method === 'GET' && action === 'tree') {
        const requestedPath = url.searchParams.get('path') || '';
        const directoryPath = safeRepositoryFile(repoPath, requestedPath);
        if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
            throw Object.assign(new Error('Folder not found'), { statusCode: 404 });
        }
        const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
            .filter((entry) => entry.name !== '.git' && !entry.isSymbolicLink())
            .map((entry) => {
                const filePath = path.join(directoryPath, entry.name);
                const stat = fs.statSync(filePath);
                return { name: entry.name, path: requestedPath ? `${requestedPath}/${entry.name}` : entry.name, isFolder: entry.isDirectory(), size: entry.isDirectory() ? 0 : stat.size, modified: stat.mtime.toISOString() };
            })
            .sort((left, right) => (Number(right.isFolder) - Number(left.isFolder)) || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));
        sendJson(response, 200, { path: requestedPath, entries });
        return;
    }

    if (request.method === 'GET' && action === 'file') {
        const relativePath = url.searchParams.get('path') || '';
        const filePath = safeRepositoryFile(repoPath, relativePath);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw Object.assign(new Error('File not found'), { statusCode: 404 });
        const content = fs.readFileSync(filePath);
        if (content.length > maxRepoFileBytes) throw Object.assign(new Error('File exceeds the 2 MiB editor limit'), { statusCode: 413 });
        sendJson(response, 200, { path: relativePath, content: content.toString('utf8') });
        return;
    }

    if (request.method === 'PUT' && action === 'file') {
        const relativePath = url.searchParams.get('path') || '';
        const filePath = safeRepositoryFile(repoPath, relativePath);
        if (!relativePath) throw Object.assign(new Error('A filename is required'), { statusCode: 400 });
        const body = await readRequestBody(request, maxRepoFileBytes);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, body);
        sendJson(response, 200, { path: relativePath, size: body.length });
        return;
    }

    if (request.method === 'DELETE' && action === 'file') {
        const relativePath = url.searchParams.get('path') || '';
        if (!relativePath) throw Object.assign(new Error('A file path is required'), { statusCode: 400 });
        const filePath = safeRepositoryFile(repoPath, relativePath);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw Object.assign(new Error('File not found'), { statusCode: 404 });
        fs.unlinkSync(filePath);
        sendJson(response, 200, { deleted: relativePath });
        return;
    }

    if (request.method === 'GET' && action === 'history') {
        const result = await runGit(repoPath, ['log', '-n', '50', '--format=%H%x1f%s%x1f%an%x1f%aI']);
        const commits = result.stdout.split('\n').filter(Boolean).map((line) => {
            const [hash, subject, author, date] = line.split('\x1f');
            return { hash, shortHash: hash.slice(0, 8), subject, author, date };
        });
        sendJson(response, 200, { commits });
        return;
    }

    if (request.method === 'GET' && action === 'branches') {
        const [current, branches] = await Promise.all([
            runGit(repoPath, ['branch', '--show-current'], { allowFailure: true }),
            runGit(repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
        ]);
        sendJson(response, 200, { current: current.stdout.trim() || 'main', branches: branches.stdout.split('\n').filter(Boolean) });
        return;
    }

    if (request.method === 'POST' && action === 'branches') {
        const body = await readJsonBody(request);
        const branch = safeBranchName(body.name);
        await runGit(repoPath, ['switch', '-c', branch]);
        sendJson(response, 201, { branch });
        return;
    }

    if (request.method === 'POST' && action === 'checkout') {
        const body = await readJsonBody(request);
        const branch = safeBranchName(body.name);
        const existing = await runGit(repoPath, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true });
        if (existing.code !== 0) throw Object.assign(new Error('Local branch not found'), { statusCode: 404 });
        await runGit(repoPath, ['switch', branch]);
        sendJson(response, 200, { branch });
        return;
    }

    if (request.method === 'POST' && action === 'commit') {
        const body = await readJsonBody(request, 32 * 1024);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        if (!message || message.length > 500) throw Object.assign(new Error('Commit message must be between 1 and 500 characters'), { statusCode: 400 });
        await runGit(repoPath, ['add', '-A']);
        await runGit(repoPath, ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Home Server', '-c', 'user.email=home-server@localhost', 'commit', '-m', message]);
        const result = await runGit(repoPath, ['rev-parse', 'HEAD']);
        sendJson(response, 201, { hash: result.stdout.trim(), message });
        return;
    }

    if (request.method === 'PUT' && action === 'remote') {
        const body = await readJsonBody(request, 8 * 1024);
        const remoteUrl = validateRemoteUrl(body.url);
        const existing = await runGit(repoPath, ['remote', 'get-url', 'origin'], { allowFailure: true });
        if (existing.code === 0) await runGit(repoPath, ['remote', 'set-url', 'origin', remoteUrl]);
        else await runGit(repoPath, ['remote', 'add', 'origin', remoteUrl]);
        sendJson(response, 200, { remote: remoteUrl.replace(/:\/\/[^/@]+:[^/@]+@/, '://[credentials]@') });
        return;
    }

    if (request.method === 'POST' && action === 'push') {
        const statusResult = await runGit(repoPath, ['status', '--porcelain=v1', '-b']);
        const status = parseGitStatus(statusResult.stdout);
        if (!status.branch || status.branch === 'HEAD') throw Object.assign(new Error('Checkout a branch before pushing'), { statusCode: 400 });
        const remotes = await runGit(repoPath, ['remote']);
        const remoteName = (url.searchParams.get('remote') || 'origin').trim();
        if (!remotes.stdout.split('\n').includes(remoteName)) throw Object.assign(new Error(`Git remote "${remoteName}" is not configured`), { statusCode: 400 });
        await runGit(repoPath, ['-c', 'core.hooksPath=/dev/null', 'push', '--set-upstream', remoteName, status.branch], { timeout: 120000 });
        sendJson(response, 200, { remote: remoteName, branch: status.branch });
        return;
    }

    if (request.method === 'GET' && action === 'releases') {
        const result = await runGit(repoPath, ['for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%x1f%(subject)%x1f%(creatordate:iso8601)', 'refs/tags']);
        const releases = result.stdout.split('\n').filter(Boolean).map((line) => {
            const [tag, message, date] = line.split('\x1f');
            return { tag, message, date };
        });
        sendJson(response, 200, { releases });
        return;
    }

    if (request.method === 'POST' && action === 'releases') {
        const body = await readJsonBody(request, 16 * 1024);
        const tag = safeTagName(body.tag);
        const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
        if (!message) throw Object.assign(new Error('Release notes are required'), { statusCode: 400 });
        await runGit(repoPath, ['-c', 'core.hooksPath=/dev/null', 'tag', '-a', tag, '-m', message]);
        sendJson(response, 201, { tag, message });
        return;
    }

    sendJson(response, 404, { error: 'Repository API endpoint not found' });
}

async function handleFileApi(request, response, url) {
    const endpoint = url.pathname;
    const relativePath = url.searchParams.get('path') || '';

    if (request.method === 'GET' && endpoint === '/api/files/all') {
        const allEntries = [];
        const visitDirectory = (directoryPath) => {
            for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
                if (entry.isSymbolicLink()) continue;
                const entryPath = path.join(directoryPath, entry.name);
                const metadata = fs.statSync(entryPath);
                allEntries.push({
                    name: entry.name,
                    path: publicPath(entryPath),
                    isFolder: entry.isDirectory(),
                    size: entry.isDirectory() ? 0 : metadata.size,
                    modified: metadata.mtime.toISOString(),
                    extension: entry.isDirectory() ? '' : path.extname(entry.name).slice(1).toLowerCase()
                });
                if (entry.isDirectory()) visitDirectory(entryPath);
            }
        };
        visitDirectory(storageDirectory);
        const sort = url.searchParams.get('sort') || 'name';
        const direction = url.searchParams.get('direction') === 'desc' ? -1 : 1;
        const comparators = {
            name: (left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
            modified: (left, right) => left.modified.localeCompare(right.modified),
            size: (left, right) => left.size - right.size,
            type: (left, right) => left.extension.localeCompare(right.extension) || left.name.localeCompare(right.name)
        };
        allEntries.sort((left, right) => direction * (comparators[sort] || comparators.name)(left, right));
        sendJson(response, 200, { entries: allEntries });
        return;
    }

    if (request.method === 'GET' && endpoint === '/api/files') {
        const directoryPath = safeStoragePath(relativePath);
        const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
            .filter((entry) => !entry.isSymbolicLink())
            .map((entry) => {
                const entryPath = path.join(directoryPath, entry.name);
                const metadata = fs.statSync(entryPath);
                return {
                    name: entry.name,
                    path: publicPath(entryPath),
                    isFolder: entry.isDirectory(),
                    size: entry.isDirectory() ? 0 : metadata.size,
                    modified: metadata.mtime.toISOString(),
                    extension: entry.isDirectory() ? '' : path.extname(entry.name).slice(1).toLowerCase()
                };
            });
        const sort = url.searchParams.get('sort') || 'name';
        const direction = url.searchParams.get('direction') === 'desc' ? -1 : 1;
        const comparators = {
            name: (left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
            modified: (left, right) => left.modified.localeCompare(right.modified),
            size: (left, right) => left.size - right.size,
            type: (left, right) => left.extension.localeCompare(right.extension) || left.name.localeCompare(right.name)
        };
        entries.sort((left, right) => (Number(right.isFolder) - Number(left.isFolder)) || direction * (comparators[sort] || comparators.name)(left, right));
        sendJson(response, 200, { path: relativePath, entries });
        return;
    }

    if (request.method === 'GET' && endpoint === '/api/files/content') {
        const filePath = safeStoragePath(relativePath);
        if (!fs.statSync(filePath).isFile()) throw Object.assign(new Error('Only files can be read'), { statusCode: 400 });
        const content = fs.readFileSync(filePath);
        if (content.length > 2 * 1024 * 1024) throw Object.assign(new Error('File is too large to edit in the browser'), { statusCode: 413 });
        sendJson(response, 200, { path: relativePath, content: content.toString('utf8') });
        return;
    }

    if (request.method === 'GET' && endpoint === '/api/files/preview') {
        const filePath = safeStoragePath(relativePath);
        if (path.extname(filePath).toLowerCase() !== '.pdf' || !fs.statSync(filePath).isFile()) {
            throw Object.assign(new Error('Inline preview is available for PDF files only'), { statusCode: 400 });
        }
        response.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Length': fs.statSync(filePath).size,
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
            'X-Content-Type-Options': 'nosniff'
        });
        await pipeline(fs.createReadStream(filePath), response);
        return;
    }

    if (request.method === 'GET' && endpoint === '/api/files/download') {
        const filePath = safeStoragePath(relativePath);
        if (!fs.statSync(filePath).isFile()) throw Object.assign(new Error('Only files can be downloaded'), { statusCode: 400 });
        response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': fs.statSync(filePath).size,
            'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`
        });
        await pipeline(fs.createReadStream(filePath), response);
        return;
    }

    if (request.method === 'POST' && endpoint === '/api/files/folder') {
        const body = await readJsonBody(request);
        const parentPath = safeStoragePath(body.path || '');
        fs.mkdirSync(path.join(parentPath, safeName(body.name)));
        sendJson(response, 201, { path: publicPath(path.join(parentPath, body.name)) });
        return;
    }

    if (request.method === 'POST' && endpoint === '/api/files/create') {
        const body = await readJsonBody(request, 2 * 1024 * 1024);
        const parentPath = safeStoragePath(body.path || '');
        const name = safeName(body.name);
        const filePath = path.join(parentPath, name);
        fs.writeFileSync(filePath, typeof body.content === 'string' ? body.content : '', { flag: 'wx' });
        sendJson(response, 201, { path: publicPath(filePath) });
        return;
    }

    if (request.method === 'POST' && endpoint === '/api/files/upload') {
        const name = safeName(url.searchParams.get('name') || '');
        const directoryPath = safeStoragePath(relativePath);
        const filePath = path.join(directoryPath, name);
        const body = await readRequestBody(request, maxUploadBytes);
        fs.writeFileSync(filePath, body, { flag: 'wx' });
        sendJson(response, 201, { path: publicPath(filePath), size: body.length });
        return;
    }

    if (request.method === 'PUT' && endpoint === '/api/files/content') {
        const filePath = safeStoragePath(relativePath);
        if (!fs.statSync(filePath).isFile()) throw Object.assign(new Error('Only files can be edited'), { statusCode: 400 });
        const body = await readRequestBody(request, 2 * 1024 * 1024);
        fs.writeFileSync(filePath, body);
        sendJson(response, 200, { path: relativePath, size: body.length });
        return;
    }

    if (request.method === 'POST' && endpoint === '/api/files/rename') {
        const body = await readJsonBody(request);
        const source = safeStoragePath(body.path);
        const destination = path.join(path.dirname(source), safeName(body.name));
        safeStoragePath(publicPath(destination));
        if (fs.existsSync(destination)) throw Object.assign(new Error('An item with that name already exists'), { statusCode: 409 });
        fs.renameSync(source, destination);
        sendJson(response, 200, { path: publicPath(destination) });
        return;
    }

    if (request.method === 'POST' && endpoint === '/api/files/duplicate') {
        const body = await readJsonBody(request);
        const source = safeStoragePath(body.path);
        if (source === storageDirectory) throw Object.assign(new Error('The storage root cannot be duplicated'), { statusCode: 400 });
        const name = safeName(body.name || `Copy of ${path.basename(source)}`);
        const destination = path.join(path.dirname(source), name);
        safeStoragePath(publicPath(destination));
        if (fs.existsSync(destination)) throw Object.assign(new Error('An item with that name already exists'), { statusCode: 409 });
        copyStorageEntry(source, destination);
        sendJson(response, 201, { path: publicPath(destination) });
        return;
    }

    if (request.method === 'POST' && endpoint === '/api/files/move') {
        const body = await readJsonBody(request);
        const source = safeStoragePath(body.path);
        const targetDirectory = safeStoragePath(body.targetPath || '');
        if (fs.statSync(targetDirectory).isDirectory() === false) throw Object.assign(new Error('Destination must be a folder'), { statusCode: 400 });
        if (fs.statSync(source).isDirectory() && targetDirectory.startsWith(`${source}${path.sep}`)) {
            throw Object.assign(new Error('A folder cannot be moved into itself'), { statusCode: 400 });
        }
        const destination = path.join(targetDirectory, path.basename(source));
        if (fs.existsSync(destination)) throw Object.assign(new Error('An item with that name already exists'), { statusCode: 409 });
        fs.renameSync(source, destination);
        sendJson(response, 200, { path: publicPath(destination) });
        return;
    }

    if (request.method === 'DELETE' && endpoint === '/api/files') {
        if (!relativePath) throw Object.assign(new Error('The storage root cannot be deleted'), { statusCode: 400 });
        const target = safeStoragePath(relativePath);
        fs.rmSync(target, { recursive: true, force: false });
        sendJson(response, 200, { deleted: relativePath });
        return;
    }

    sendJson(response, 404, { error: 'File API endpoint not found' });
}

function serveFile(request, response) {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1);
    const filePath = path.resolve(publicDirectory, relativePath);

    if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(error.code === 'ENOENT' ? 404 : 500);
            response.end(error.code === 'ENOENT' ? 'Not found' : 'Unable to read file');
            return;
        }

        const extension = path.extname(filePath);
        const contentTypes = {
            '.avif': 'image/avif',
            '.css': 'text/css; charset=utf-8',
            '.gif': 'image/gif',
            '.html': 'text/html; charset=utf-8',
            '.ico': 'image/x-icon',
            '.jpeg': 'image/jpeg',
            '.jpg': 'image/jpeg',
            '.js': 'text/javascript; charset=utf-8',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp'
        };
        response.writeHead(200, { 'Content-Type': contentTypes[extension] || 'application/octet-stream' });
        response.end(content);
    });
}

const shortsVideoTypes = {
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
};

function loadShortsStore() {
    try {
        const data = JSON.parse(fs.readFileSync(shortsMetadataPath, 'utf8'));
        return data && data.videos && typeof data.videos === 'object' ? data : { videos: {} };
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Unable to read Shorts metadata:', error.message);
        return { videos: {} };
    }
}

function saveShortsStore(store) {
    fs.writeFileSync(shortsMetadataPath, JSON.stringify(store, null, 2));
}

const musicTypes = {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav'
};
const maxMusicBytes = 250 * 1024 * 1024;

function loadMusicStore() {
    try {
        const data = JSON.parse(fs.readFileSync(musicMetadataPath, 'utf8'));
        return data && data.tracks && typeof data.tracks === 'object' ? data : { tracks: {} };
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Unable to read music metadata:', error.message);
        return { tracks: {} };
    }
}

function saveMusicStore(store) {
    fs.writeFileSync(musicMetadataPath, JSON.stringify(store, null, 2));
}

function musicTrackView(track) {
    return {
        id: track.id,
        name: track.name,
        title: track.title,
        artist: track.artist,
        uploadedBy: track.uploadedBy,
        userId: track.userId || null,
        avatarId: track.avatarId || null,
        mime: track.mime,
        size: track.size,
        uploadedAt: track.uploadedAt,
        audioUrl: `/api/music/${encodeURIComponent(track.id)}/audio`
    };
}

function getMusicTrack(store, id) {
    const track = store.tracks[id];
    if (!track) throw Object.assign(new Error('Music track not found'), { statusCode: 404 });
    return track;
}

function getMusicFilePath(track) {
    const extension = path.extname(track.name).toLowerCase();
    if (!musicTypes[extension] || track.diskName !== `${track.id}${extension}`) {
        throw Object.assign(new Error('Music file is unavailable'), { statusCode: 404 });
    }
    return path.join(musicDirectory, track.diskName);
}

async function handleMusicApi(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/music') {
        const store = loadMusicStore();
        const tracks = Object.values(store.tracks)
            .filter((track) => !track.hidden && fs.existsSync(getMusicFilePath(track)))
            .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
            .map(musicTrackView);
        sendJson(response, 200, { tracks });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/api/music') {
        const name = safeName(url.searchParams.get('name') || 'track.mp3');
        const extension = path.extname(name).toLowerCase();
        const mime = musicTypes[extension];
        if (!mime) throw Object.assign(new Error('Use an AAC, FLAC, M4A, MP3, OGA, OGG, OPUS, or WAV audio file'), { statusCode: 400 });
        const title = (url.searchParams.get('title') || path.basename(name, extension)).trim().slice(0, 100);
        const artist = (url.searchParams.get('artist') || '').trim().slice(0, 100);
        const userId = validChatUserId(url.searchParams.get('userId'));
        const profile = getChatProfile(loadChatStore(), userId);
        if (!title) throw Object.assign(new Error('Track title is required'), { statusCode: 400 });
        const id = crypto.randomUUID();
        const diskName = `${id}${extension}`;
        const filePath = path.join(musicDirectory, diskName);
        const size = await receiveMinecraftUpload(request, filePath, maxMusicBytes);
        if (!size) {
            fs.rmSync(filePath, { force: true });
            throw Object.assign(new Error('Audio file is empty'), { statusCode: 400 });
        }
        const track = { id, diskName, name, title, artist, uploadedBy: profile.username, userId, avatarId: profile.avatarId, mime, size, uploadedAt: new Date().toISOString() };
        const store = loadMusicStore();
        store.tracks[id] = track;
        saveMusicStore(store);
        sendJson(response, 201, { track: musicTrackView(track) });
        return;
    }

    const trackMatch = url.pathname.match(/^\/api\/music\/([a-f0-9-]+)(?:\/(audio))?$/i);
    if (trackMatch && request.method === 'PUT' && !trackMatch[2]) {
        const body = await readJsonBody(request, 16 * 1024);
        const store = loadMusicStore();
        const track = getMusicTrack(store, trackMatch[1]);
        if (body.userId !== track.userId) throw Object.assign(new Error('Only the uploader can edit this track'), { statusCode: 403 });
        if (typeof body.title === 'string') {
            const title = body.title.trim();
            if (!title || title.length > 100) throw Object.assign(new Error('Track title must be 1 to 100 characters'), { statusCode: 400 });
            track.title = title;
        }
        if (typeof body.artist === 'string') track.artist = body.artist.trim().slice(0, 100);
        saveMusicStore(store);
        sendJson(response, 200, { track: musicTrackView(track) });
        return;
    }

    if (trackMatch && request.method === 'DELETE' && !trackMatch[2]) {
        const store = loadMusicStore();
        const track = getMusicTrack(store, trackMatch[1]);
        if (url.searchParams.get('userId') !== track.userId) throw Object.assign(new Error('Only the uploader can remove this track'), { statusCode: 403 });
        const chatStore = loadChatStore();
        const alreadyShared = chatStore.messages.some((message) => message.musicId === track.id);
        if (alreadyShared) track.hidden = true;
        else {
            fs.rmSync(getMusicFilePath(track), { force: true });
            delete store.tracks[track.id];
        }
        saveMusicStore(store);
        sendJson(response, 200, { deleted: track.id, preservedForChat: alreadyShared });
        return;
    }

    if (request.method === 'GET' && trackMatch?.[2]) {
        const store = loadMusicStore();
        const track = getMusicTrack(store, trackMatch[1]);
        const filePath = getMusicFilePath(track);
        if (!fs.existsSync(filePath)) throw Object.assign(new Error('Music file not found'), { statusCode: 404 });
        const size = fs.statSync(filePath).size;
        const range = request.headers.range;
        let start = 0;
        let end = size - 1;
        let statusCode = 200;
        if (range) {
            const match = range.match(/^bytes=(\d*)-(\d*)$/);
            if (!match) {
                response.writeHead(416, { 'Content-Range': `bytes */${size}` });
                response.end();
                return;
            }
            if (match[1]) start = Number(match[1]);
            if (match[2]) end = Number(match[2]);
            if (!match[1] && match[2]) start = Math.max(0, size - Number(match[2]));
            if (start > end || start >= size) {
                response.writeHead(416, { 'Content-Range': `bytes */${size}` });
                response.end();
                return;
            }
            end = Math.min(end, size - 1);
            statusCode = 206;
        }
        response.writeHead(statusCode, {
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': track.mime,
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(track.name)}`,
            'X-Content-Type-Options': 'nosniff',
            ...(statusCode === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
        });
        await pipeline(fs.createReadStream(filePath, { start, end }), response);
        return;
    }

    sendJson(response, 404, { error: 'Music endpoint not found' });
}

function getShortsEntry(store, id) {
    const entry = store.videos[id];
    if (!entry) throw Object.assign(new Error('Short not found'), { statusCode: 404 });
    return entry;
}

function validViewerId(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 100) {
        throw Object.assign(new Error('A valid viewer id is required'), { statusCode: 400 });
    }
    return value;
}

async function handleShortsApi(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/shorts') {
        const store = loadShortsStore();
        let changed = false;
        const videos = fs.readdirSync(shortsDirectory, { withFileTypes: true })
            .filter((entry) => entry.isFile() && shortsVideoTypes[path.extname(entry.name).toLowerCase()])
            .map((entry) => {
                const filePath = path.join(shortsDirectory, entry.name);
                const relativePath = publicPath(filePath);
                let record = Object.values(store.videos).find((video) => video.path === relativePath);
                if (!record) {
                    record = {
                        id: crypto.randomUUID(),
                        path: relativePath,
                        caption: '',
                        uploadedBy: 'Unknown uploader',
                        userId: null,
                        avatarId: null,
                        uploadedAt: fs.statSync(filePath).mtime.toISOString(),
                        likedBy: [],
                        comments: []
                    };
                    store.videos[record.id] = record;
                    changed = true;
                }
                const metadata = fs.statSync(filePath);
                return {
                    id: record.id,
                    name: entry.name,
                    path: record.path,
                    caption: record.caption,
                    uploadedBy: record.uploadedBy || 'Unknown uploader',
                    userId: record.userId || null,
                    avatarId: record.avatarId || null,
                    uploadedAt: record.uploadedAt,
                    size: metadata.size,
                    likes: record.likedBy.length,
                    liked: url.searchParams.get('viewerId') ? record.likedBy.includes(url.searchParams.get('viewerId')) : false,
                    comments: record.comments
                };
            })
            .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
        if (changed) saveShortsStore(store);
        sendJson(response, 200, { videos });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/api/shorts') {
        const body = await readJsonBody(request);
        const userId = validChatUserId(body.userId);
        const profile = getChatProfile(loadChatStore(), userId);
        const filePath = safeStoragePath(body.path);
        if (path.dirname(filePath) !== shortsDirectory || !shortsVideoTypes[path.extname(filePath).toLowerCase()]) {
            throw Object.assign(new Error('Choose a supported video in the Shorts folder'), { statusCode: 400 });
        }
        if (!fs.statSync(filePath).isFile()) throw Object.assign(new Error('Video file not found'), { statusCode: 404 });
        const store = loadShortsStore();
        if (Object.values(store.videos).some((video) => video.path === body.path)) {
            throw Object.assign(new Error('This video is already in Shorts'), { statusCode: 409 });
        }
        const record = {
            id: crypto.randomUUID(),
            path: body.path,
            caption: typeof body.caption === 'string' ? body.caption.trim().slice(0, 500) : '',
            uploadedBy: profile.username,
            userId,
            avatarId: profile.avatarId,
            uploadedAt: new Date().toISOString(),
            likedBy: [],
            comments: []
        };
        store.videos[record.id] = record;
        saveShortsStore(store);
        sendJson(response, 201, { video: { ...record, name: path.basename(body.path), size: fs.statSync(filePath).size, likes: 0, liked: false } });
        return;
    }

    const deleteMatch = url.pathname.match(/^\/api\/shorts\/([\w-]+)$/);
    if (request.method === 'DELETE' && deleteMatch) {
        const store = loadShortsStore();
        const entry = getShortsEntry(store, deleteMatch[1]);
        if (!entry.userId || url.searchParams.get('userId') !== entry.userId) throw Object.assign(new Error('Only the uploader can delete this video'), { statusCode: 403 });
        const filePath = safeStoragePath(entry.path);
        if (path.dirname(filePath) !== shortsDirectory || !shortsVideoTypes[path.extname(filePath).toLowerCase()]) {
            throw Object.assign(new Error('Short video is unavailable'), { statusCode: 404 });
        }
        fs.unlinkSync(filePath);
        delete store.videos[deleteMatch[1]];
        saveShortsStore(store);
        sendJson(response, 200, { deleted: deleteMatch[1] });
        return;
    }

    const videoMatch = url.pathname.match(/^\/api\/shorts\/([\w-]+)\/video$/);
    if (request.method === 'GET' && videoMatch) {
        const store = loadShortsStore();
        const entry = getShortsEntry(store, videoMatch[1]);
        const filePath = safeStoragePath(entry.path);
        const extension = path.extname(filePath).toLowerCase();
        if (path.dirname(filePath) !== shortsDirectory || !shortsVideoTypes[extension] || !fs.statSync(filePath).isFile()) {
            throw Object.assign(new Error('Short video is unavailable'), { statusCode: 404 });
        }

        const size = fs.statSync(filePath).size;
        const range = request.headers.range;
        let start = 0;
        let end = size - 1;
        let statusCode = 200;
        if (range) {
            const match = range.match(/^bytes=(\d*)-(\d*)$/);
            if (!match) {
                response.writeHead(416, { 'Content-Range': `bytes */${size}` });
                response.end();
                return;
            }
            if (match[1]) start = Number(match[1]);
            if (match[2]) end = Number(match[2]);
            if (!match[1] && match[2]) start = Math.max(0, size - Number(match[2]));
            if (start > end || start >= size) {
                response.writeHead(416, { 'Content-Range': `bytes */${size}` });
                response.end();
                return;
            }
            end = Math.min(end, size - 1);
            statusCode = 206;
        }

        response.writeHead(statusCode, {
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': shortsVideoTypes[extension],
            'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
            'X-Content-Type-Options': 'nosniff',
            ...(statusCode === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
        });
        await pipeline(fs.createReadStream(filePath, { start, end }), response);
        return;
    }

    const interactionMatch = url.pathname.match(/^\/api\/shorts\/([\w-]+)\/(like|comments)$/);
    if (request.method === 'POST' && interactionMatch) {
        const body = await readJsonBody(request, 16 * 1024);
        const store = loadShortsStore();
        const entry = getShortsEntry(store, interactionMatch[1]);
        const viewerId = validViewerId(body.viewerId);
        if (interactionMatch[2] === 'like') {
            const existingIndex = entry.likedBy.indexOf(viewerId);
            if (existingIndex === -1) entry.likedBy.push(viewerId);
            else entry.likedBy.splice(existingIndex, 1);
            saveShortsStore(store);
            sendJson(response, 200, { liked: existingIndex === -1, likes: entry.likedBy.length });
            return;
        }

        const userId = validChatUserId(body.userId);
        const profile = getChatProfile(loadChatStore(), userId);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 500) throw Object.assign(new Error('Comments must be between 1 and 500 characters'), { statusCode: 400 });
        const comment = {
            id: crypto.randomUUID(),
            viewerId,
            userId,
            name: profile.username,
            avatarId: profile.avatarId,
            text,
            createdAt: new Date().toISOString()
        };
        entry.comments.push(comment);
        saveShortsStore(store);
        sendJson(response, 201, { comment, count: entry.comments.length });
        return;
    }

    sendJson(response, 404, { error: 'Shorts API endpoint not found' });
}

const chatFileTypes = {
    '.avif': { mime: 'image/avif', category: 'image' },
    '.gif': { mime: 'image/gif', category: 'image' },
    '.jpeg': { mime: 'image/jpeg', category: 'image' },
    '.jpg': { mime: 'image/jpeg', category: 'image' },
    '.png': { mime: 'image/png', category: 'image' },
    '.webp': { mime: 'image/webp', category: 'image' },
    '.mp3': { mime: 'audio/mpeg', category: 'audio' },
    '.m4a': { mime: 'audio/mp4', category: 'audio' },
    '.ogg': { mime: 'audio/ogg', category: 'audio' },
    '.wav': { mime: 'audio/wav', category: 'audio' },
    '.webm': { mime: 'video/webm', category: 'video' },
    '.mp4': { mime: 'video/mp4', category: 'video' },
    '.mov': { mime: 'video/quicktime', category: 'video' },
    '.pdf': { mime: 'application/pdf', category: 'file' },
    '.txt': { mime: 'text/plain; charset=utf-8', category: 'file' },
    '.md': { mime: 'text/markdown; charset=utf-8', category: 'file' },
    '.csv': { mime: 'text/csv; charset=utf-8', category: 'file' },
    '.zip': { mime: 'application/zip', category: 'file' }
};

function loadChatStore() {
    try {
        const data = JSON.parse(fs.readFileSync(chatMetadataPath, 'utf8'));
        return {
            profiles: data.profiles && typeof data.profiles === 'object' ? data.profiles : {},
            files: data.files && typeof data.files === 'object' ? data.files : {},
            messages: Array.isArray(data.messages) ? data.messages : []
        };
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('Unable to read chat metadata:', error.message);
        return { profiles: {}, files: {}, messages: [] };
    }
}

function saveChatStore(store) {
    fs.writeFileSync(chatMetadataPath, JSON.stringify(store, null, 2));
}

function validChatUserId(value) {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value)) {
        throw Object.assign(new Error('A valid chat profile is required'), { statusCode: 400 });
    }
    return value;
}

function getChatProfile(store, userId) {
    const profile = store.profiles[userId];
    if (!profile) throw Object.assign(new Error('Set up your chat profile first'), { statusCode: 400 });
    return profile;
}

function getChatMessage(store, messageId) {
    const message = store.messages.find((entry) => entry.id === messageId);
    if (!message) throw Object.assign(new Error('Chat message not found'), { statusCode: 404 });
    return message;
}

function chatFileView(file) {
    return {
        id: file.id,
        name: file.name,
        size: file.size,
        category: file.category,
        mime: file.mime,
        uploadedAt: file.uploadedAt,
        comments: file.comments || []
    };
}

function getChatFilePath(file) {
    const filePath = path.resolve(chatUploadsDirectory, file.diskName);
    if (path.dirname(filePath) !== chatUploadsDirectory || !fs.existsSync(filePath)) {
        throw Object.assign(new Error('Chat attachment not found'), { statusCode: 404 });
    }
    return filePath;
}

async function handleChatApi(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/chat') {
        const store = loadChatStore();
        const musicStore = loadMusicStore();
        const userId = url.searchParams.get('userId');
        const profile = userId ? store.profiles[userId] || null : null;
        const messages = store.messages.slice(-250).map((message) => ({
            ...message,
            file: message.fileId && store.files[message.fileId] ? chatFileView(store.files[message.fileId]) : null,
            music: message.musicId && musicStore.tracks[message.musicId] ? musicTrackView(musicStore.tracks[message.musicId]) : null,
            reply: message.replyTo ? (() => {
                const repliedTo = store.messages.find((entry) => entry.id === message.replyTo);
                return repliedTo ? { id: repliedTo.id, username: repliedTo.username, text: repliedTo.text, fileName: repliedTo.fileId && store.files[repliedTo.fileId] ? store.files[repliedTo.fileId].name : '', musicTitle: repliedTo.musicId && musicStore.tracks[repliedTo.musicId] ? musicStore.tracks[repliedTo.musicId].title : '' } : null;
            })() : null,
            isPinned: Boolean(message.isPinned)
        }));
        sendJson(response, 200, { profile, messages, pinned: messages.filter((message) => message.isPinned).slice(-10) });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/api/chat/profile') {
        const body = await readJsonBody(request, 16 * 1024);
        const userId = validChatUserId(body.userId);
        const username = typeof body.username === 'string' ? body.username.trim().replace(/\s+/g, ' ') : '';
        if (!username || username.length > 32 || /[\r\n\0]/.test(username)) throw Object.assign(new Error('Username must be 1 to 32 characters'), { statusCode: 400 });
        const store = loadChatStore();
        const existing = store.profiles[userId] || {};
        let avatarId = existing.avatarId || null;
        if (body.avatarId !== undefined) {
            if (body.avatarId === null || body.avatarId === '') avatarId = null;
            else {
                const avatar = store.files[body.avatarId];
                if (!avatar || avatar.userId !== userId || avatar.category !== 'image' || avatar.size > 5 * 1024 * 1024) {
                    throw Object.assign(new Error('Avatar must be an uploaded image under 5 MiB'), { statusCode: 400 });
                }
                avatarId = avatar.id;
            }
        }
        const nextProfile = { userId, username, avatarId, updatedAt: new Date().toISOString() };
        store.profiles[userId] = nextProfile;
        saveChatStore(store);
        sendJson(response, 200, { profile: nextProfile, avatar: avatarId ? chatFileView(store.files[avatarId]) : null });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/api/chat/upload') {
        const userId = validChatUserId(url.searchParams.get('userId'));
        const store = loadChatStore();
        getChatProfile(store, userId);
        const kind = url.searchParams.get('kind') || 'attachment';
        const name = safeName(url.searchParams.get('name') || 'upload');
        const extension = path.extname(name).toLowerCase();
        const fileType = chatFileTypes[extension];
        if (!fileType || (kind === 'avatar' && fileType.category !== 'image') || !['avatar', 'attachment', 'voice'].includes(kind)) {
            throw Object.assign(new Error('Unsupported chat file type'), { statusCode: 400 });
        }
        if (kind === 'voice' && fileType.category !== 'audio') throw Object.assign(new Error('Voice notes must be audio files'), { statusCode: 400 });
        if (kind === 'attachment' && fileType.category === 'audio') throw Object.assign(new Error('Use voice note recording for audio'), { statusCode: 400 });
        const maxBytes = kind === 'avatar' ? 5 * 1024 * 1024 : kind === 'voice' ? 15 * 1024 * 1024 : 50 * 1024 * 1024;
        const id = crypto.randomUUID();
        const diskName = `${id}${extension}`;
        const filePath = path.join(chatUploadsDirectory, diskName);
        const size = await receiveMinecraftUpload(request, filePath, maxBytes);
        if (!size) {
            fs.rmSync(filePath, { force: true });
            throw Object.assign(new Error('Uploaded file is empty'), { statusCode: 400 });
        }
        const file = { id, diskName, name, size, category: fileType.category, mime: fileType.mime, userId, uploadedAt: new Date().toISOString(), comments: [] };
        store.files[id] = file;
        saveChatStore(store);
        sendJson(response, 201, { file: chatFileView(file) });
        return;
    }

    const fileContentMatch = url.pathname.match(/^\/api\/chat\/files\/([a-f0-9-]+)\/content$/i);
    if (request.method === 'GET' && fileContentMatch) {
        const store = loadChatStore();
        const file = store.files[fileContentMatch[1]];
        if (!file) throw Object.assign(new Error('Chat attachment not found'), { statusCode: 404 });
        const filePath = getChatFilePath(file);
        const inline = ['image', 'video', 'audio'].includes(file.category);
        response.writeHead(200, {
            'Content-Type': file.mime,
            'Content-Length': file.size,
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=3600'
        });
        await pipeline(fs.createReadStream(filePath), response);
        return;
    }

    const fileCommentsMatch = url.pathname.match(/^\/api\/chat\/files\/([a-f0-9-]+)\/comments$/i);
    if (request.method === 'POST' && fileCommentsMatch) {
        const body = await readJsonBody(request, 16 * 1024);
        const userId = validChatUserId(body.userId);
        const store = loadChatStore();
        const profile = getChatProfile(store, userId);
        const file = store.files[fileCommentsMatch[1]];
        if (!file) throw Object.assign(new Error('Chat attachment not found'), { statusCode: 404 });
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 1000) throw Object.assign(new Error('File comments must be 1 to 1000 characters'), { statusCode: 400 });
        const comment = { id: crypto.randomUUID(), userId, username: profile.username, avatarId: profile.avatarId, text, createdAt: new Date().toISOString() };
        file.comments = Array.isArray(file.comments) ? file.comments : [];
        file.comments.push(comment);
        if (file.comments.length > 100) file.comments = file.comments.slice(-100);
        saveChatStore(store);
        sendJson(response, 201, { comment });
        return;
    }

    if (request.method === 'POST' && url.pathname === '/api/chat/messages') {
        const body = await readJsonBody(request, 32 * 1024);
        const userId = validChatUserId(body.userId);
        const store = loadChatStore();
        const profile = getChatProfile(store, userId);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        const file = body.fileId ? store.files[body.fileId] : null;
        const musicStore = loadMusicStore();
        const music = body.musicId ? musicStore.tracks[body.musicId] : null;
        if (!text && !file && !music) throw Object.assign(new Error('Write a message or share an attachment or track'), { statusCode: 400 });
        if (text.length > 4000) throw Object.assign(new Error('Messages are limited to 4000 characters'), { statusCode: 400 });
        if (body.fileId && (!file || file.userId !== userId || file.category === 'image' && !body.fileId)) {
            throw Object.assign(new Error('Chat attachment not found'), { statusCode: 404 });
        }
        if (body.musicId && !music) throw Object.assign(new Error('Music track not found'), { statusCode: 404 });
        const replyTo = typeof body.replyTo === 'string' && store.messages.some((message) => message.id === body.replyTo) ? body.replyTo : null;
        const message = {
            id: crypto.randomUUID(), userId, username: profile.username, avatarId: profile.avatarId,
            text, fileId: file ? file.id : null, musicId: music ? music.id : null, replyTo, reactions: {}, isPinned: false,
            createdAt: new Date().toISOString(), editedAt: null
        };
        store.messages.push(message);
        if (store.messages.length > 5000) store.messages = store.messages.slice(-5000);
        saveChatStore(store);
        sendJson(response, 201, { message });
        return;
    }

    const messageMatch = url.pathname.match(/^\/api\/chat\/messages\/([a-f0-9-]+)$/i);
    if (messageMatch && request.method === 'PUT') {
        const body = await readJsonBody(request, 8 * 1024);
        const userId = validChatUserId(body.userId);
        const store = loadChatStore();
        const message = getChatMessage(store, messageMatch[1]);
        if (message.userId !== userId) throw Object.assign(new Error('You can only edit your own messages'), { statusCode: 403 });
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 4000) throw Object.assign(new Error('Edited message must be 1 to 4000 characters'), { statusCode: 400 });
        message.text = text;
        message.editedAt = new Date().toISOString();
        saveChatStore(store);
        sendJson(response, 200, { message });
        return;
    }

    if (messageMatch && request.method === 'DELETE') {
        const body = await readJsonBody(request, 8 * 1024);
        const userId = validChatUserId(body.userId);
        const store = loadChatStore();
        const message = getChatMessage(store, messageMatch[1]);
        if (message.userId !== userId) throw Object.assign(new Error('You can only delete your own messages'), { statusCode: 403 });
        store.messages = store.messages.filter((entry) => entry.id !== message.id);
        saveChatStore(store);
        sendJson(response, 200, { deleted: message.id });
        return;
    }

    const messageActionMatch = url.pathname.match(/^\/api\/chat\/messages\/([a-f0-9-]+)\/(reactions|pin)$/i);
    if (messageActionMatch && request.method === 'POST') {
        const body = await readJsonBody(request, 8 * 1024);
        const userId = validChatUserId(body.userId);
        const store = loadChatStore();
        getChatProfile(store, userId);
        const message = getChatMessage(store, messageActionMatch[1]);
        if (messageActionMatch[2] === 'pin') {
            message.isPinned = body.pinned === undefined ? !message.isPinned : Boolean(body.pinned);
        } else {
            const allowedReactions = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🔥', '👀'];
            if (!allowedReactions.includes(body.emoji)) throw Object.assign(new Error('Unsupported reaction'), { statusCode: 400 });
            message.reactions = message.reactions && typeof message.reactions === 'object' ? message.reactions : {};
            message.reactions[body.emoji] = Array.isArray(message.reactions[body.emoji]) ? message.reactions[body.emoji] : [];
            const viewers = message.reactions[body.emoji];
            const index = viewers.indexOf(userId);
            if (index >= 0) viewers.splice(index, 1);
            else viewers.push(userId);
        }
        saveChatStore(store);
        sendJson(response, 200, { message });
        return;
    }

    sendJson(response, 404, { error: 'Chat endpoint not found' });
}

const server = http.createServer(async (request, response) => {
    const origin = process.env.CORS_ORIGIN || `http://localhost:${port}`;
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
    }

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
        if (url.pathname === '/api/theme' && request.method === 'GET') {
            sendJson(response, 200, { daypart: configuredDaypart });
        } else if (url.pathname === '/api/stats' && request.method === 'GET') {
            sendJson(response, 200, getStats());
        } else if (url.pathname.startsWith('/api/files') || url.pathname.startsWith('/api/music') || url.pathname.startsWith('/api/shorts') || url.pathname.startsWith('/api/repos') || url.pathname.startsWith('/api/minecraft') || url.pathname === '/api/terminal' || url.pathname.startsWith('/api/chat')) {
            if (request.headers.authorization !== `Bearer ${apiToken}` && !isSameOriginDashboardRequest(request)) {
                sendJson(response, 401, { error: 'A valid storage API bearer token is required' });
                return;
            }
            if (url.pathname.startsWith('/api/music')) await handleMusicApi(request, response, url);
            else if (url.pathname.startsWith('/api/shorts')) await handleShortsApi(request, response, url);
            else if (url.pathname.startsWith('/api/repos')) await handleRepositoryApi(request, response, url);
            else if (url.pathname.startsWith('/api/minecraft')) await handleMinecraftApi(request, response, url);
            else if (url.pathname === '/api/terminal') await handleOperationsTerminalApi(request, response, url);
            else if (url.pathname.startsWith('/api/chat')) await handleChatApi(request, response, url);
            else await handleFileApi(request, response, url);
        } else if (request.method === 'GET') {
            serveFile(request, response);
        } else {
            response.writeHead(405, { Allow: 'GET, OPTIONS' });
            response.end('Method not allowed');
        }
    } catch (error) {
        if (response.headersSent) {
            response.destroy(error);
            return;
        }
        sendJson(response, error.statusCode || (error.code === 'ENOENT' ? 404 : error.code === 'EEXIST' ? 409 : 500), {
            error: error.code === 'ENOENT' ? 'File or folder not found' : error.code === 'EEXIST' ? 'An item with that name already exists' : error.message
        });
    }
});

const io = new Server(server);
const gameRooms = new Map();
const availableGames = new Set(['flappy', 'pong', 'rps', 'snake', 'shooter', 'tictactoe']);

function newGameState(game) {
    if (game === 'tictactoe') return { board: Array(9).fill(null), turn: 0, winner: null, draw: false };
    if (game === 'rps') return { round: 1, wins: [0, 0], choices: [null, null], result: null, winner: null };
    if (game === 'pong') return { ball: { x: 0.5, y: 0.5, vx: 0.36, vy: 0.19 }, paddles: [0.5, 0.5], scores: [0, 0], winner: null };
    return { scores: [0, 0], finished: [false, false], winner: null };
}

function roomSnapshot(room) {
    const state = room.game === 'rps' && !room.state.choices.every(Boolean)
        ? { ...room.state, choices: room.state.choices.map(() => null), picked: room.state.choices.map(Boolean) }
        : room.state;
    return {
        code: room.code,
        game: room.game,
        players: room.players.map(({ name, id, avatarId }) => ({ name, id, avatarId })),
        started: room.players.length === 2,
        revision: room.revision,
        state
    };
}

function emitRoom(room) {
    io.to(room.code).emit('room:state', roomSnapshot(room));
}

function roomForSocket(socket) {
    const room = gameRooms.get(socket.data.gameRoom);
    if (!room || !room.players.some((player) => player.id === socket.id)) return null;
    return room;
}

function finishTicTacToe(state) {
    const winningLines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
    const line = winningLines.find(([first, second, third]) => state.board[first] && state.board[first] === state.board[second] && state.board[first] === state.board[third]);
    if (line) state.winner = state.board[line[0]];
    else if (state.board.every(Boolean)) state.draw = true;
}

function removeGamePlayer(socket) {
    const room = roomForSocket(socket);
    if (!room) return;
    room.players = room.players.filter((player) => player.id !== socket.id);
    socket.leave(room.code);
    socket.data.gameRoom = null;
    if (room.players.length === 0) {
        gameRooms.delete(room.code);
        return;
    }
    room.state = newGameState(room.game);
    emitRoom(room);
}

io.on('connection', (socket) => {
    io.emit('arcade:online', io.engine.clientsCount);

    socket.on('game:create', (payload = {}, reply = () => {}) => {
        if (roomForSocket(socket)) return reply({ error: 'Leave your current room first.' });
        if (!availableGames.has(payload.game)) return reply({ error: 'Choose a valid game.' });
        let profile;
        try { profile = getChatProfile(loadChatStore(), validChatUserId(payload.userId)); }
        catch (error) { return reply({ error: error.message }); }
        let code;
        do { code = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (gameRooms.has(code));
        const room = { code, game: payload.game, players: [{ id: socket.id, name: profile.username, avatarId: profile.avatarId, userId: profile.userId }], revision: 0, state: newGameState(payload.game) };
        gameRooms.set(code, room);
        socket.data.gameRoom = code;
        socket.join(code);
        emitRoom(room);
        reply({ room: roomSnapshot(room) });
    });

    socket.on('game:join', (payload = {}, reply = () => {}) => {
        if (roomForSocket(socket)) return reply({ error: 'Leave your current room first.' });
        const code = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
        const room = gameRooms.get(code);
        if (!room) return reply({ error: 'Room not found. Check the code and try again.' });
        if (room.players.length >= 2) return reply({ error: 'That room is already full.' });
        let profile;
        try { profile = getChatProfile(loadChatStore(), validChatUserId(payload.userId)); }
        catch (error) { return reply({ error: error.message }); }
        room.players.push({ id: socket.id, name: profile.username, avatarId: profile.avatarId, userId: profile.userId });
        socket.data.gameRoom = code;
        socket.join(code);
        emitRoom(room);
        reply({ room: roomSnapshot(room) });
    });

    socket.on('game:leave', (_payload = {}, reply = () => {}) => {
        removeGamePlayer(socket);
        reply({ ok: true });
    });

    socket.on('game:restart', (_payload = {}, reply = () => {}) => {
        const room = roomForSocket(socket);
        if (!room) return reply({ error: 'Join a room first.' });
        if (room.players.length !== 2) return reply({ error: 'Waiting for another player.' });
        room.revision += 1;
        room.state = newGameState(room.game);
        emitRoom(room);
        reply({ ok: true });
    });

    socket.on('game:ttt-move', (payload = {}, reply = () => {}) => {
        const room = roomForSocket(socket);
        if (!room || room.game !== 'tictactoe' || room.players.length !== 2) return reply({ error: 'This match is not ready.' });
        const playerIndex = room.players.findIndex((player) => player.id === socket.id);
        const { state } = room;
        if (!Number.isInteger(payload.index) || payload.index < 0 || payload.index > 8 || state.winner || state.draw || state.turn !== playerIndex || state.board[payload.index]) {
            return reply({ error: 'That move is not available.' });
        }
        state.board[payload.index] = playerIndex === 0 ? 'X' : 'O';
        finishTicTacToe(state);
        if (!state.winner && !state.draw) state.turn = 1 - playerIndex;
        emitRoom(room);
        reply({ ok: true });
    });

    socket.on('game:rps-choice', (payload = {}, reply = () => {}) => {
        const room = roomForSocket(socket);
        if (!room || room.game !== 'rps' || room.players.length !== 2) return reply({ error: 'This match is not ready.' });
        if (!['rock', 'paper', 'scissors'].includes(payload.choice)) return reply({ error: 'Choose rock, paper, or scissors.' });
        const playerIndex = room.players.findIndex((player) => player.id === socket.id);
        const { state } = room;
        if (state.winner || state.choices[playerIndex]) return reply({ error: 'Wait for the next round.' });
        state.choices[playerIndex] = payload.choice;
        if (state.choices.every(Boolean)) {
            const [first, second] = state.choices;
            if (first !== second) {
                const firstWins = (first === 'rock' && second === 'scissors') || (first === 'paper' && second === 'rock') || (first === 'scissors' && second === 'paper');
                state.wins[firstWins ? 0 : 1] += 1;
            }
            state.result = state.wins[0] === state.wins[1] ? 'Draw round' : `${room.players[state.wins[0] > state.wins[1] ? 0 : 1].name} takes the round`;
            if (state.wins.some((wins) => wins === 3)) state.winner = state.wins[0] > state.wins[1] ? 0 : 1;
            else state.round += 1;
        }
        emitRoom(room);
        if (state.choices.every(Boolean) && state.winner === null) {
            const completedRound = state.round;
            setTimeout(() => {
                if (gameRooms.get(room.code) !== room || room.state !== state || state.winner !== null || state.round !== completedRound) return;
                state.choices = [null, null];
                state.result = null;
                emitRoom(room);
            }, 1400).unref();
        }
        reply({ ok: true });
    });

    socket.on('game:arcade-score', (payload = {}) => {
        const room = roomForSocket(socket);
        if (!room || room.players.length !== 2 || !['flappy', 'snake', 'shooter'].includes(room.game)) return;
        if (!Number.isInteger(payload.score) || payload.score < 0 || payload.score > 100000) return;
        const playerIndex = room.players.findIndex((player) => player.id === socket.id);
        if (room.state.finished[playerIndex] || room.state.winner !== null) return;
        room.state.scores[playerIndex] = Math.max(room.state.scores[playerIndex], payload.score);
        emitRoom(room);
    });

    socket.on('game:arcade-finish', () => {
        const room = roomForSocket(socket);
        if (!room || room.players.length !== 2 || !['flappy', 'snake', 'shooter'].includes(room.game)) return;
        const playerIndex = room.players.findIndex((player) => player.id === socket.id);
        room.state.finished[playerIndex] = true;
        if (room.state.finished.every(Boolean)) {
            room.state.winner = room.state.scores[0] === room.state.scores[1] ? -1 : room.state.scores[0] > room.state.scores[1] ? 0 : 1;
        }
        emitRoom(room);
    });

    socket.on('game:pong-paddle', (payload = {}) => {
        const room = roomForSocket(socket);
        if (!room || room.game !== 'pong' || room.players.length !== 2 || room.state.winner) return;
        if (typeof payload.y !== 'number' || !Number.isFinite(payload.y)) return;
        const playerIndex = room.players.findIndex((player) => player.id === socket.id);
        room.state.paddles[playerIndex] = Math.max(0.1, Math.min(0.9, payload.y));
    });

    socket.on('disconnect', () => {
        removeGamePlayer(socket);
        io.emit('arcade:online', io.engine.clientsCount);
    });
});

setInterval(() => {
    const delta = 1 / 30;
    for (const room of gameRooms.values()) {
        if (room.game !== 'pong' || room.players.length !== 2 || room.state.winner) continue;
        const state = room.state;
        const ball = state.ball;
        ball.x += ball.vx * delta;
        ball.y += ball.vy * delta;
        if (ball.y < 0.02 || ball.y > 0.98) ball.vy *= -1;
        if (ball.x < 0.075 && Math.abs(ball.y - state.paddles[0]) < 0.13) {
            ball.x = 0.075;
            ball.vx = Math.abs(ball.vx) * 1.035;
            ball.vy += (ball.y - state.paddles[0]) * 0.65;
        } else if (ball.x > 0.925 && Math.abs(ball.y - state.paddles[1]) < 0.13) {
            ball.x = 0.925;
            ball.vx = -Math.abs(ball.vx) * 1.035;
            ball.vy += (ball.y - state.paddles[1]) * 0.65;
        } else if (ball.x < 0 || ball.x > 1) {
            const scorer = ball.x < 0 ? 1 : 0;
            state.scores[scorer] += 1;
            if (state.scores[scorer] >= 5) state.winner = scorer;
            ball.x = 0.5;
            ball.y = 0.5;
            ball.vx = (scorer === 0 ? -1 : 1) * 0.36;
            ball.vy = Math.random() > 0.5 ? 0.19 : -0.19;
        }
        ball.vy = Math.max(-0.7, Math.min(0.7, ball.vy));
        emitRoom(room);
    }
}, 1000 / 30).unref();

server.listen(port, host, () => {
    console.log(`Home Server Dashboard running at http://localhost:${port}`);
    console.log(`Storage API token: ${apiToken}`);
    if (configuredDaypart) console.log(`Fixed background daypart: ${configuredDaypart}`);
    if (terminalTestMode) console.warn('WARNING: TEST_MODE=true disables the terminal executable allowlist. Any executable command can run with the server process permissions.');
});