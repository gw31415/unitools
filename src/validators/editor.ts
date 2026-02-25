import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from "drizzle-zod";
import type { ZodString } from "zod";
import { editors } from "@/db/schema";
import { ulidSchema } from ".";

// NOTE: drizzle-zod が branded-type に対応していないのでそれぞれの id フィールドを上書きしています
//       cf) https://github.com/drizzle-team/drizzle-orm/issues/3834
// TODO: ランタイムでは影響ないはずなので、型のみのワークアラウンドとして対応できると良い

const title = (z: ZodString) => z.trim().max(20);

export const editorInsertSchema = createInsertSchema(editors, {
  id: ulidSchema, // NOTE: drizzle-zod が branded-type に対応していないので上書き
  title,
}).omit({
  id: true,
  createdAt: true,
});

export const editorSelectSchema = createSelectSchema(editors, {
  id: ulidSchema, // NOTE: drizzle-zod が branded-type に対応していないので上書き
  title,
});

export const editorUpdateSchema = createUpdateSchema(editors, {
  title,
}).omit({
  id: true,
  createdAt: true,
});
