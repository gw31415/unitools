import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { passkeyCredentials, users } from "@/db/schema";

const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/);

export const userSelectSchema = createSelectSchema(users, {
  id: ulidSchema,
  username: usernameSchema,
});

export const userInsertSchema = createInsertSchema(users, {
  id: ulidSchema,
  username: usernameSchema,
});

export const userPostSchema = userInsertSchema.omit({ id: true });
export const userGetSchema = userSelectSchema;

const transportsSchema = z.array(z.string()).optional();

export const credentialSelectSchema = createSelectSchema(passkeyCredentials, {
  id: z.string().min(1),
  userId: ulidSchema,
  publicKey: z.string().min(1),
  counter: z.number().int().nonnegative(),
  transports: transportsSchema,
  createdAt: z.number().int().nonnegative(),
});

export const credentialInsertSchema = createInsertSchema(passkeyCredentials, {
  id: z.string().min(1),
  userId: ulidSchema,
  publicKey: z.string().min(1),
  counter: z.number().int().nonnegative(),
  transports: transportsSchema,
  createdAt: z.number().int().nonnegative().optional(),
});

export const credentialPostSchema = credentialInsertSchema.omit({
  createdAt: true,
});
export const credentialGetSchema = credentialSelectSchema;

export const sessionSchema = z.object({
  id: z.string().min(1),
  secret: z.string().min(1),
});

export const sessionInitSchema = z.object({
  id: z.string().min(1).optional(),
});

export const registrationChallengeSchema = z.object({
  flow: z.literal("registration"),
  challenge: z.string().min(1),
  userId: ulidSchema,
  username: usernameSchema,
});

export const authenticationChallengeSchema = z.object({
  flow: z.literal("authentication"),
  challenge: z.string().min(1),
  sessionId: ulidSchema,
  sessionSecret: z.string().min(1),
  userId: ulidSchema.optional(),
});

export const webAuthnChallengeSchema = z.union([
  registrationChallengeSchema,
  authenticationChallengeSchema,
]);

export type RegistrationChallenge = z.infer<typeof registrationChallengeSchema>;
export type AuthenticationChallenge = z.infer<
  typeof authenticationChallengeSchema
>;
export type WebAuthnChallenge = z.infer<typeof webAuthnChallengeSchema>;
