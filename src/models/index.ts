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

export type User = z.infer<typeof userGetSchema>;
export type PasskeyCredential = z.infer<typeof passkeyCredentialSelectSchema>;
export type PasskeyCredentialInsert = z.infer<
  typeof passkeyCredentialInsertSchema
>;
export type WebAuthnChallenge = z.infer<typeof webAuthnChallengeSchema>;
export type Editor = z.infer<typeof editorSelectSchema>;
export type EditorInsert = z.infer<typeof editorInsertSchema>;
