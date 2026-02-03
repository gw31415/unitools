import {
  YDurableObjects as BaseYDurableObjects,
  WSSharedDoc,
} from "y-durableobjects";
import type { Env } from "@/lib/hono";

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
}
