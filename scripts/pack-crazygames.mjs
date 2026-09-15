// Zips dist-crazygames/ for the CrazyGames upload, with index.html at the root of the archive.
// Windows: the system bsdtar (System32\tar.exe) writes real zip files; a GNU tar found first on PATH (Git Bash) would not.
// macOS / Linux: the `zip` command.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const out = 'skyhook-crazygames.zip', dir = 'dist-crazygames';
if (!existsSync(join(dir, 'index.html'))) throw new Error(`${dir}/index.html not found: run npm run build:crazygames first`);
rmSync(out, { force: true });
if (process.platform === 'win32') {
  execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', out, '-C', dir, 'index.html', 'assets'], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-r', '-q', `../${out}`, 'index.html', 'assets'], { cwd: dir, stdio: 'inherit' });
}
console.log(`${out} (${Math.round(statSync(out).size / 1024)} KB)`);
