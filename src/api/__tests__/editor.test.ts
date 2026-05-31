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

function createEnv() {
  const ftsAll = vi.fn().mockResolvedValue({
    results: [{ editor_id: betaId, content: "Beta content includes Alpha keyword" }],
  });
  const ftsRun = vi.fn().mockResolvedValue({});
  const ftsBind = vi.fn(() => ({ all: ftsAll, run: ftsRun }));
  const ftsPrepare = vi.fn(() => ({ bind: ftsBind }));

  return {
    env: {
      AUTH_KV: {
        get: vi.fn().mockResolvedValue({
          user: { id: userId, username: "ama", createdAt: Date.now() },
          secret: sessionSecret,
        }),
        put: vi.fn().mockResolvedValue(undefined),
      },
      DB: {
        prepare: ftsPrepare,
      },
    } as unknown as CloudflareBindings,
    ftsAll,
    ftsBind,
    ftsPrepare,
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

describe("editor search API", () => {
  beforeEach(() => {
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
});
