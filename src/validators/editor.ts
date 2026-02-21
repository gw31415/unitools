import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import z from "zod";
import { editors } from "@/db/schema";
import { ulidSchema } from ".";

// NOTE: drizzle-zod が branded-type に対応していないのでそれぞれの id フィールドを上書きしています
//       cf) https://github.com/drizzle-team/drizzle-orm/issues/3834
// TODO: ランタイムでは影響ないはずなので、型のみのワークアラウンドとして対応できると良い

export const editorTitleSchema = z.string().trim().max(20);
export const editorTitleInputSchema = editorTitleSchema
  .nullish()
  .transform((title) => {
    const normalizedTitle = title?.trim();
    return normalizedTitle ? normalizedTitle : undefined;
  });

export const editorInsertSchema = createInsertSchema(editors, {
  id: ulidSchema, // NOTE: drizzle-zod が branded-type に対応していないので上書き
  title: editorTitleInputSchema,
}).omit({
  createdAt: true,
});

export const editorSelectSchema = createSelectSchema(editors, {
  id: ulidSchema, // NOTE: drizzle-zod が branded-type に対応していないので上書き
});
