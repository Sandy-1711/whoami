// NodeFetch — the HttpClient adapter over global fetch. The only place the CLI
// talks to the network for LLM calls; provider adapters depend on the port, not
// this class, so they stay unit-testable.
import type { HttpClient, HttpRequest, HttpResponse } from '@resume/core';

export class NodeFetch implements HttpClient {
  async post(url: string, req: HttpRequest = {}): Promise<HttpResponse> {
    const res = await fetch(url, { method: 'POST', headers: req.headers, body: req.body });
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
      json: () => res.json(),
    };
  }
}
