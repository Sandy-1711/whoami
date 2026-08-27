// The rendered document, and the way in to the fields that produced it. Defaults
// to the canonical PDF; the picker switches to anything under tailored/, which
// is how a tailoring run is reviewed without leaving the page.
//
// Which file is showing lives in App, because the transcript can change it too:
// a card under the turn that built something previews it here.
import { useEffect, useState } from 'react';
import { getOutputs } from '../api';
import type { OutputFile } from '../../shared/events';
import { Button, Panel } from './ui';

export const CANONICAL = '';

// Closing the editor with an edit still in it is the one state worth naming on
// the button, since the pane it was typed into is about to be gone from view.
function editLabel(editing: boolean, dirty: boolean): string {
  if (editing) return 'close editor';
  return dirty ? 'edit · unsaved' : 'edit';
}

export function PdfPreview({ version, showing, onShow, editing, dirty, onEdit }: {
  version: number;
  showing: string;
  onShow: (relPath: string) => void;
  editing: boolean;
  dirty: boolean;
  onEdit: () => void;
}) {
  const [outputs, setOutputs] = useState<OutputFile[]>([]);

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
            onChange={(e) => onShow(e.target.value)}
            className="max-w-56 rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-1 text-xs text-zinc-200 outline-none"
          >
            <option value={CANONICAL}>canonical</option>
            {/* A file previewed from the transcript before this list reloaded
                still needs an option to sit in, or the select shows blank. */}
            {outputs.some((o) => o.relPath === showing) || showing === CANONICAL ? null : (
              <option value={showing}>{showing}</option>
            )}
            {outputs.map((output) => (
              <option key={output.relPath} value={output.relPath}>{output.relPath}</option>
            ))}
          </select>
          <Button onClick={load}>refresh</Button>
          <Button onClick={onEdit}>{editLabel(editing, dirty)}</Button>
        </>
      }
      bodyClass="p-1"
    >
      <iframe key={src} src={src} title="résumé" className="size-full rounded bg-zinc-800" />
    </Panel>
  );
}
