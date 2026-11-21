import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version || '1.0.0';

const releaseDir = path.join(rootDir, 'release');
const targetReleaseDir = path.join(rootDir, 'src-tauri', 'target', 'release');
const nsisBundleDir = path.join(targetReleaseDir, 'bundle', 'nsis');

const portableSrc = path.join(targetReleaseDir, 'tay-tube-pc.exe');
const portableDestName = `Tay-Tube-PC-${version}-Portable.exe`;
const portableDest = path.join(releaseDir, portableDestName);

const setupDestName = `Tay-Tube-PC-Setup-${version}.exe`;
const setupDest = path.join(releaseDir, setupDestName);

const MIN_VALID_BYTES = 1024 * 1024; // 1 MB

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function findNsisInstaller(dir) {
  if (!fs.existsSync(dir)) {
    return null;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const match = entries.find(
    (entry) => entry.isFile() && /-setup\.exe$/i.test(entry.name)
  );
  return match ? path.join(dir, match.name) : null;
}

fs.mkdirSync(releaseDir, { recursive: true });
for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
    fs.unlinkSync(path.join(releaseDir, entry.name));
  }
}

if (!fs.existsSync(portableSrc)) {
  console.error(`[export-release] Missing standalone binary: ${portableSrc}`);
  process.exit(1);
}

const setupSrc = findNsisInstaller(nsisBundleDir);
if (!setupSrc || !fs.existsSync(setupSrc)) {
  console.error(`[export-release] Missing NSIS installer in: ${nsisBundleDir}`);
  process.exit(1);
}

fs.copyFileSync(portableSrc, portableDest);
fs.copyFileSync(setupSrc, setupDest);

const portableStat = fs.statSync(portableDest);
const setupStat = fs.statSync(setupDest);

if (portableStat.size <= MIN_VALID_BYTES) {
  console.error(
    `[export-release] Portable binary is unexpectedly small (${portableStat.size} bytes): ${portableDest}`
  );
  process.exit(1);
}

if (setupStat.size <= MIN_VALID_BYTES) {
  console.error(
    `[export-release] NSIS installer is unexpectedly small (${setupStat.size} bytes): ${setupDest}`
  );
  process.exit(1);
}

console.log('[export-release] Exported Windows x64 release binaries:');
console.log(`  - ${setupDestName} (${formatMb(setupStat.size)})`);
console.log(`  - ${portableDestName} (${formatMb(portableStat.size)})`);
