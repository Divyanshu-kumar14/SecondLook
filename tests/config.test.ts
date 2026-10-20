import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('originsForPort', () => {
  it('accepts both loopback names when the server binds 0.0.0.0', async () => {
    // The container sets HOST=0.0.0.0 so the published port reaches the app.
    // A browser then visits http://localhost:8787 or http://127.0.0.1:8787,
    // neither of which equals the bind address — deriving the allowlist from
    // `host` alone rejected both and every /mcp call returned 403.
    vi.stubEnv('HOST', '0.0.0.0');
    vi.resetModules();
    const { originsForPort } = await import('../server/config.js');
    const origins = originsForPort(8787);
    expect(origins).toContain('http://localhost:8787');
    expect(origins).toContain('http://127.0.0.1:8787');
  });
});
