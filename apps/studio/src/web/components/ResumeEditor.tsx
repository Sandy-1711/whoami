// profile/resume.json, as fields rather than as JSON.
//
// It edits a working copy and PUTs the whole document, so the server's
// parseResume is the only validator and there is no second idea of what a
// résumé is living in the browser. Ids are shown but never editable: an id is
// what a tailoring edit addresses a bullet by, and renaming one silently
// detaches every plan that already referred to it.
import { useEffect, useState } from 'react';
import type { Resume } from '@resume/core';
import { buildResume, getResume, putResume, type BuildResponse } from '../api';
import { Button, Panel } from './ui';

const input = 'w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-zinc-600';

function Text({ label, value, onChange, rows }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-zinc-500">{label}</span>
      {rows
        ? <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={`${input} resize-y`} />
        : <input value={value} onChange={(e) => onChange(e.target.value)} className={input} />}
    </label>
  );
}

function Lines({ label, values, onChange }: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const replace = (i: number, value: string): void => onChange(values.map((v, j) => (j === i ? value : v)));
  return (
    <div>
      <span className="text-[11px] text-zinc-500">{label}</span>
      {values.map((value, i) => (
        <div key={i} className="mb-1 flex gap-1">
          <input value={value} onChange={(e) => replace(i, e.target.value)} className={input} />
          <Button onClick={() => onChange(values.filter((_, j) => j !== i))}>−</Button>
        </div>
      ))}
      <Button onClick={() => onChange([...values, ''])}>add</Button>
    </div>
  );
}

function Bullets({ bullets, onChange }: {
  bullets: { id: string; text: string }[];
  onChange: (bullets: { id: string; text: string }[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {bullets.map((bullet, i) => (
        <div key={bullet.id}>
          <span className="font-mono text-[10px] text-zinc-600">{bullet.id}</span>
          <textarea
            rows={2}
            value={bullet.text}
            onChange={(e) => onChange(bullets.map((b, j) => (j === i ? { ...b, text: e.target.value } : b)))}
            className={`${input} resize-y`}
          />
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded border border-zinc-800 p-2">
      <legend className="px-1 text-[11px] tracking-wide text-zinc-500 uppercase">{title}</legend>
      <div className="space-y-2">{children}</div>
    </fieldset>
  );
}

function BuildReport({ report }: { report: BuildResponse }) {
  const problems = [report.checks.source, report.checks.pdf, report.checks.width].flatMap((g) => g.problems);
  return (
    <div className="border-t border-zinc-800 p-2 text-xs">
      <p className={report.ok ? 'text-emerald-400' : 'text-red-400'}>
        {report.ok ? 'compiled' : 'compile failed'}
        {report.checks.pass ? ' · guards pass' : ` · ${problems.length} guard problem(s)`}
      </p>
      {problems.map((problem, i) => <p key={i} className="mt-0.5 text-amber-300">{problem}</p>)}
      {report.log.trim() ? (
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-[11px] text-zinc-500">
          {report.log.trim().split('\n').slice(-20).join('\n')}
        </pre>
      ) : null}
    </div>
  );
}

export function ResumeEditor({ onBuilt }: { onBuilt: () => void }) {
  const [resume, setResume] = useState<Resume | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BuildResponse | null>(null);

  useEffect(() => {
    getResume().then((r) => setResume(r.resume)).catch((err: Error) => setNote(err.message));
  }, []);

  const edit = (change: Partial<Resume>): void => setResume((r) => (r ? { ...r, ...change } : r));

  const save = async (): Promise<void> => {
    if (!resume) return;
    setBusy(true);
    setNote('');
    try {
      const saved = await putResume(resume);
      setResume(saved.resume);
      setNote('saved · resume.tex re-rendered');
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const compile = async (): Promise<void> => {
    setBusy(true);
    setNote('compiling — this needs Docker or a local latexmk…');
    try {
      setReport(await buildResume());
      setNote('');
      onBuilt();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="résumé"
      actions={
        <>
          <Button onClick={save} disabled={busy || !resume}>save</Button>
          <Button tone="go" onClick={compile} disabled={busy}>build pdf</Button>
        </>
      }
      bodyClass="flex flex-col"
    >
      {note ? <p className="shrink-0 px-3 py-1.5 text-xs text-amber-300">{note}</p> : null}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!resume ? <p className="text-xs text-zinc-600">reading…</p> : (
          <>
            <Section title="header">
              <Text label="name" value={resume.name} onChange={(name) => edit({ name })} />
              <Lines label="subtitle" values={resume.subtitle} onChange={(subtitle) => edit({ subtitle })} />
              <Lines label="contacts" values={resume.contacts} onChange={(contacts) => edit({ contacts })} />
              <Text label="summary" rows={3} value={resume.summary} onChange={(summary) => edit({ summary })} />
            </Section>

            {resume.experience.map((entry, i) => (
              <Section key={entry.id} title={`experience · ${entry.id}`}>
                <Text label="org" value={entry.org} onChange={(org) => edit({
                  experience: resume.experience.map((e, j) => (j === i ? { ...e, org } : e)),
                })} />
                <Text label="role" value={entry.role} onChange={(role) => edit({
                  experience: resume.experience.map((e, j) => (j === i ? { ...e, role } : e)),
                })} />
                <Bullets bullets={entry.bullets} onChange={(bullets) => edit({
                  experience: resume.experience.map((e, j) => (j === i ? { ...e, bullets } : e)),
                })} />
              </Section>
            ))}

            {resume.projects.map((entry, i) => (
              <Section key={entry.id} title={`project · ${entry.id}`}>
                <Text label="name" value={entry.name} onChange={(name) => edit({
                  projects: resume.projects.map((p, j) => (j === i ? { ...p, name } : p)),
                })} />
                <Text label="tech" value={entry.tech} onChange={(tech) => edit({
                  projects: resume.projects.map((p, j) => (j === i ? { ...p, tech } : p)),
                })} />
                <Bullets bullets={entry.bullets} onChange={(bullets) => edit({
                  projects: resume.projects.map((p, j) => (j === i ? { ...p, bullets } : p)),
                })} />
              </Section>
            ))}

            {resume.skills.map((group, i) => (
              <Section key={group.id} title={`skills · ${group.label}`}>
                <Lines label="items" values={group.items} onChange={(items) => edit({
                  skills: resume.skills.map((s, j) => (j === i ? { ...s, items } : s)),
                })} />
              </Section>
            ))}
          </>
        )}
      </div>

      {report ? <BuildReport report={report} /> : null}
    </Panel>
  );
}
