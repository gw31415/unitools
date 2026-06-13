import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
      editorsFtsIndex: {
        findMany: vi.fn(),
      },
      editorsFtsVocab: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          all: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
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

const { default: editor, fetchEditorSearchItems } = await import("../editor");

function createEnv(
  ftsResults: Array<Record<string, unknown>> = [
    { editor_id: betaId, paragraph: "Beta content includes Alpha keyword" },
  ],
  vocabResults: Array<{ term: string; doc: number; cnt: number }> = [],
) {
  const sessionRecord = {
    user: { id: userId, username: "ama", createdAt: Date.now() },
    secret: sessionSecret,
    expirationRefreshedAt: undefined as number | undefined,
  };
  const ftsAll = vi.fn().mockResolvedValue({
    results: ftsResults,
  });
  const ftsRun = vi.fn().mockResolvedValue({});
  const vocabAll = vi.fn().mockResolvedValue({
    results: vocabResults,
  });
  const ftsBind = vi.fn(() => ({ all: ftsAll, run: ftsRun }));
  const vocabBind = vi.fn(() => ({ all: vocabAll, run: ftsRun }));

  const ftsPrepare = vi.fn((query: string) => {
    if (query.includes("editors_fts_vocab")) {
      return { bind: vocabBind, all: vocabAll, run: ftsRun };
    }
    return { bind: ftsBind, all: ftsAll, run: ftsRun };
  });
  const kvGet = vi.fn((_key?: string): Promise<unknown> => {
    return Promise.resolve(sessionRecord);
  });
  const kvPut = vi.fn().mockResolvedValue(undefined);

  // AI binding モック
  const aiRun = vi.fn().mockResolvedValue({
    shape: [1, 1024],
    data: [Array.from({ length: 1024 }, () => Math.random() - 0.5)],
  });

  // Vectorize binding モック
  const vectorizeQuery = vi.fn().mockResolvedValue({
    matches: [
      { id: "コンピュタ", score: 0.9 },
      { id: "コンピュタサイエンス", score: 0.7 },
    ],
  });
  const getFtsVocabTerms = vi
    .fn()
    .mockResolvedValue(
      vocabResults.length > 0
        ? vocabResults.map(({ term }) => term)
        : ["Alpha", "keyword", "コンピューター", "コンピューターサイエンス", "検索"],
    );
  const durableObjectStub = {
    getFtsVocabTerms,
  };
  const durableObjectNamespace = {
    getByName: vi.fn(() => durableObjectStub),
    idFromName: vi.fn((id: string) => id),
    get: vi.fn(() => durableObjectStub),
  };

  return {
    env: {
      KV: {
        get: kvGet,
        put: kvPut,
      },
      DB: {
        prepare: ftsPrepare,
      },
      AI: {
        run: aiRun,
      },
      VECTORIZE_FTS_VOCAB_EMBEDDINGS: {
        query: vectorizeQuery,
      },
      UNITOOLS_EDITORS: durableObjectNamespace,
    } as unknown as CloudflareBindings,
    ftsAll,
    ftsBind,
    ftsPrepare,
    kvGet,
    kvPut,
    aiRun,
    vectorizeQuery,
    getFtsVocabTerms,
  };
}

function requestSearch(url: string, env: CloudflareBindings) {
  const urlObj = new URL(url);
  const req = new Request(urlObj, {
    headers: {
      Cookie: `sid=${userId}:${sessionId}:${sessionSecret}`,
    },
  });
  return editor.fetch(req, env);
}

function requestEditorApi(
  url: string,
  env: CloudflareBindings,
  cookie = true,
  extraHeaders?: Record<string, string>,
) {
  const urlObj = new URL(url);
  const headers = {
    ...(cookie ? { Cookie: `sid=${userId}:${sessionId}:${sessionSecret}` } : {}),
    ...extraHeaders,
  };
  const req = new Request(urlObj, { headers });
  return editor.fetch(req, env);
}

describe("editor search API", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.drizzle.mockReturnValue(mocks.db);
    mocks.db.query.editors.findMany.mockReset();
    mocks.db.query.editorsFtsIndex.findMany.mockReset();
  });

  it("does not accept search suggestions through REST query params", async () => {
    const { env } = createEnv();
    mocks.db.query.editors.findMany.mockResolvedValue([]);

    const res = await requestSearch("http://localhost/?keyword=Alpha&searchMode=title", env);

    expect(res.status).toBe(400);
    expect(mocks.db.query.editors.findMany).not.toHaveBeenCalled();
  });

  it("returns unique content matches without vocab expansion", async () => {
    const { env, kvGet, getFtsVocabTerms, aiRun, vectorizeQuery } = createEnv();
    // 語彙が空の場合はフォールバック（DOから空配列が返る）
    getFtsVocabTerms.mockResolvedValue([]);
    kvGet.mockResolvedValue([]);
    mocks.db.query.editorsFtsIndex.findMany.mockResolvedValue([
      { editorId: betaId, paragraph: "Beta content includes Alpha keyword" },
    ]);
    mocks.db.query.editors.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: betaId, createdAt: new Date("2026-01-02T00:00:00Z"), title: "Beta title" },
      ]);

    const body = await fetchEditorSearchItems(env, {
      limit: 20,
      keyword: "Alpha",
    });

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: betaId,
      title: "Beta title",
      match: { source: "content", text: "Alpha", paragraph: "Beta content includes Alpha keyword" },
    });
    // 語彙取得はKVストア経由で呼ばれるが、失敗時はAI/Vectorizeは呼ばれない
    expect(kvGet).toHaveBeenCalledWith("kvstore:FtsVocab", "json");
    expect(getFtsVocabTerms).not.toHaveBeenCalled();
    expect(aiRun).not.toHaveBeenCalled();
    expect(vectorizeQuery).not.toHaveBeenCalled();
    expect(mocks.db.query.editorsFtsIndex.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 }),
    );
  });

  it("returns cached content search matches without rebuilding the FTS query", async () => {
    const { env, kvGet, aiRun, vectorizeQuery } = createEnv();
    kvGet.mockImplementation((key?: string) => {
      if (key?.startsWith("editor:search:content:v1:")) {
        return Promise.resolve({
          matches: [
            {
              editorId: betaId,
              match: {
                source: "content",
                text: "Cached Alpha",
                paragraph: "Cached paragraph text",
              },
            },
          ],
        });
      }
      return Promise.resolve({
        user: { id: userId, username: "ama", createdAt: Date.now() },
        secret: sessionSecret,
        expirationRefreshedAt: undefined,
      });
    });
    mocks.db.query.editors.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: betaId, createdAt: new Date("2026-01-02T00:00:00Z"), title: "Beta title" },
      ]);

    const body = await fetchEditorSearchItems(env, {
      limit: 20,
      keyword: "Alpha",
    });

    expect(body.items[0]).toMatchObject({
      id: betaId,
      title: "Beta title",
      match: { source: "content", text: "Cached Alpha", paragraph: "Cached paragraph text" },
    });
    expect(mocks.db.query.editorsFtsIndex.findMany).not.toHaveBeenCalled();
    expect(aiRun).not.toHaveBeenCalled();
    expect(vectorizeQuery).not.toHaveBeenCalled();
  });

  it("returns the server-selected content phrase for content matches", async () => {
    const { env } = createEnv();
    mocks.db.query.editorsFtsIndex.findMany.mockResolvedValue([
      { editorId: betaId, paragraph: "Intro Alpha related keyword after" },
    ]);
    mocks.db.query.editors.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: betaId, createdAt: new Date("2026-01-02T00:00:00Z"), title: "Beta title" },
      ]);

    const body = await fetchEditorSearchItems(env, {
      limit: 20,
      keyword: "Alpha keyword",
    });

    expect(body.items[0]).toMatchObject({
      id: betaId,
      title: "Beta title",
      match: {
        source: "content",
        text: "Alpha related keyword",
        paragraph: "Intro Alpha related keyword after",
      },
    });
  });

  it("returns Dock items with title matches before content matches", async () => {
    const { env } = createEnv();
    mocks.db.query.editorsFtsIndex.findMany.mockResolvedValue([
      { editorId: betaId, paragraph: "Beta content includes Alpha keyword" },
    ]);
    mocks.db.query.editors.findMany
      .mockResolvedValueOnce([
        { id: alphaId, createdAt: new Date("2026-01-01T00:00:00Z"), title: "Alpha title" },
      ])
      .mockResolvedValueOnce([
        { id: alphaId, createdAt: new Date("2026-01-01T00:00:00Z"), title: "Alpha title" },
        { id: betaId, createdAt: new Date("2026-01-02T00:00:00Z"), title: "Beta title" },
      ]);

    const body = await fetchEditorSearchItems(env, { limit: 20, keyword: "Alpha" });

    expect(body.items.map((item: { id: string }) => item.id)).toEqual([alphaId, betaId]);
    expect(body.items[0].match).toEqual({ source: "title", text: "Alpha title" });
    expect(body.items[1]?.match?.source).toBe("content");
  });

  it("skips refreshing session expiration when it was refreshed recently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const { env, kvGet, kvPut } = createEnv();
    kvGet.mockResolvedValue({
      user: { id: userId, username: "ama", createdAt: Date.now() },
      secret: sessionSecret,
      expirationRefreshedAt: new Date("2026-01-01T12:00:00Z").getTime(),
    });
    mocks.db.query.editorsFtsIndex.findMany.mockResolvedValue([]);
    mocks.db.query.editors.findMany.mockResolvedValue([]);

    const res = await requestSearch("http://localhost/", env);

    expect(res.status).toBe(200);
    expect(kvPut).not.toHaveBeenCalled();
  });

  it("refreshes session expiration about once a day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const { env, kvGet, kvPut } = createEnv();
    kvGet.mockResolvedValue({
      user: { id: userId, username: "ama", createdAt: Date.now() },
      secret: sessionSecret,
      expirationRefreshedAt: new Date("2026-01-01T00:00:00Z").getTime(),
    });
    mocks.db.query.editorsFtsIndex.findMany.mockResolvedValue([]);
    mocks.db.query.editors.findMany.mockResolvedValue([]);

    const res = await requestSearch("http://localhost/", env);

    expect(res.status).toBe(200);
    expect(kvPut).toHaveBeenCalledTimes(1);
  });

  it("rejects search suggestion requests without a WebSocket upgrade", async () => {
    const { env, ftsPrepare } = createEnv([], [{ term: "Alpha", doc: 1, cnt: 1 }]);

    const res = await requestEditorApi("http://localhost/search-suggestions", env, false);

    expect(res.status).toBe(401);
    expect(ftsPrepare).not.toHaveBeenCalled();
  });
});
