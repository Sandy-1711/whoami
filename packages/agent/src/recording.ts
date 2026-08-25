// Recording — every tool call writes itself down, whoever called it.
//
// The tracker used to be a tool the model had to remember to invoke, which meant
// it was only ever as current as the model was diligent; over MCP the client's
// model had no reason to know it existed at all. So the toolkit records itself:
// assembleTools wraps each tool once, and from then on every call lands in the
// activity log, and the ones that move an application forward update the tracker
// too. Nothing downstream has to opt in.
import { recordActivity } from './activity.js';
import { logApplication } from './tracker.js';

// Tool inputs and results are heterogeneous by design — each tool answers a
// different question — so this layer reads them by key rather than by type.
type Bag = Record<string, any>;

interface Executable {
  execute?: (...args: any[]) => Promise<unknown>;
}

// What a completed call means for the application it belongs to. Only tools that
// genuinely advance an application appear here; everything else is activity, not
// a status change.
const ADVANCES: Record<string, (input: Bag, result: Bag) => { status: string; channel?: string } | null> = {
  tailor_resume: () => ({ status: 'tailored' }),
  draft_application_email: () => ({ status: 'drafted', channel: 'email' }),
  send_application_email: (_input, result) => (result.sent ? { status: 'sent', channel: 'email' } : null),
  outreach_message: (input) => ({ status: 'drafted', channel: OUTREACH_CHANNEL[input.kind] ?? 'other' }),
};

const OUTREACH_CHANNEL: Record<string, string> = {
  wellfound_note: 'wellfound',
  linkedin_dm: 'linkedin',
  cold_email: 'email',
  followup: 'email',
  referral_ask: 'referral',
};

// One line per tool saying what actually happened, so the log reads as a history
// rather than a list of names. Anything absent here records the call alone.
const DETAIL: Record<string, (result: Bag) => string | undefined> = {
  score_jd: (r) => `score ${r.score?.current}/${r.score?.max}, ${r.missing?.length ?? 0} gaps`,
  tailor_resume: (r) => `score ${r.score?.current}→${r.score?.tailored}, guards ${r.guardsPass ? 'pass' : 'FAIL'} → ${r.pdf}`,
  build_resume: (r) => `built ${r.pdf}`,
  check_resume: (r) => `guards ${r.pass ? 'pass' : 'FAIL'}`,
  sync_profiles: (r) => (r.sources ?? []).map((s: Bag) => `${s.source}:${s.status}`).join(' '),
  draft_application_email: (r) => `draft for ${r.to ?? 'no recipient'} → ${r.file}`,
  send_application_email: (r) => (r.sent ? `sent to ${r.to}` : `not sent — ${r.reason}`),
  outreach_message: (r) => `${r.kind}, ${r.wordCount} words → ${r.file ?? 'not filed'}`,
  update_facts: (r) => r.summary,
  update_github_profile: (r) => (r.pushed ? `pushed ${r.target}` : `not pushed — ${r.reason}`),
};

/**
 * Decorate every tool in `tools` so its calls are recorded. Mutates and returns
 * the same map — the tools are freshly built per container, so nothing else
 * holds an undecorated reference.
 */
export function recordTools<T extends object>(root: string, tools: T): T {
  for (const [id, tool] of Object.entries(tools as Record<string, Executable>)) {
    const inner = tool.execute;
    if (!inner) continue;
    tool.execute = async (...args: any[]) => {
      const started = Date.now();
      try {
        const result = await inner(...args);
        await record(root, id, args[0] as Bag, (result ?? {}) as Bag, Date.now() - started);
        return result;
      } catch (err) {
        await recordActivity(root, {
          ts: new Date().toISOString(),
          tool: id,
          ok: false,
          ms: Date.now() - started,
          ...who(args[0] as Bag, {}),
          detail: (err as Error)?.message || String(err),
        });
        throw err;
      }
    };
  }
  return tools;
}

async function record(root: string, id: string, input: Bag, result: Bag, ms: number): Promise<void> {
  const identity = who(input, result);
  const artifacts = artifactsOf(result);
  await recordActivity(root, {
    ts: new Date().toISOString(),
    tool: id,
    ok: true,
    ms,
    ...identity,
    detail: DETAIL[id]?.(result),
    ...(artifacts.length ? { artifacts } : {}),
  });

  const advance = ADVANCES[id]?.(input, result);
  if (!advance || !identity.company) return;
  await logApplication(root, {
    company: identity.company,
    role: identity.role,
    channel: advance.channel,
    status: advance.status,
    artifacts,
  }, { advanceOnly: true }).catch(() => { /* the tracker never fails the action it tracks */ });
}

function who(input: Bag, result: Bag): { company?: string; role?: string } {
  // The input carries what the caller asked for; the result carries what the
  // pipeline resolved (a role read out of the JD, say). Prefer the caller's.
  const company = str(input?.company) || str(result?.company);
  const role = str(input?.role) || str(result?.role);
  return { ...(company ? { company } : {}), ...(role ? { role } : {}) };
}

function artifactsOf(result: Bag): string[] {
  const found = [str(result?.pdf), str(result?.file), ...(Array.isArray(result?.artifacts) ? result.artifacts.map(str) : [])];
  return [...new Set(found.filter((v): v is string => Boolean(v)))];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
