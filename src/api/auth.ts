import { sValidator } from "@hono/standard-validator";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL, isoUint8Array } from "@simplewebauthn/server/helpers";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { ulid } from "ulid";
import { z } from "zod";
import { passkeyCredentials, type User, users } from "@/db/schema";
import { createApp } from "@/lib/hono";

const PASSKEY_SESSION_COOKIE = "sid";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

interface AuthenticationChallenge {
  userId: string;
  challenge: string;
}

interface RegistrationChallenge extends AuthenticationChallenge {
  userName: string;
}

type WebAuthnJSON =
  | ({ flow: "registration" } & RegistrationResponseJSON)
  | ({ flow: "authentication" } & AuthenticationResponseJSON);

type WebAuthnChallenge =
  | ({ flow: "registration" } & RegistrationChallenge)
  | ({ flow: "authentication" } & AuthenticationChallenge);

function getRpConfig(c: Context) {
  const url = new URL(c.req.url);
  return {
    rpID: url.hostname,
    rpName: "Unitools",
    expectedOrigin: url.origin,
    isSecure: url.protocol === "https:",
    toCookieOptions(): CookieOptions {
      return {
        httpOnly: true,
        sameSite: "Lax",
        secure: this.isSecure,
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      };
    },
  };
}

const signupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
});

const verifyParamsSchema = z.object({
  userId: z.string().min(1),
});

const webAuthnSchema = z
  .object({
    flow: z.enum(["registration", "authentication"]),
  })
  .catchall(z.unknown());

async function loadSessionFromRequest<
  Env extends { Bindings: CloudflareBindings },
>(
  c: Context<Env>,
): Promise<{
  user: User;
  sid: string;
} | null> {
  const sid = getCookie(c, PASSKEY_SESSION_COOKIE);

  // Check for invalid cookie format
  if (!sid?.includes(":")) return null;

  if (!sid) {
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return null;
  }

  const record = await c.env.AUTH_KV.get<{ user: User }>(`sid:${sid}`, "json");
  if (!record) {
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return null;
  }

  return { ...record, sid };
}

export const deleteUserSessionsFromKv = async (
  kv: CloudflareBindings["AUTH_KV"],
  userId: string,
) => {
  const prefix = `sid:${userId}:`;
  let cursor: string | undefined;
  for (;;) {
    const result = await kv.list({ prefix, cursor });
    if (result.keys.length > 0) {
      await Promise.all(result.keys.map((key) => kv.delete(key.name)));
    }
    if (result.list_complete) {
      break;
    }
    cursor = result.cursor;
  }
};

export const useUser: MiddlewareHandler<{
  Bindings: CloudflareBindings;
  Variables: { user: User | undefined };
}> = async (c, next) => {
  const session = await loadSessionFromRequest(c);
  if (session) {
    c.set("user", session.user);
  }
  await next();
};

export const requireUser: MiddlewareHandler<{
  Bindings: CloudflareBindings;
  Variables: { user: User };
}> = async (c, next) => {
  const session = await loadSessionFromRequest(c);
  if (!session) {
    return c.json({ authenticated: false }, 401);
  }

  c.set("user", session.user);
  await next();
};

const requireSid: MiddlewareHandler<{
  Bindings: CloudflareBindings;
  Variables: {
    sid: string;
  };
}> = async (c, next) => {
  const session = await loadSessionFromRequest(c);
  if (!session) {
    return c.json({ authenticated: false }, 401);
  }

  c.set("sid", session.sid);
  await next();
};

const auth = createApp()
  // サインアップ
  .post("/", sValidator("json", signupSchema), async (c) => {
    const { username: userName } = c.req.valid("json");

    const db = drizzle(c.env.DB);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.userName, userName))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ error: "username_unavailable" as const }, 409);
    }

    const userId = ulid();
    const { rpID, rpName } = getRpConfig(c);

    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      userID: isoUint8Array.fromUTF8String(userId),
      userName,
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
    });
    const registrationChallenge: WebAuthnChallenge = {
      flow: "registration",
      userId,
      userName,
      challenge: options.challenge,
    };
    await c.env.AUTH_KV.put(
      `webauthn:${userId}`,
      JSON.stringify(registrationChallenge),
      {
        expirationTtl: options.timeout ?? 60000,
      },
    );

    return c.json({ options, userId }, 200);
  })
  // サインアップ/ログインの検証
  .post(
    "/:userId/verify",
    sValidator("param", verifyParamsSchema),
    sValidator("json", webAuthnSchema),
    async (c) => {
      const { userId } = c.req.valid("param");
      const body = c.req.valid("json") as unknown as WebAuthnJSON;

      const challengeRecord = await c.env.AUTH_KV.get<WebAuthnChallenge>(
        `webauthn:${userId}`,
        "json",
      );

      if (!challengeRecord) {
        return c.json({ error: "challenge_not_found" }, 400);
      }

      const { rpID, expectedOrigin } = getRpConfig(c);
      if (body.flow === "registration") {
        if (challengeRecord.flow !== "registration") {
          return c.json({ error: "challenge_not_found" }, 400);
        }

        const { flow, ...response } = body;
        let verification: VerifiedRegistrationResponse;
        try {
          verification = await verifyRegistrationResponse({
            response,
            expectedChallenge: challengeRecord.challenge,
            expectedOrigin,
            expectedRPID: rpID,
          });
          if (!verification.verified || !verification.registrationInfo)
            throw undefined;
        } catch (error) {
          if (error !== undefined) console.error(error);
          return c.json({ error: "registration_failed" }, 400);
        }

        const { credential } = verification.registrationInfo;
        const publicKey = isoBase64URL.fromBuffer(credential.publicKey);
        const transports = credential.transports;

        const db = drizzle(c.env.DB);
        const existingUser = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.userName, challengeRecord.userName))
          .limit(1);
        if (existingUser.length > 0) {
          return c.json({ error: "username_unavailable" }, 409);
        }
        await db.insert(users).values({
          id: challengeRecord.userId,
          userName: challengeRecord.userName,
        });
        await db.insert(passkeyCredentials).values({
          id: credential.id,
          userId: challengeRecord.userId,
          publicKey,
          counter: credential.counter,
          transports,
        });

        await c.env.AUTH_KV.delete(`webauthn:${userId}`);

        return c.body(null, 204);
      }

      if (challengeRecord.flow !== "authentication") {
        return c.json({ error: "challenge_not_found" }, 400);
      }

      const { flow, ...response } = body;
      const db = drizzle(c.env.DB);
      const credentialRows = await db
        .select()
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.id, response.id))
        .limit(1);
      const storedCredential = credentialRows[0];

      if (!storedCredential || storedCredential.userId !== userId) {
        return c.json({ error: "credential_not_found" }, 404);
      }

      let verification: VerifiedAuthenticationResponse;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge: challengeRecord.challenge,
          expectedOrigin,
          expectedRPID: rpID,
          credential: {
            id: storedCredential.id,
            publicKey: new Uint8Array(
              isoBase64URL.toBuffer(storedCredential.publicKey),
            ),
            counter: storedCredential.counter,
            transports: storedCredential.transports ?? undefined,
          },
        });

        if (!verification.verified) throw undefined;
      } catch (error) {
        if (error !== undefined) console.error(error);
        return c.json({ error: "authentication_failed" }, 401);
      }

      await db
        .update(passkeyCredentials)
        .set({ counter: verification.authenticationInfo.newCounter })
        .where(eq(passkeyCredentials.id, storedCredential.id));

      await c.env.AUTH_KV.delete(`webauthn:${userId}`);

      const sessionToken = crypto.randomUUID();
      const user = (
        await db.select().from(users).where(eq(users.id, userId)).limit(1)
      )[0];

      const sid = `${userId}:${sessionToken}`;
      const sessionRecord = { user };
      await c.env.AUTH_KV.put(`sid:${sid}`, JSON.stringify(sessionRecord), {
        expirationTtl: SESSION_TTL_SECONDS,
      });
      setCookie(
        c,
        PASSKEY_SESSION_COOKIE,
        sid,
        getRpConfig(c).toCookieOptions(),
      );

      return c.body(null, 204);
    },
  )
  // ログインチャレンジの生成
  .get("/:userId/challenge", async (c) => {
    const userId = c.req.param("userId");

    const db = drizzle(c.env.DB);

    const credentials = await db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, userId));

    const { rpID } = getRpConfig(c);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials: credentials.map((credential) => ({
        id: credential.id,
        transports: credential.transports ?? undefined,
      })),
    });

    if (credentials.length > 0) {
      const authenticationChallenge: WebAuthnChallenge = {
        flow: "authentication",
        userId,
        challenge: options.challenge,
      };
      await c.env.AUTH_KV.put(
        `webauthn:${userId}`,
        JSON.stringify(authenticationChallenge),
        { expirationTtl: options.timeout ?? 60000 },
      );
    }

    return c.json(options, 200);
  })
  .delete("/session", requireSid, async (c) => {
    const sid = c.get("sid");
    await c.env.AUTH_KV.delete(`sid:${sid}`);
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

export default auth;
