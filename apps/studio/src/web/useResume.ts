// The canonical document, held above the pane that edits it.
//
// It lives here rather than inside ResumeEditor because the editor is opened and
// closed on demand: state kept in a component that unmounts is an edit somebody
// was halfway through, discarded without being asked.
import { useCallback, useEffect, useState } from 'react';
import type { Resume } from '@resume/core';
import { buildResume, getResume, putResume, type BuildResponse } from './api';

export interface ResumeDoc {
  /** The working copy, or null until the first read lands. */
  resume: Resume | null;
  /** Whatever the last read or write left to say — an error, or a confirmation. */
  note: string;
  /** A read, write or compile is in flight. */
  busy: boolean;
  /** The last compile's log and guard verdict. */
  report: BuildResponse | null;
  /** Whether the working copy has moved away from what the server last confirmed. */
  dirty: boolean;
  /** Bumped by every successful compile, so the preview reloads the render it just watched. */
  built: number;
  edit: (change: Partial<Resume>) => void;
  save: () => Promise<void>;
  compile: () => Promise<void>;
}

export function useResume(): ResumeDoc {
  const [resume, setResume] = useState<Resume | null>(null);
  const [stored, setStored] = useState<Resume | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BuildResponse | null>(null);
  const [built, setBuilt] = useState(0);

  useEffect(() => {
    getResume()
      .then((r) => { setResume(r.resume); setStored(r.resume); })
      .catch((err: Error) => setNote(err.message));
  }, []);

  const edit = useCallback((change: Partial<Resume>): void => {
    setResume((current) => (current ? { ...current, ...change } : current));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    if (!resume) return;
    setBusy(true);
    setNote('');
    try {
      const { resume: written } = await putResume(resume);
      setResume(written);
      setStored(written);
      setNote('saved · resume.tex re-rendered');
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [resume]);

  const compile = useCallback(async (): Promise<void> => {
    setBusy(true);
    setNote('compiling — this needs Docker or a local latexmk…');
    try {
      setReport(await buildResume());
      setNote('');
      setBuilt((n) => n + 1);
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    resume,
    note,
    busy,
    report,
    dirty: Boolean(resume) && JSON.stringify(resume) !== JSON.stringify(stored),
    built,
    edit,
    save,
    compile,
  };
}
