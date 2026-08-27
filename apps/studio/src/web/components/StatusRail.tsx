// `resume status` as a rail: is there a key, can anything render, how old are the
// scraped sources, is the canonical PDF built. Plus the way out to the traces,
// since "what did that turn actually send" is the question this whole phase
// exists to make answerable.
import { useEffect, useState } from 'react';
import { getStatus, type StatusResponse } from '../api';
import { Button, Dot, Panel, Row } from './ui';

function ago(iso?: string): string {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export function StatusRail() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [failed, setFailed] = useState('');

  const load = (): void => {
    getStatus().then(setStatus).catch((err: Error) => setFailed(err.message));
  };
  useEffect(load, []);

  const report = status?.report;
  const langfuse = status?.langfuse;

  return (
    <Panel title="status" actions={<Button onClick={load}>refresh</Button>} bodyClass="overflow-y-auto p-3">
      {failed ? <p className="text-xs text-red-400">{failed}</p> : null}
      {!report ? <p className="text-xs text-zinc-600">reading…</p> : (
        <div className="space-y-3">
          <div>
            <Row label="provider">
              <Dot state={report.env.anyKey ? 'ok' : 'bad'} /> {report.env.activeProvider || 'none'}
            </Row>
            <Row label="render">
              <Dot state={report.toolchain.canRender ? 'ok' : 'bad'} />{' '}
              {report.toolchain.canRender ? 'ready' : report.toolchain.reason ?? 'unavailable'}
            </Row>
            <Row label="github token">
              <Dot state={report.env.githubToken ? 'ok' : 'maybe'} /> {report.env.githubToken ? 'set' : 'unset'}
            </Row>
          </div>

          <div>
            <Row label="github">
              <Dot state={report.sources.github.present ? 'ok' : 'bad'} /> {ago(report.sources.github.scrapedAt)}
            </Row>
            <Row label="linkedin">
              <Dot state={report.sources.linkedin.present ? 'ok' : 'bad'} /> {ago(report.sources.linkedin.scrapedAt)}
            </Row>
            <p className="pt-0.5 text-[11px] text-zinc-600">{report.sources.github.summary}</p>
          </div>

          <div>
            <Row label="canonical pdf">
              <Dot state={report.canonical.built ? 'ok' : 'maybe'} />{' '}
              {report.canonical.built ? `${report.canonical.sizeKb} KB · ${ago(report.canonical.builtAt)}` : 'not built'}
            </Row>
            <Row label="tailored">{report.tailored.length} on disk</Row>
          </div>

          <div className="border-t border-zinc-800 pt-2">
            <Row label="tracing">
              <Dot state={langfuse?.enabled ? 'ok' : 'maybe'} /> {langfuse?.enabled ? 'on' : 'off'}
            </Row>
            {langfuse?.url ? (
              <a
                href={langfuse.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-cyan-400 hover:underline"
              >
                open Langfuse ↗
              </a>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
