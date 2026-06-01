import { getSchema } from "@tiptap/core";
import { renderToMarkdown } from "@tiptap/static-renderer";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { YDurableObjects as BaseYDurableObjects, WSSharedDoc } from "y-durableobjects";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import type { Doc } from "yjs";
import * as schema from "@/db/schema";
import type { Env } from "@/lib/hono";
import type { ULID } from "@/lib/ulid";
import { baseExtensions } from "./editorExtensions";
import { upsertEditorFtsIndex, listEditorFtsTerms, updateKeywordEmbeddings } from "./editorFts";
import { collectReferencedImageIdsFromYXmlFragment } from "./editorImageCleanup";
import { normalizeMarkdownExportContent } from "./markdownExport";

const EXPORT_DEBOUNCE_MS = 60000; // 1分
const R2_BULK_DELETE_LIMIT = 1000;
const EDITOR_ID_STORAGE_KEY = "editorId";
const FTS_VOCAB_STORAGE_KEY = "fts-vocab";
const FTS_VOCAB_TTL = 60 * 60 * 1000; // 1時間（ミリ秒）

export class YDurableObjects extends BaseYDurableObjects<Env> {
  override createRoom(roomId: string): WebSocket {
    const client = super.createRoom(roomId);
    void this.state.storage.put(EDITOR_ID_STORAGE_KEY, roomId);
    return client;
  }

  async reset(): Promise<void> {
    for (const ws of this.state.getWebSockets()) {
      await this.unregisterWebSocket(ws);
      try {
        ws.close(1000, "Document reset");
      } catch {}
    }

    this.sessions.clear();
    (this as unknown as { awarenessClients: Set<number> }).awarenessClients = new Set();
    await this.state.storage.deleteAll();

    this.doc = new WSSharedDoc();
    this.doc.on("update", async (update) => {
      await this.storage.storeUpdate(update);
    });
    this.doc.awareness.on(
      "update",
      async ({
        added,
        removed,
        updated,
      }: {
        added: number[];
        removed: number[];
        updated: number[];
      }) => {
        const clients = (this as unknown as { awarenessClients: Set<number> }).awarenessClients;
        for (const client of [...added, ...updated]) {
          clients.add(client);
        }
        for (const client of removed) {
          clients.delete(client);
        }
      },
    );
  }

  protected async onStart(): Promise<void> {
    await super.onStart();

    // デバウンス付きのupdateリスナー（DO Alarmで実装）
    this.doc.on("update", async (_update) => {
      await this.scheduleUpdateDebounceAlarm();
    });
  }

  protected async cleanup(): Promise<void> {
    await super.cleanup();
    if (this.sessions.size === 0) {
      // 最終切断時は保留中のインデックス更新を無効化して即時処理
      await this.state.storage.deleteAlarm();
      await this.alarm();
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.updateFtsIndex();
    } catch (error) {
      console.error("Failed to update editor FTS index on alarm", {
        editorId: this.state.id.name,
        error,
      });
    }
    // FTS Vocab の一覧を保持する
    try {
      const terms = await this.getOrFetchFtsTerms();
      await this.saveFtsTerms(terms);
      await updateKeywordEmbeddings(terms, this.env.AI, this.env.VECTORIZE_FTS_VOCAB_EMBEDDINGS);
    } catch (error) {
      console.error("Failed to update FTS vocab embeddings", {
        editorId: this.state.id.name,
        error,
      });
    }
    try {
      await this.cleanupUnreferencedImages();
    } catch (error) {
      console.error("Failed to cleanup unreferenced images on cleanup", {
        editorId: this.state.id.name,
        error,
      });
    }
  }

  private async scheduleUpdateDebounceAlarm(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + EXPORT_DEBOUNCE_MS);
  }

  private async updateFtsIndex(): Promise<void> {
    const id = await this.resolveEditorId();
    if (!id) {
      return;
    }
    const markdown = this.convertToMarkdown(this.doc);
    await upsertEditorFtsIndex(this.env.DB, id, markdown);
  }

  private async cleanupUnreferencedImages(): Promise<void> {
    const editorId = await this.resolveEditorId();
    if (!editorId) {
      return;
    }

    const xmlFragment = this.doc.getXmlFragment("default");
    const referencedImageIds = collectReferencedImageIdsFromYXmlFragment(xmlFragment);
    const db = drizzle(this.env.DB, { schema });

    const images = await db
      .select({ id: schema.images.id, storageKey: schema.images.storageKey })
      .from(schema.images)
      .where(eq(schema.images.editorId, editorId));
    const staleImages = images.filter((image) => !referencedImageIds.has(image.id));
    if (staleImages.length === 0) {
      return;
    }

    const staleStorageKeys = staleImages.map((image) => image.storageKey);
    for (let i = 0; i < staleStorageKeys.length; i += R2_BULK_DELETE_LIMIT) {
      const chunk = staleStorageKeys.slice(i, i + R2_BULK_DELETE_LIMIT);
      await this.env.UNITOOLS_R2.delete(chunk);
    }

    const staleImageIds = staleImages.map((image) => image.id);
    await db.delete(schema.images).where(inArray(schema.images.id, staleImageIds));
  }

  private async resolveEditorId(): Promise<ULID | undefined> {
    const namedId = this.state.id.name as ULID | undefined;
    if (namedId) {
      return namedId;
    }

    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as { roomId?: string } | undefined;
      const roomId = attachment?.roomId as ULID | undefined;
      if (roomId) {
        return roomId;
      }
    }

    const storedId = await this.state.storage.get<string>(EDITOR_ID_STORAGE_KEY);
    return storedId as ULID | undefined;
  }

  private convertToMarkdown(doc: Doc): string {
    const rootNode = yXmlFragmentToProseMirrorRootNode(
      doc.getXmlFragment("default"),
      getSchema(baseExtensions),
    );
    const normalizedContent = normalizeMarkdownExportContent(rootNode.toJSON());
    return renderToMarkdown({
      content: normalizedContent,
      extensions: baseExtensions,
    });
  }

  private async getFtsTerms(): Promise<string[] | null> {
    const stored = await this.state.storage.get<{ terms: string[]; timestamp: number }>(
      FTS_VOCAB_STORAGE_KEY,
    );
    if (!stored) return null;

    // 有効期限チェック
    const now = Date.now();
    if (now - stored.timestamp > FTS_VOCAB_TTL) {
      await this.state.storage.delete(FTS_VOCAB_STORAGE_KEY);
      return null;
    }

    return stored.terms;
  }

  private async saveFtsTerms(terms: string[]): Promise<void> {
    await this.state.storage.put(FTS_VOCAB_STORAGE_KEY, {
      terms,
      timestamp: Date.now(),
    });
  }

  private async getOrFetchFtsTerms(): Promise<string[]> {
    // まずDOストレージから取得を試みる
    const cached = await this.getFtsTerms();
    if (cached) return cached;

    // キャッシュがない場合はDBから取得
    return await listEditorFtsTerms(this.env.DB);
  }
}
