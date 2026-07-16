// LaTeX rendering adapter — implements the LatexCompiler port. Compiles a .tex
// to PDF via local latexmk if present, else Docker (same image as CI). The
// module-level helpers (haveCmd, dockerDaemonUp, compileLatex) are kept for the
// status/build commands and unit tests; DockerLatexCompiler is the injectable
// port implementation the tailor pipeline uses.
import { spawnSync } from 'node:child_process';
import type { LatexCompiler, CompileResult, CompileOptions, EngineReason } from '@resume/core';

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

// Cheap up-front probe mirroring compileLatex's engine selection, so callers can
// bail before doing expensive work (e.g. an LLM call) when nothing can render.
// The probes spawn latexmk/docker synchronously, so the result is memoized for a
// minute — repeat /status or profile_status calls in a chat session shouldn't
// each block on Docker. compileLatex keeps probing live (it only runs when a
// build was actually requested, and must see a just-started daemon).
const ENGINE_PROBE_TTL_MS = 60_000;
let engineProbe: { at: number; reason: EngineReason | null } | null = null;

export function renderEngineReason(): EngineReason | null {
  if (engineProbe && Date.now() - engineProbe.at < ENGINE_PROBE_TTL_MS) return engineProbe.reason;
  const reason = haveCmd('latexmk')
    ? null
    : haveCmd('docker') ? (dockerDaemonUp() ? null : 'docker-daemon-down') : 'no-engine';
  engineProbe = { at: Date.now(), reason };
  return reason;
}

export function resetEngineProbeCache(): void {
  engineProbe = null;
}

// Returns { engine, status, output }. Caller should verify the PDF exists rather
// than trusting the exit code (latexmk exits non-zero on benign warnings).
export function compileLatex(
  root: string,
  texRel: string,
  { outDir = '.', capture = true }: CompileOptions = {},
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

// The injectable LatexCompiler the pipeline depends on.
export class DockerLatexCompiler implements LatexCompiler {
  availability(): EngineReason | null {
    return renderEngineReason();
  }
  compile(root: string, texRel: string, opts?: CompileOptions): CompileResult {
    return compileLatex(root, texRel, opts);
  }
}
