import type { JSONContent } from "@tiptap/core";
import type z from "zod";
import type {
  passkeyCredentialInsertSchema,
  userGetSchema,
  webAuthnChallengeSchema,
} from "@/validators/auth";
import type { editorSelectSchema } from "@/validators/editor";

export type User = z.infer<typeof userGetSchema>;
export type PasskeyCredentialInsert = z.infer<typeof passkeyCredentialInsertSchema>;
export type WebAuthnChallenge = z.infer<typeof webAuthnChallengeSchema>;
export type Editor = z.infer<typeof editorSelectSchema>;

export type EditorState = {
  editorId: string;
  createdAt?: number;
  title?: string;
  yjsUpdate?: string;
  snapshotJSON?: JSONContent;
};
