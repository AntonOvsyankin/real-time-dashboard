import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = 'wasm/market-generator/Cargo.toml';
const built = join(
  root,
  'wasm',
  'market-generator',
  'target',
  'wasm32-unknown-unknown',
  'release',
  'market_generator.wasm',
);
const outDir = join(root, 'public', 'wasm');
const out = join(outDir, 'market_generator.wasm');

const args = ['build', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', manifest];
const options = { cwd: root, stdio: 'inherit' };
// With shell: true, Node 24 deprecates passing an args array (DEP0190), so Windows gets one command string.
const result =
  process.platform === 'win32'
    ? spawnSync(['cargo', ...args].join(' '), { ...options, shell: true })
    : spawnSync('cargo', args, options);

if (result.error) {
  console.error(`build-wasm: failed to run cargo: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`build-wasm: cargo exited with code ${result.status}`);
  process.exit(result.status ?? 1);
}

mkdirSync(outDir, { recursive: true });
copyFileSync(built, out);
console.log(`build-wasm: wrote public/wasm/market_generator.wasm (${statSync(out).size} bytes)`);
