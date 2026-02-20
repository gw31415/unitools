import { sValidator } from "@hono/standard-validator";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import z from "zod";
import * as schema from "@/db/schema";
import { createApp } from "@/lib/hono";
import { type ULID, ulid } from "@/lib/ulid";
import { ulidSchema } from "@/validators";
import { requireUser } from "./auth";

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

function getFileExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return extensions[mimeType] || "bin";
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const images = createApp()
  .post(
    "/",
    requireUser,
    sValidator(
      "form",
      z.object({
        file: z.file(),
        editorId: ulidSchema,
      }),
    ),
    async (c) => {
      const { file, editorId } = c.req.valid("form");

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return c.json({ error: "invalid_mime_type" } as const, 400);
      }

      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: "exceeds_max_file_size" } as const, 400);
      }

      const db = drizzle(c.env.DB, { schema });
      const editor = await db.query.editors.findFirst({
        where: eq(schema.editors.id, editorId as ULID),
      });

      if (!editor) {
        return c.json({ error: "Editor not found" }, 404);
      }

      const imageId = ulid();
      const ext = getFileExtension(file.type);
      const storageKey = `images/${editorId}/${imageId}.${ext}`;
      const body = await file.arrayBuffer();

      await c.env.UNITOOLS_R2.put(storageKey, body, {
        httpMetadata: { contentType: file.type },
      });

      try {
        await db
          .insert(schema.images)
          .values({
            id: imageId,
            editorId: editorId as ULID,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            storageKey,
          })
          .returning();
      } catch (dbError) {
        // Attempt R2 cleanup, but don't let cleanup errors mask the original DB error
        try {
          await c.env.UNITOOLS_R2.delete(storageKey);
        } catch (r2Error) {
          console.error("Failed to cleanup R2 after DB error:", {
            imageId,
            editorId,
            storageKey,
            dbError,
            r2Error,
          });
        }

        console.error("Failed to persist image metadata:", {
          imageId,
          editorId,
          storageKey,
          filename: file.name,
          mimeType: file.type,
          fileSize: file.size,
          error: dbError,
        });
        return c.json({ error: "failed_to_save_image" } as const, 500);
      }

      return c.json(
        {
          id: imageId,
          url: `/api/v1/images/${imageId}`,
        } as const,
        201,
      );
    },
  )
  .get("/:id", async (c) => {
    const id = c.req.param("id") as ULID;
    const db = drizzle(c.env.DB, { schema });
    const image = await db.query.images.findFirst({
      where: eq(schema.images.id, id),
    });

    if (!image) {
      return c.notFound();
    }

    const object = await c.env.UNITOOLS_R2.get(image.storageKey);
    if (!object) {
      return c.notFound();
    }

    c.header("Content-Type", image.mimeType);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(object.body);
  })
  .delete("/:id", requireUser, async (c) => {
    const id = c.req.param("id") as ULID;
    const db = drizzle(c.env.DB, { schema });
    const image = await db.query.images.findFirst({
      where: eq(schema.images.id, id),
    });

    if (!image) {
      return c.notFound();
    }

    await c.env.UNITOOLS_R2.delete(image.storageKey);
    await db.delete(schema.images).where(eq(schema.images.id, id));

    return c.body(null, 204);
  });

export default images;
