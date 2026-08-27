import { describe, expect, it } from 'vitest';
import { isApiRequest } from './dispatch.js';

describe('isApiRequest', () => {
  it('claims the API routes', () => {
    expect(isApiRequest('/api/status')).toBe(true);
    expect(isApiRequest('/api/outputs/acme/Ada.pdf')).toBe(true);
    expect(isApiRequest('/api/resume.pdf?v=3')).toBe(true);
  });

  it('leaves the SPA’s own api.ts to Vite', () => {
    // The bug this exists for: a prefix test on '/api' swallows the module,
    // its import 404s, and the page renders blank.
    expect(isApiRequest('/api.ts')).toBe(false);
    expect(isApiRequest('/api.ts?t=1712')).toBe(false);
  });

  it('leaves the rest of the SPA to Vite', () => {
    for (const url of ['/', '/main.tsx', '/components/ui.tsx', '/@vite/client', '/apiary']) {
      expect(isApiRequest(url)).toBe(false);
    }
  });
});
