// Compile a .tex to PDF via local latexmk if present, else Docker (same image as
// CI). Shared by the tailor pipeline; build-pdf.ts keeps its own inline copy for
// the simple `npm run build:pdf:docker` path.
import { spawnSync } from 'node:child_process';

export const IMAGE: string = process.env.RESUME_TEX_IMAGE || 'texlive/texlive:latest';

export function haveCmd(cmd: string): boolean {
  return spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
}

export function dockerDaemonUp(): boolean {
  return (
    spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf8',
    }).status === 0
  );
}

export interface CompileResult {
  engine: 'latexmk' | 'docker' | null;
  status: number | null;
  output: string;
  reason?: 'docker-daemon-down' | 'no-engine';
}

export type EngineReason = 'docker-daemon-down' | 'no-engine';

// Cheap up-front probe mirroring compileLatex's engine selection, so callers can
// bail before doing expensive work (e.g. an LLM call) when nothing can render.
// Returns null when a render is possible.
export function renderEngineReason(): EngineReason | null {
  if (haveCmd('latexmk')) return null;
  if (haveCmd('docker')) return dockerDaemonUp() ? null : 'docker-daemon-down';
  return 'no-engine';
}

// Returns { engine, status, output }. Caller should verify the PDF exists rather
// than trusting the exit code (latexmk exits non-zero on benign warnings).
export function compileLatex(
  root: string,
  texRel: string,
  { outDir = '.', capture = true }: { outDir?: string; capture?: boolean } = {},
): CompileResult {
  const args = ['-pdf', '-interaction=nonstopmode', '-halt-on-error', `-outdir=${outDir}`, texRel];
  const io = capture
    ? ({ encoding: 'utf8' } as const)
    : ({ stdio: 'inherit' } as const);

  if (haveCmd('latexmk')) {
    const r = spawnSync('latexmk', args, { cwd: root, ...io });
    return { engine: 'latexmk', status: r.status, output: String(r.stdout || '') + String(r.stderr || '') };
  }
  if (haveCmd('docker')) {
    if (!dockerDaemonUp()) return { engine: 'docker', status: 1, output: '', reason: 'docker-daemon-down' };
    const src = root.replace(/\\/g, '/');
    const r = spawnSync(
      'docker',
      ['run', '--rm', '--mount', `type=bind,source=${src},target=/work`, '-w', '/work', IMAGE, 'latexmk', ...args],
      io,
    );
    return { engine: 'docker', status: r.status, output: String(r.stdout || '') + String(r.stderr || '') };
  }
  return { engine: null, status: 1, output: '', reason: 'no-engine' };
}
