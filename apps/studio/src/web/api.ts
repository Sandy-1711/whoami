// Everything the SPA knows about the server. Thin on purpose: the interesting
// logic is server-side, and a component that fetches its own URLs is where a
// route rename starts breaking things silently.
import type { Resume } from '@resume/core';
import type {
  ChatEvent, OutputFile, ThreadMessage, ThreadSummary,
} from '../shared/events';

export interface StatusResponse {
  report: import('@resume/core').StatusReport;
  langfuse: { enabled: boolean; url: string };
}

export interface BuildResponse {
  ok: boolean;
  log: string;
  checks: import('@resume/core').CheckResumeResult;
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `${init?.method ?? 'GET'} ${input} → ${res.status}`);
  return body as T;
}

const asJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getStatus = (): Promise<StatusResponse> => json('/api/status');

export const getResume = (): Promise<{ resume: Resume }> => json('/api/resume');

export const putResume = (resume: Resume): Promise<{ resume: Resume }> =>
  json('/api/resume', asJson('PUT', resume));

export const buildResume = (): Promise<BuildResponse> => json('/api/resume/build', { method: 'POST' });

export const getOutputs = (): Promise<{ outputs: OutputFile[] }> => json('/api/outputs');

export const getThreads = (): Promise<{ threads: ThreadSummary[] }> => json('/api/threads');

export const getThread = (id: string): Promise<{ messages: ThreadMessage[] }> =>
  json(`/api/threads/${encodeURIComponent(id)}`);

export const answerConfirm = (id: string, approved: boolean): Promise<unknown> =>
  json(`/api/confirm/${id}`, asJson('POST', { approved }));

export const answerAsk = (id: string, answers: { id: string; answer: string }[]): Promise<unknown> =>
  json(`/api/ask/${id}`, asJson('POST', { answers }));

export async function uploadJd(file: File): Promise<{ path: string; chars: number }> {
  const form = new FormData();
  form.set('file', file);
  return json('/api/files', { method: 'POST', body: form });
}

/** Store pasted text as a JD file, so it reaches the agent the way an upload does. */
export async function pasteJd(text: string): Promise<{ path: string; chars: number }> {
  const form = new FormData();
  form.set('text', text);
  return json('/api/files', { method: 'POST', body: form });
}

/**
 * Run one chat turn, calling `onEvent` for each chunk as it arrives.
 *
 * EventSource is GET-only, so the stream is read off the fetch body and framed
 * here. SSE frames end at a blank line; only the `data:` lines carry payload,
 * and the event name is already in it.
 */
export async function streamChat(
  body: { message: string; threadId: string },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat', { ...asJson('POST', body), signal });
  if (!res.ok || !res.body) {
    const failed = await res.json().catch(() => ({}));
    throw new Error((failed as { error?: string }).error || `The turn did not start (${res.status}).`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;

    let split = buffered.indexOf('\n\n');
    while (split >= 0) {
      const frame = buffered.slice(0, split);
      buffered = buffered.slice(split + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (data) {
        try {
          onEvent(JSON.parse(data) as ChatEvent);
        } catch {
          onEvent({ type: 'error', message: 'The server sent a chunk this page could not read.' });
        }
      }
      split = buffered.indexOf('\n\n');
    }
  }
}
