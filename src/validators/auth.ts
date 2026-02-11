import { sValidator } from "@hono/standard-validator";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { passkeyCredentials, users } from "@/db/schema";
import { ulidSchema } from ".";

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_-]+$/);

const userPostSchema = createInsertSchema(users, {
  username: usernameSchema,
}).omit({ id: true, createdAt: true });

export const userGetSchema = createSelectSchema(users, {
  id: ulidSchema,
  username: usernameSchema,
});

export const passkeyCredentialInsertSchema = createInsertSchema(
  passkeyCredentials,
  {
    userId: ulidSchema,
  },
).omit({
  createdAt: true,
});

export const passkeyCredentialSelectSchema = createSelectSchema(
  passkeyCredentials,
  {
    id: ulidSchema,
    userId: ulidSchema,
  },
);

export const sessionInitSchema = z
  .object({
    id: ulidSchema.optional(),
    userId: ulidSchema.optional(),
  })
  .refine((data) => !data.id || !!data.userId, {
    message: "user_id_required",
    path: ["userId"],
  });

const registrationChallengeSchema = z.object({
  flow: z.literal("registration"),
  challenge: z.string().min(1),
  userId: ulidSchema,
  username: usernameSchema,
});

const authenticationChallengeSchema = z.object({
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

export const signupValidator = sValidator(
  "json",
  userPostSchema.extend({ invitationCode: z.string().min(1).optional() }),
);
export const sessionInitValidator = sValidator("json", sessionInitSchema);

export const registrationChallengeValidator = sValidator(
  "json",
  z
    .object({
      challengeId: z.string().min(1),
    })
    .catchall(z.unknown()),
);
export const authenticationChallengeValidator = sValidator(
  "json",
  z
    .object({
      challengeId: z.string().min(1),
    })
    .catchall(z.unknown()),
);
