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
    description:
      "Sandeep's job-search toolkit as MCP tools: score a JD against the résumé, tailor " +
      'and build it, draft/send outreach (Wellfound notes, cold emails), read and edit the ' +
      'verified fact base, refresh scraped GitHub/LinkedIn sources, and track applications. ' +
      'Every claim is grounded in the fact base (profile/facts.json) — nothing is invented.',
    tools: assembleTools(deps),
  });
}
