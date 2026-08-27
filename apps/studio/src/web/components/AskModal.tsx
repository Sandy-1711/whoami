// ask_user, with somewhere to answer. The options are suggestions — the field
// stays free text, because the tool's whole point is a preference the model
// could not infer, and a fixed list would just be a different guess.
import { useState } from 'react';
import type { AskPrompt } from '../useChat';
import { Button, Modal } from './ui';

export function AskModal({ prompt, onAnswer }: {
  prompt: AskPrompt;
  onAnswer: (answers: { id: string; answer: string }[]) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const set = (id: string, value: string): void => setAnswers((all) => ({ ...all, [id]: value }));

  return (
    <Modal title="The agent needs a preference">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {prompt.questions.map((q) => (
          <div key={q.id}>
            <label htmlFor={q.id} className="block text-sm text-zinc-200">{q.question}</label>
            {q.why ? <p className="mt-0.5 text-xs text-zinc-500">{q.why}</p> : null}
            {q.options?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {q.options.map((option) => (
                  <Button key={option} onClick={() => set(q.id, option)}>{option}</Button>
                ))}
              </div>
            ) : null}
            <input
              id={q.id}
              value={answers[q.id] ?? ''}
              onChange={(e) => set(q.id, e.target.value)}
              className="mt-1.5 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-zinc-600"
            />
          </div>
        ))}
      </div>

      <footer className="flex shrink-0 justify-end border-t border-zinc-800 px-4 py-3">
        <Button
          tone="go"
          onClick={() => onAnswer(prompt.questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? '' })))}
        >
          answer
        </Button>
      </footer>
    </Modal>
  );
}
