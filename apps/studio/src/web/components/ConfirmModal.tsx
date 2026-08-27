// The approval. It renders the resolved call — tool id, the values it will act
// on, the exact bytes that go out — because that is the only thing that makes an
// approval mean anything. Nothing here is written by the model about itself.
import type { ConfirmPrompt } from '../useChat';
import { Button, Modal } from './ui';

export function ConfirmModal({ prompt, onAnswer }: {
  prompt: ConfirmPrompt;
  onAnswer: (approved: boolean) => void;
}) {
  const { tool, action, params, preview } = prompt.request;
  const values = Object.entries(params ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '');

  return (
    <Modal title={action}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-3 font-mono text-xs text-cyan-300">{tool}</p>

        {values.length ? (
          <dl className="mb-3 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            {values.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-zinc-500">{key}</dt>
                <dd className="break-words text-zinc-200">{String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {preview?.trim() ? (
          <pre className="max-h-80 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-xs whitespace-pre-wrap text-zinc-300">
            {preview}
          </pre>
        ) : null}
      </div>

      <footer className="flex shrink-0 justify-end gap-2 border-t border-zinc-800 px-4 py-3">
        <Button onClick={() => onAnswer(false)}>refuse</Button>
        <Button tone="go" onClick={() => onAnswer(true)}>approve</Button>
      </footer>
    </Modal>
  );
}
