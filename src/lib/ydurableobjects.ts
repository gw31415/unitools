import { getSchema } from "@tiptap/core";
import { eq, inArray, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { YDurableObjects as BaseYDurableObjects, WSSharedDoc } from "y-durableobjects";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import type { Doc } from "yjs";
import { store } from "@/db/kv";
import * as schema from "@/db/schema";
import type { Env } from "@/lib/hono";
import type { ULID } from "@/lib/ulid";
import { baseExtensions } from "./editorExtensions";
import { tokenize } from "./editorFts";
import { collectReferencedImageIdsFromYXmlFragment } from "./editorImageCleanup";

const EXPORT_DEBOUNCE_MS = 60000; // 1分
const R2_BULK_DELETE_LIMIT = 1000;
const EDITOR_ID_STORAGE_KEY = "editorId";

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
      // Update Debounce Alarm
      await this.state.storage.setAlarm(Date.now() + EXPORT_DEBOUNCE_MS);
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

  // 全員切断した時のコールバック
  async alarm(): Promise<void> {
    await Promise.all(
      (
        [
          {
            promise: this.updateFtsIndex(),
            errMsg: "Failed to update editor FTS index on alarm",
          },
          {
            promise: this.collectConfigureFtsVocabEmbeddings(),
            errMsg: "Failed to collect and configure the FTS vocabulary",
          },
          {
            promise: this.cleanupUnreferencedImages(),
            errMsg: "Failed to cleanup unreferenced images on cleanup",
          },
        ] satisfies { promise: Promise<any>; errMsg: string }[]
      ).map(async ({ promise, errMsg }) => {
        try {
          await promise;
        } catch (error) {
          console.error(errMsg, {
            editorId: this.state.id.name,
            error,
          });
        }
      }),
    );
  }

  private async updateFtsIndex(): Promise<void> {
    const editorId = await this.resolveEditorId();
    if (editorId) {
      await drizzle(this.env.DB).transaction(async (db) => {
        await db
          .delete(schema.editorsFtsIndex)
          .where(eq(schema.editorsFtsIndex.editorId, editorId));

        const paragraphs = this.getParagraphs(this.doc).map((paragraph) => ({
          paragraph,
          terms: tokenize(paragraph),
          editorId,
        }));

        const BATCH_SIZE = 100;
        for (let i = 0; i < paragraphs.length; i += BATCH_SIZE) {
          const batch = paragraphs.slice(i, i + BATCH_SIZE);
          if (batch.length > 0) {
            await db.insert(schema.editorsFtsIndex).values(batch);
          }
        }
      });
    }
  }

  private async collectConfigureFtsVocabEmbeddings(): Promise<void> {
    const ftsVocabDone = await store(this.env, "FtsVocab").value;

    const db = drizzle(this.env.DB, { schema });
    let ftsVocabToProcess: string[];

    if (ftsVocabDone.length === 0) {
      ftsVocabToProcess = (
        await db.query.editorsFtsVocab.findMany({
          columns: { term: true },
        })
      ).map(({ term }) => term);
    } else {
      ftsVocabToProcess = [];
      const BATCH_SIZE = 100;
      for (let i = 0; i < ftsVocabDone.length; i += BATCH_SIZE) {
        const batch = ftsVocabDone.slice(i, i + BATCH_SIZE);
        const results = await db.query.editorsFtsVocab.findMany({
          columns: { term: true },
          where: (vocab) => notInArray(vocab.term, batch),
        });
        ftsVocabToProcess.push(...results.map(({ term }) => term));
      }
    }

    const vectors: VectorizeVector[] = [];
    const processedTerms: string[] = [];
    const EMBEDDINGS_BATCH_SIZE = 128;
    for (let i = 0; i < ftsVocabToProcess.length; i += EMBEDDINGS_BATCH_SIZE) {
      const batch = ftsVocabToProcess.slice(i, i + EMBEDDINGS_BATCH_SIZE);
      const embeddingsResponse = await this.env.AI.run("@cf/baai/bge-m3", {
        text: batch,
      });
      if (!("data" in embeddingsResponse) || !embeddingsResponse.data) {
        continue;
      }
      const embeddings = embeddingsResponse.data;
      batch.forEach((term, index) => {
        processedTerms.push(term);
        vectors.push({ id: term, values: embeddings[index] });
      });
    }
    await this.env.VECTORIZE_FTS_VOCAB_EMBEDDINGS.upsert(vectors);
    store(this.env, "FtsVocab").value = [...ftsVocabDone, ...processedTerms];
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

  // Utils

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

  private getParagraphs(doc: Doc): string[] {
    const texts: string[] = [];
    yXmlFragmentToProseMirrorRootNode(
      doc.getXmlFragment("default"),
      getSchema(baseExtensions),
    ).descendants((node) => {
      if (node.textContent.length > 0) {
        texts.push(node.textContent);
      }
    });
    return texts;
  }
}
