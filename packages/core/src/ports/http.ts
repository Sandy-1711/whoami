// HttpClient port — a thin seam over `fetch` so provider adapters can be unit
// tested without real network calls. The Node adapter (apps/cli) wraps global
// fetch; tests inject a fake.

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface HttpRequest {
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpClient {
  post(url: string, req: HttpRequest): Promise<HttpResponse>;
}
