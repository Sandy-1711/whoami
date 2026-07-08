// Compile a .tex to PDF via local latexmk if present, else Docker (same image as
// CI). Shared by the tailor pipeline; build-pdf.mjs keeps its own inline copy for
// the simple `npm run build:pdf:docker` path.
import { spawnSync } from 'node:child_process';

export const IMAGE = process.env.RESUME_TEX_IMAGE || 'texlive/texlive:latest';

export function haveCmd(cmd) {
  return spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
}

export function dockerDaemonUp() {
  return (
    spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf8',
    }).status === 0
  );
}

// Returns { engine, status, output }. Caller should verify the PDF exists rather
// than trusting the exit code (latexmk exits non-zero on benign warnings).
export function compileLatex(root, texRel, { outDir = '.', capture = true } = {}) {
  const args = ['-pdf', '-interaction=nonstopmode', '-halt-on-error', `-outdir=${outDir}`, texRel];
  const io = capture ? { encoding: 'utf8' } : { stdio: 'inherit' };

  if (haveCmd('latexmk')) {
    const r = spawnSync('latexmk', args, { cwd: root, ...io });
    return { engine: 'latexmk', status: r.status, output: (r.stdout || '') + (r.stderr || '') };
  }
  if (haveCmd('docker')) {
    if (!dockerDaemonUp()) return { engine: 'docker', status: 1, output: '', reason: 'docker-daemon-down' };
    const src = root.replace(/\\/g, '/');
    const r = spawnSync(
      'docker',
      ['run', '--rm', '--mount', `type=bind,source=${src},target=/work`, '-w', '/work', IMAGE, 'latexmk', ...args],
      io,
    );
    return { engine: 'docker', status: r.status, output: (r.stdout || '') + (r.stderr || '') };
  }
  return { engine: null, status: 1, output: '', reason: 'no-engine' };
}
