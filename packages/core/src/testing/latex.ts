// Fakes for the rendering ports, so a tailor run is testable with no TeX
// toolchain and no Docker.
//
// They write real files rather than only returning a CompileResult, because the
// pipeline reads its own artifacts back off disk: it checks the PDF exists,
// copies it to the output folder, and parses the build log for overfull lines. A
// compiler that produced nothing would fail the guards for the wrong reason.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  CompileOptions, CompileResult, EngineReason, LatexCompiler, PdfExtract, PdfInspector,
} from '../ports/latex.js';

// Smallest byte sequence that still looks like a PDF to anything sniffing it.
const FAKE_PDF = '%PDF-1.4\n%fake\n';

/** Nth entry, with the last repeating once the list runs out. */
function at<T>(values: T[], index: number): T {
  return values[Math.min(index, values.length - 1)]!;
}

export interface FakeLatexOptions {
  /** Why nothing can render; null (the default) means a render is possible. */
  availability?: EngineReason | null;
  /**
   * Build log written per compile, in order, the last repeating. This is how a
   * test drives the width guard — it looks for `Overfull \hbox (Npt too wide)`.
   */
  logs?: string[];
  /** Compiles that should produce no PDF, numbered from 1. */
  failCompiles?: number[];
}

export interface FakeLatexCompiler extends LatexCompiler {
  /** The .tex source handed to each compile, in order. */
  readonly compiled: string[];
}

/** A {@link LatexCompiler} that writes a stub PDF and a canned log. */
export function fakeLatexCompiler(options: FakeLatexOptions = {}): FakeLatexCompiler {
  const { availability = null, logs = [''], failCompiles = [] } = options;
  const compiled: string[] = [];

  return {
    compiled,
    availability: () => availability,

    compile(root: string, texRel: string, opts: CompileOptions = {}): CompileResult {
      compiled.push(readFileSync(join(root, texRel), 'utf8'));

      const outDir = join(root, opts.outDir || '.');
      const stem = basename(texRel).replace(/\.tex$/, '');
      mkdirSync(outDir, { recursive: true });
      // latin1, matching how checkLog reads it — LaTeX logs are not valid UTF-8.
      writeFileSync(join(outDir, `${stem}.log`), at(logs, compiled.length - 1), 'latin1');

      if (failCompiles.includes(compiled.length)) {
        return { engine: 'docker', status: 1, output: 'Fake compile failure.' };
      }
      writeFileSync(join(outDir, `${stem}.pdf`), FAKE_PDF);
      return { engine: 'docker', status: 0, output: '' };
    },
  };
}

export interface FakePdfOptions {
  /** Page count reported per extract, in order, the last repeating. */
  pages?: number[];
  /** Text reported per extract, in order, the last repeating. */
  text?: string[];
}

export interface FakePdfInspector extends PdfInspector {
  /** The PDF paths inspected, in order. */
  readonly extracted: string[];
}

/** A {@link PdfInspector} that reports canned page counts without parsing a PDF. */
export function fakePdfInspector(options: FakePdfOptions = {}): FakePdfInspector {
  const { pages = [1], text = [''] } = options;
  const extracted: string[] = [];

  return {
    extracted,
    async extract(path: string): Promise<PdfExtract> {
      extracted.push(path);
      const index = extracted.length - 1;
      return { text: at(text, index), totalPages: at(pages, index) };
    },
  };
}

/** A build log with one overfull-hbox warning wide enough to fail the guard. */
export function overfullLog(pt = 33.48): string {
  return `Overfull \\hbox (${pt}pt too wide) in paragraph at lines 120--124\n`;
}
