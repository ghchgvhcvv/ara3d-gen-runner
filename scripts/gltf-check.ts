/**
 * Engine-side check: runs gltf-check.html in headless Chrome. The page exports
 * a rigged + animated GLB through the real pipeline, loads it with three.js's
 * stock GLTFLoader + AnimationMixer, compares every bone against the
 * generator's own animation, and POSTs the report back here.
 *   npm run test:gltf          (set CHROME=/path/to/chrome if not on macOS default)
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { build } from 'vite';

// Any Chromium-based browser works (Chrome, Chromium, Edge). Override with CHROME=/path/to/browser.
const winDirs = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((d): d is string => !!d);
const CHROME = process.env.CHROME ?? [
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
  // Windows
  ...winDirs.flatMap((d) => [join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]),
].find(existsSync);
if (!CHROME) throw new Error('No Chrome, Chromium or Edge found: set CHROME=/path/to/browser');

const DIST = join(import.meta.dirname, '../dist');
await build({ logLevel: 'error' });

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.pack': 'application/octet-stream', '.txt': 'text/plain',
};

// Fresh browser profile per run (a reused one can be locked by a previous instance).
const profile = mkdtempSync(join(tmpdir(), 'gltf-check-'));
process.on('exit', () => rmSync(profile, { recursive: true, force: true }));

const report = new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/__report') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.end('ok');
        server.close();
        resolve(body);
      });
      return;
    }
    const path = normalize(join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0])));
    if (!path.startsWith(DIST) || !existsSync(path) || statSync(path).isDirectory()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
    res.end(readFileSync(path));
  });
  server.listen(4399, () => {
    const chrome = spawn(CHROME, [
      '--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
      `--user-data-dir=${profile}`,
      'http://localhost:4399/gltf-check.html',
    ], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      chrome.kill();
      server.close();
      reject(new Error('timed out after 5 minutes'));
    }, 300000);
    report.finally(() => {
      clearTimeout(timer);
      chrome.kill();
    }).catch(() => {});
  });
});

const result = JSON.parse(await report);
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
for (const r of result.reports)
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.config.padEnd(44)} bones=${r.bones} clips=${r.clips} maxRotErr=${r.maxAngleDeg}° maxRootErr=${r.maxRootErrM}m handMoved=${r.handMovedM}m${r.problems.length ? '\n     ' + r.problems.join('\n     ') : ''}`);
console.log(result.ok ? 'GLB loads and animates correctly in three.js' : 'PROBLEMS FOUND');
process.exit(result.ok ? 0 : 1);
