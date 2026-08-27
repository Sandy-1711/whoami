// The rendered document, beside the fields that produced it. Defaults to the
// canonical PDF; the picker switches to anything under tailored/, which is how
// a tailoring run is reviewed without leaving the page.
import { useEffect, useState } from 'react';
import { getOutputs } from '../api';
import type { OutputFile } from '../../shared/events';
import { Button, Panel } from './ui';

const CANONICAL = '';

export function PdfPreview({ version }: { version: number }) {
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [showing, setShowing] = useState(CANONICAL);

  const load = (): void => {
    getOutputs().then((r) => setOutputs(r.outputs)).catch(() => setOutputs([]));
  };
  useEffect(load, [version]);

  const src = showing === CANONICAL
    ? `/api/resume.pdf?v=${version}`
    : `/api/outputs/${showing.split('/').map(encodeURIComponent).join('/')}?v=${version}`;

  return (
    <Panel
      title="pdf"
      actions={
        <>
          <select
            value={showing}
            onChange={(e) => setShowing(e.target.value)}
            className="max-w-56 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-1 text-xs text-zinc-200 outline-none"
          >
            <option value={CANONICAL}>canonical</option>
            {outputs.map((output) => (
              <option key={output.relPath} value={output.relPath}>{output.relPath}</option>
            ))}
          </select>
          <Button onClick={load}>refresh</Button>
        </>
      }
      bodyClass="p-1"
    >
      <iframe key={src} src={src} title="résumé" className="size-full rounded bg-zinc-800" />
    </Panel>
  );
}
