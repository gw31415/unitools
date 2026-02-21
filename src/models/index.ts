import type { JSONContent } from "@tiptap/core";
import type z from "zod";
import type {
  passkeyCredentialInsertSchema,
  passkeyCredentialSelectSchema,
  userGetSchema,
  webAuthnChallengeSchema,
} from "@/validators/auth";
import type {
  editorInsertSchema,
  editorSelectSchema,
} from "@/validators/editor";
import type { imageInsertSchema, imageSelectSchema } from "@/validators/images";

export type User = z.infer<typeof userGetSchema>;
export type PasskeyCredential = z.infer<typeof passkeyCredentialSelectSchema>;
export type PasskeyCredentialInsert = z.infer<
  typeof passkeyCredentialInsertSchema
>;
export type WebAuthnChallenge = z.infer<typeof webAuthnChallengeSchema>;
export type Editor = z.infer<typeof editorSelectSchema>;
export type EditorInsert = z.infer<typeof editorInsertSchema>;
export type Image = z.infer<typeof imageSelectSchema>;
export type ImageInsert = z.infer<typeof imageInsertSchema>;

export type EditorState = {
  editorId: string;
  createdAt?: number;
  title?: string;
  yjsUpdate?: string;
  snapshotJSON?: JSONContent;
};
