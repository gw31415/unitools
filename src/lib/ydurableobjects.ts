import { renderToMarkdown } from "@tiptap/static-renderer";
import {
  YDurableObjects as BaseYDurableObjects,
  WSSharedDoc,
} from "y-durableobjects";
import type { Doc } from "yjs";
import type { Env } from "@/lib/hono";
import { baseExtensions } from "./editorExtensions";

const debounceDuration = 60000; // 1分

export class YDurableObjects extends BaseYDurableObjects<Env> {
  async reset(): Promise<void> {
    for (const ws of this.state.getWebSockets()) {
      await this.unregisterWebSocket(ws);
      try {
        ws.close(1000, "Document reset");
      } catch {}
    }

    this.sessions.clear();
    (this as unknown as { awarenessClients: Set<number> }).awarenessClients =
      new Set();
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
        const clients = (this as unknown as { awarenessClients: Set<number> })
          .awarenessClients;
        for (const client of [...added, ...updated]) {
          clients.add(client);
        }
        for (const client of removed) {
          clients.delete(client);
        }
      },
    );
  }

  private r2ExportTimer: ReturnType<typeof setTimeout> | null = null;

  protected async onStart(): Promise<void> {
    await super.onStart();

    // デバウンス付きのupdateリスナー
    this.doc.on("update", async (_update) => {
      await this.debouncedExportToR2();
    });
  }

  protected async cleanup(): Promise<void> {
    await super.cleanup();
    // クリーンアップ時は即時実行
    if (this.r2ExportTimer) {
      clearTimeout(this.r2ExportTimer);
      this.r2ExportTimer = null;
    }
    await this.exportToR2();
  }

  private async debouncedExportToR2(): Promise<void> {
    // 既存のタイマーをクリア
    if (this.r2ExportTimer) {
      clearTimeout(this.r2ExportTimer);
    }

    // 1分後に実行
    this.r2ExportTimer = setTimeout(async () => {
      await this.exportToR2();
      this.r2ExportTimer = null;
    }, debounceDuration);
  }

  private async exportToR2(): Promise<void> {
    const id = this.state.id.name!;
    const markdown = this.convertToMarkdown(this.doc);
    await this.env.UNITOOLS_R2.put(`docs/${id}.md`, markdown);
  }

  private convertToMarkdown(doc: Doc): string {
    return renderToMarkdown({
      content: doc,
      extensions: baseExtensions,
    });
  }
}
