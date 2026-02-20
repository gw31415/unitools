import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { images } from "@/db/schema";
import { ulidSchema } from ".";

export const imageInsertSchema = createInsertSchema(images, {
  id: ulidSchema,
  editorId: ulidSchema,
}).omit({
  createdAt: true,
});

export const imageSelectSchema = createSelectSchema(images, {
  id: ulidSchema,
  editorId: ulidSchema,
});
