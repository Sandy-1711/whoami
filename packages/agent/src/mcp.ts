// buildMcpServer — the résumé toolkit as a Model Context Protocol (MCP) server.
// It exposes the SAME tools the chat agent uses (assembleTools) so an external
// agent — Claude Code, Cursor, Claude Desktop — can call them directly instead of
// going through `resume chat`. The tools are Mastra `createTool` instances, which
// Mastra's own MCPServer converts to MCP tools by their id, schema, and result.
//
// No memory, no model: an MCP server is a pure tool provider. The client's model
// (e.g. Claude Code's) does the reasoning and decides which tools to call; the
// client is also the human-in-the-loop, prompting the user before each call — so
// the CLI wires an auto-approving confirm gate for this path (see commands/mcp.ts).
import { MCPServer } from '@mastra/mcp';
import type { AgentDeps } from './deps.js';
import { assembleTools } from './agent.js';

export function buildMcpServer(deps: AgentDeps): MCPServer {
  return new MCPServer({
    id: 'resume-agent',
    name: 'Résumé Toolkit',
    version: '1.0.0',
    description: SERVER_DESCRIPTION,
    tools: assembleTools(deps),
  });
}

// What a client reads before it has called anything. Every tool description
// carries its own cost and neighbours; this says how they fit together, because
// the usual mistake is not picking the wrong tool but starting in the wrong
// place — drafting before grounding, or paying to tailor before knowing the fit.
const SERVER_DESCRIPTION = [
  "Sandeep's job-search toolkit: score a job description against his résumé, tailor and build the " +
  'PDF, draft and send applications and outreach, read and edit the verified fact base, research a ' +
  'company on GitHub, and track where every application stands.',
  '',
  'GROUNDING: profile/facts.json is the only source of claims about the candidate. Call read_profile ' +
  'first and assert nothing it does not carry — a plausible-sounding invention is the worst possible ' +
  'output here.',
  '',
  'TYPICAL FLOW: read_profile → score_jd (free, decides whether to bother) → tailor_plan (spends ' +
  'credits, proposes the copy) → tailor_render (compiles the PDF) → draft_application_email or ' +
  'outreach_message → show the user → ' +
  'send_application_email. Every step records itself; log_application is only for what happens ' +
  'off-machine, like a reply.',
  '',
  'COST: each description opens with a COST line. score_jd, read_profile, list_applications and the ' +
  'status tools are free; tailoring and drafting spend API credits; sending mail and pushing to ' +
  'GitHub leave this machine and cannot be taken back.',
].join('\n');
