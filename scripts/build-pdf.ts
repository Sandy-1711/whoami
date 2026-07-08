// Build resume.pdf locally, mirroring CI — so the page/width/structure guards
// can run on your machine instead of a slow push.
//
// Uses a local `latexmk` if one is on PATH; otherwise falls back to Docker with
// a full TeX Live image (no LaTeX install needed — just Docker Desktop running).
// Override the image with RESUME_TEX_IMAGE if you like.
//
//   npm run build:pdf:docker   # just build
//   npm run verify             # build, then run all guards
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = process.env.RESUME_TEX_IMAGE || 'texlive/texlive:latest';
// Keep every LaTeX byproduct (.aux/.log/.out/.fls/.pdf …) inside build/ so the
// repo root stays clean. latexmk creates the directory if it's missing.
const OUT = 'build';
const LATEXMK = ['-pdf', '-interaction=nonstopmode', '-halt-on-error', `-outdir=${OUT}`, 'resume.tex'];
const BUILT_PDF = join(root, OUT, 'resume.pdf');

function runs(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
}

function daemonUp(): boolean {
  // `docker version` includes the Server line only when the daemon is reachable.
  return spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  }).status === 0;
}

let result: SpawnSyncReturns<Buffer>;
if (runs('latexmk', ['--version'])) {
  console.log('Compiling with local latexmk …');
  result = spawnSync('latexmk', LATEXMK, { cwd: root, stdio: 'inherit' });
} else if (runs('docker', ['--version'])) {
  if (!daemonUp()) {
    console.error(
      'Docker is installed but its daemon is not reachable — start Docker Desktop and retry.',
    );
    process.exit(1);
  }
  const src = root.replace(/\\/g, '/'); // e.g. D:/ResumeGit — safe for --mount
  console.log(`Compiling in ${IMAGE} (first run pulls the image, ~a few GB) …`);
  result = spawnSync(
    'docker',
    [
      'run', '--rm',
      '--mount', `type=bind,source=${src},target=/work`,
      '-w', '/work',
      IMAGE,
      'latexmk', ...LATEXMK,
    ],
    { stdio: 'inherit' },
  );
} else {
  console.error('Need either `latexmk` or Docker (Desktop running) to build the PDF locally.');
  process.exit(1);
}

// latexmk can exit non-zero on benign warnings; trust the artifact instead.
if (!existsSync(BUILT_PDF)) {
  console.error(`\nBuild failed: ${OUT}/resume.pdf was not produced (see log above).`);
  process.exit(result.status || 1);
}
mkdirSync(join(root, 'assets'), { recursive: true });
copyFileSync(BUILT_PDF, join(root, 'assets', 'resume.pdf'));
console.log(`✓ Built ${OUT}/resume.pdf → assets/resume.pdf`);
