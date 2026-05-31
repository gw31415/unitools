import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type SearchResponse = {
  items: Array<{
    id: string;
    title: string;
    match?: {
      source: "title" | "content";
      text?: string;
    };
  }>;
  pageInfo: {
    hasMore: boolean;
    nextCursor: string | null;
  };
};

const userId = "01H00000000000000000000000";
const sessionId = "01H00000000000000000000001";
const sessionSecret = "secret";
const alphaId = "01H00000000000000000000002";
const betaId = "01H00000000000000000000003";

const mocks = vi.hoisted(() => ({
  db: {
    query: {
      editors: {
        findMany: vi.fn(),
      },
    },
  },
  drizzle: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: mocks.drizzle,
}));

vi.mock("y-durableobjects", async () => {
  const { Hono } = await import("hono");
  return {
    yRoute: () => new Hono(),
  };
});

const { default: editor } = await import("../editor");

function createEnv(
  ftsResults: Array<Record<string, unknown>> = [
    { editor_id: betaId, content: "Beta content includes Alpha keyword" },
  ],
) {
  const sessionRecord = {
    user: { id: userId, username: "ama", createdAt: Date.now() },
    secret: sessionSecret,
  };
  const ftsAll = vi.fn().mockResolvedValue({
    results: ftsResults,
  });
  const ftsRun = vi.fn().mockResolvedValue({});
  const ftsBind = vi.fn(() => ({ all: ftsAll, run: ftsRun }));
  const ftsPrepare = vi.fn(() => ({ bind: ftsBind, all: ftsAll, run: ftsRun }));
  const authKvGet = vi.fn().mockResolvedValue(sessionRecord);
  const authKvPut = vi.fn().mockResolvedValue(undefined);

  return {
    env: {
      AUTH_KV: {
        get: authKvGet,
        put: authKvPut,
      },
      DB: {
        prepare: ftsPrepare,
      },
    } as unknown as CloudflareBindings,
    ftsAll,
    ftsBind,
    ftsPrepare,
    authKvGet,
    authKvPut,
  };
}

function requestSearch(url: string, env: CloudflareBindings) {
  return editor.request(
    url,
    {
      headers: {
        Cookie: `sid=${userId}:${sessionId}:${sessionSecret}`,
      },
    },
    env,
  );
}

function requestEditorApi(url: string, env: CloudflareBindings, cookie = true) {
  return editor.request(
    url,
    {
      headers: cookie
        ? {
            Cookie: `sid=${userId}:${sessionId}:${sessionSecret}`,
          }
        : undefined,
    },
    env,
  );
}

describe("editor search API", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.drizzle.mockReturnValue(mocks.db);
    mocks.db.query.editors.findMany.mockReset();
  });

  it("returns title matches without querying FTS in title search mode", async () => {
    const { env, ftsPrepare } = createEnv();
    mocks.db.query.editors.findMany.mockResolvedValue([
      { id: alphaId, createdAt: new Date("2026-01-01T00:00:00Z"), title: "Alpha title" },
    ]);

    const res = await requestSearch("http://localhost/?keyword=Alpha&searchMode=title", env);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      items: [
        {
          id: alphaId,
          title: "Alpha title",
          match: { source: "title", text: "Alpha title" },
        },
      ],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    expect(ftsPrepare).not.toHaveBeenCalled();
  });

  it("returns unique content matches in content search mode", async () => {
    const { env } = createEnv();
    mocks.db.query.editors.findMany.mockResolvedValue([
      { id: betaId, createdAt: new Date("2026-01-02T00:00:00Z"), title: "Beta title" },
    ]);

    const res = await requestSearch("http://localhost/?keyword=Alpha&searchMode=content", env);
    const body = (await res.json()) as SearchResponse;

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: betaId,
      title: "Beta title",
      match: { source: "content", text: "Beta content includes Alpha keyword" },
    });
  });

  it("keeps combined search behavior when searchMode is omitted", async () => {
    const { env } = createEnv();
    mocks.db.query.editors.findMany
      .mockResolvedValueOnce([
        { id: alphaId, createdAt: new Date("2026-01-01T00:00:00Z"), title: "Alpha title" },
      ])
      .mockResolvedValueOnce([
        { id: alphaId, createdAt: new Date("2026-01-01T00:00:00Z"), title: "Alpha title" },
        { id: betaId, createdAt: new Date("2026-01-02T00:00:00Z"), title: "Beta title" },
      ]);

    const res = await requestSearch("http://localhost/?keyword=Alpha", env);
    const body = (await res.json()) as SearchResponse;

    expect(res.status).toBe(200);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([alphaId, betaId]);
    expect(body.items[0].match).toEqual({ source: "title", text: "Alpha title" });
    expect(body.items[1]?.match?.source).toBe("content");
  });

  it("skips refreshing session expiration when it was refreshed recently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const { env, authKvGet, authKvPut } = createEnv();
    authKvGet.mockResolvedValue({
      user: { id: userId, username: "ama", createdAt: Date.now() },
      secret: sessionSecret,
      expirationRefreshedAt: new Date("2026-01-01T12:00:00Z").getTime(),
    });
    mocks.db.query.editors.findMany.mockResolvedValue([]);

    const res = await requestSearch("http://localhost/?keyword=Alpha", env);

    expect(res.status).toBe(200);
    expect(authKvPut).not.toHaveBeenCalled();
  });

  it("refreshes session expiration about once a day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const { env, authKvGet, authKvPut } = createEnv();
    authKvGet.mockResolvedValue({
      user: { id: userId, username: "ama", createdAt: Date.now() },
      secret: sessionSecret,
      expirationRefreshedAt: new Date("2026-01-01T00:00:00Z").getTime(),
    });
    mocks.db.query.editors.findMany.mockResolvedValue([]);

    const res = await requestSearch("http://localhost/?keyword=Alpha", env);

    expect(res.status).toBe(200);
    expect(authKvPut).toHaveBeenCalledTimes(1);
  });

  it("returns keyword suggestions from indexed FTS terms", async () => {
    const { env } = createEnv([
      { term: "コンピューター", doc: 2, cnt: 5 },
      { term: "コンピューターサイエンス", doc: 1, cnt: 1 },
      { term: "検索", doc: 3, cnt: 7 },
    ]);

    const res = await requestEditorApi(
      "http://localhost/keywords/suggest?query=コンピュータ&limit=2",
      env,
    );
    const body = (await res.json()) as {
      items: Array<{ term: string; docCount: number; occurrenceCount: number; score: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.items.map((item) => item.term)).toEqual([
      "コンピューター",
      "コンピューターサイエンス",
    ]);
    expect(body.items[0]).toMatchObject({ docCount: 2, occurrenceCount: 5 });
    expect(body.items[0]?.score).toBeGreaterThan(body.items[1]?.score ?? 0);
  });

  it("segments text with the same tokenizer used by the FTS index", async () => {
    const { env } = createEnv([]);

    const res = await requestEditorApi(
      "http://localhost/segments?text=%E6%9D%B1%E4%BA%AC%E9%83%BD%E3%81%A7%E6%A4%9C%E7%B4%A2",
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      segments: ["東京", "都", "で", "検索"],
    });
  });

  it("returns empty keyword suggestions when signed out", async () => {
    const { env, ftsPrepare } = createEnv([{ term: "Alpha", doc: 1, cnt: 1 }]);

    const res = await requestEditorApi("http://localhost/keywords/suggest?query=Alpha", env, false);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ items: [] });
    expect(ftsPrepare).not.toHaveBeenCalled();
  });
});
