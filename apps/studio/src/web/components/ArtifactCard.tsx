// What a turn produced, in the exchange that produced it. A tailoring run costs
// credits and a minute of LaTeX, and the file it writes was previously named
// once in the reply and then unreachable.
import type { Artifact } from '../../shared/events';
import { Button } from './ui';

function outputUrl(relPath: string): string {
  // Segments are encoded one at a time so a company name with a space or an em
  // dash survives without the separators being escaped along with it.
  return `/api/outputs/${relPath.split('/').map(encodeURIComponent).join('/')}`;
}

function filename(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

// Every company renders to the same document name, so the directory is the only
// thing telling two cards apart in one turn.
function company(relPath: string): string {
  const cut = relPath.lastIndexOf('/');
  return cut < 0 ? '' : relPath.slice(0, cut + 1);
}

export function ArtifactCard({ artifact, onPreview }: {
  artifact: Artifact;
  onPreview: (relPath: string) => void;
}) {
  const url = outputUrl(artifact.relPath);
  return (
    <div className="my-2 rounded border border-zinc-800 bg-zinc-900/60 p-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-zinc-500">📄</span>
        <p className="min-w-0 flex-1 truncate text-xs text-zinc-200" title={artifact.relPath}>
          <span className="text-zinc-500">{company(artifact.relPath)}</span>
          {filename(artifact.relPath)}
        </p>
        <Button onClick={() => onPreview(artifact.relPath)}>preview</Button>
        <a
          href={url}
          download={filename(artifact.relPath)}
          className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-200 transition hover:bg-zinc-800"
        >
          download
        </a>
      </div>
      {artifact.score || artifact.guardsPass !== undefined ? (
        <p className="mt-1.5 flex gap-3 text-[11px] text-zinc-500">
          {artifact.score ? (
            <span>
              ATS {artifact.score.before}% → <span className="text-zinc-300">{artifact.score.after}%</span>
            </span>
          ) : null}
          {artifact.guardsPass === undefined ? null : (
            <span className={artifact.guardsPass ? 'text-emerald-400' : 'text-red-400'}>
              {artifact.guardsPass ? 'guards passed' : 'guards failed — not ship-ready'}
            </span>
          )}
        </p>
      ) : null}
    </div>
  );
}
