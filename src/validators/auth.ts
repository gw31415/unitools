import { sValidator } from "@hono/standard-validator";
import { z } from "zod";
import { sessionInitSchema, userPostSchema } from "@/models/auth";

export const signupValidator = sValidator(
  "json",
  userPostSchema.extend({ invitationCode: z.string().min(1).optional() }),
);
export const sessionInitValidator = sValidator("json", sessionInitSchema);

export const registrationWebAuthnSchema = z
  .object({
    challengeId: z.string().min(1),
  })
  .catchall(z.unknown());

export const authenticationWebAuthnSchema = z
  .object({
    challengeId: z.string().min(1),
  })
  .catchall(z.unknown());

export const registrationChallengeValidator = sValidator(
  "json",
  registrationWebAuthnSchema,
);
export const authenticationChallengeValidator = sValidator(
  "json",
  authenticationWebAuthnSchema,
);
