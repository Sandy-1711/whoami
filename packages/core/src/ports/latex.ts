// Rendering ports — compiling LaTeX and inspecting the produced PDF. Concrete
// adapters live in apps/cli (Docker/latexmk compiler, unpdf inspector); the
// tailor pipeline depends only on these interfaces so it can be tested without a
// TeX toolchain.

export type EngineReason = 'docker-daemon-down' | 'no-engine';

export interface CompileResult {
  engine: 'latexmk' | 'docker' | null;
  status: number | null;
  output: string;
  reason?: EngineReason;
}

export interface CompileOptions {
  outDir?: string;
  capture?: boolean;
}

export interface LatexCompiler {
  // null → a render is possible; otherwise the reason nothing can render. Cheap
  // enough to call up front, before spending an LLM call.
  availability(): EngineReason | null;
  compile(root: string, texRel: string, opts?: CompileOptions): CompileResult;
}

export interface PdfExtract {
  text: string;
  totalPages: number;
}

export interface PdfInspector {
  extract(path: string): Promise<PdfExtract>;
}
