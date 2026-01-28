import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
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
import { passkeyCredentials, type User, users } from "@/db/schema";
import { createApp } from "@/lib/hono";
import { type WebAuthnChallenge, webAuthnChallengeSchema } from "@/models/auth";
import {
  authenticationChallengeValidator,
  registrationChallengeValidator,
  sessionInitValidator,
  signupValidator,
} from "@/validators/auth";

const PASSKEY_SESSION_COOKIE = "sid";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const SESSION_HINT_TTL_SECONDS = 60 * 60 * 24 * 7;

interface RegistrationWebAuthnJSON extends RegistrationResponseJSON {
  challengeId: string;
}

interface AuthenticationWebAuthnJSON extends AuthenticationResponseJSON {
  challengeId: string;
}

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

async function loadSessionFromRequest<
  Env extends { Bindings: CloudflareBindings },
>(
  c: Context<Env>,
): Promise<{
  user: User;
  sessionId: string;
} | null> {
  const sessionToken = getCookie(c, PASSKEY_SESSION_COOKIE);

  // Check for invalid cookie format
  if (!sessionToken?.includes(":")) return null;

  if (!sessionToken) {
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return null;
  }

  const [sessionId, secret] = sessionToken.split(":");
  if (!sessionId || !secret) {
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return null;
  }

  const record = await c.env.AUTH_KV.get<{ user: User; secret: string }>(
    `session:${sessionId}`,
    "json",
  );
  if (!record || record.secret !== secret) {
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return null;
  }

  return { user: record.user, sessionId };
}

export const deleteUserSessionsFromKv = async (
  kv: CloudflareBindings["AUTH_KV"],
  userId: string,
) => {
  const prefix = `user-session:${userId}:`;
  let cursor: string | undefined;
  for (;;) {
    const result = await kv.list({ prefix, cursor });
    if (result.keys.length > 0) {
      await Promise.all(
        result.keys.map(async (key) => {
          const sessionId = key.name.replace(prefix, "");
          await kv.delete(key.name);
          await kv.delete(`session:${sessionId}`);
        }),
      );
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
    sessionId: string;
  };
}> = async (c, next) => {
  const session = await loadSessionFromRequest(c);
  if (!session) {
    return c.json({ authenticated: false }, 401);
  }

  c.set("sessionId", session.sessionId);
  await next();
};

function createSessionSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return isoBase64URL.fromBuffer(bytes);
}

function toWebAuthnResponseJSON<T extends RegistrationWebAuthnJSON>(
  payload: T,
) {
  const response = { ...payload } satisfies RegistrationResponseJSON;
  delete (response as Partial<T>).challengeId;
  return response;
}

function toWebAuthnAuthenticationJSON<T extends AuthenticationWebAuthnJSON>(
  payload: T,
) {
  const response = { ...payload } satisfies AuthenticationResponseJSON;
  delete (response as Partial<T>).challengeId;
  return response;
}

async function createSession(
  c: Context<{ Bindings: CloudflareBindings }>,
  user: User,
  sessionId: string,
  sessionSecret: string,
) {
  const sessionRecord = { user, secret: sessionSecret };
  await c.env.AUTH_KV.put(
    `session:${sessionId}`,
    JSON.stringify(sessionRecord),
    {
      expirationTtl: SESSION_TTL_SECONDS,
    },
  );
  await c.env.AUTH_KV.put(
    `user-session:${user.id}:${sessionId}`,
    JSON.stringify({ sessionId }),
    {
      expirationTtl: SESSION_HINT_TTL_SECONDS,
    },
  );
  setCookie(
    c,
    PASSKEY_SESSION_COOKIE,
    `${sessionId}:${sessionSecret}`,
    getRpConfig(c).toCookieOptions(),
  );
}

export const usersApi = createApp()
  // サインアップ
  .post("/", signupValidator, async (c) => {
    const { username } = c.req.valid("json");

    const db = drizzle(c.env.DB);
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ error: "username_unavailable" as const }, 409);
    }

    const userId = ulid();
    const challengeId = crypto.randomUUID();
    const { rpID, rpName } = getRpConfig(c);

    const options = await generateRegistrationOptions({
      rpID,
      rpName,
      userID: isoUint8Array.fromUTF8String(userId),
      userName: username,
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "preferred",
      },
    });
    const registrationChallenge: WebAuthnChallenge = {
      flow: "registration",
      userId,
      username,
      challenge: options.challenge,
    };

    await c.env.AUTH_KV.put(
      `webauthn:challenge:${challengeId}`,
      JSON.stringify(registrationChallenge),
      {
        expirationTtl: options.timeout ?? 60000,
      },
    );

    return c.json(
      {
        id: userId,
        username,
        challenge: { id: challengeId, options },
      },
      200,
    );
  })
  // サインアップチャレンジの検証
  .post("/-/challenge", registrationChallengeValidator, async (c) => {
    const payload = c.req.valid("json") as unknown as RegistrationWebAuthnJSON;
    const rawChallengeRecord = await c.env.AUTH_KV.get<WebAuthnChallenge>(
      `webauthn:challenge:${payload.challengeId}`,
      "json",
    );

    const parsed = webAuthnChallengeSchema.safeParse(rawChallengeRecord);
    if (!parsed.success || parsed.data.flow !== "registration") {
      return c.json({ error: "challenge_not_found" }, 400);
    }
    const challengeRecord = parsed.data;

    const { rpID, expectedOrigin } = getRpConfig(c);
    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: toWebAuthnResponseJSON(payload),
        expectedChallenge: challengeRecord.challenge,
        expectedOrigin,
        expectedRPID: rpID,
      });
      if (!verification.verified || !verification.registrationInfo) {
        throw undefined;
      }
    } catch (error) {
      if (error !== undefined) console.error(error);
      return c.json({ error: "registration_failed" }, 400);
    }

    const db = drizzle(c.env.DB);
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, challengeRecord.username))
      .limit(1);
    if (existingUser.length > 0) {
      return c.json({ error: "username_unavailable" }, 409);
    }

    const { credential } = verification.registrationInfo;
    const publicKey = isoBase64URL.fromBuffer(credential.publicKey);
    const transports = credential.transports;

    const [user] = await db
      .insert(users)
      .values({
        id: challengeRecord.userId,
        username: challengeRecord.username,
      })
      .returning();

    await db
      .insert(passkeyCredentials)
      .values({
        id: credential.id,
        userId: challengeRecord.userId,
        publicKey,
        counter: credential.counter,
        transports,
      })
      .returning();

    await c.env.AUTH_KV.delete(`webauthn:challenge:${payload.challengeId}`);

    const sessionId = ulid();
    const sessionSecret = createSessionSecret();
    await createSession(c, user, sessionId, sessionSecret);

    return c.body(null, 204);
  });

export const sessionsApi = createApp()
  // ログイン（チャレンジ生成）
  .post("/-", sessionInitValidator, async (c) => {
    const { id: requestedSessionId } = c.req.valid("json");
    const { rpID } = getRpConfig(c);
    const challengeId = crypto.randomUUID();
    const sessionId = requestedSessionId ?? ulid();
    const sessionSecret = createSessionSecret();

    let allowCredentials:
      | {
          id: string;
          type: "public-key";
          transports?: AuthenticatorTransportFuture[];
        }[]
      | undefined;

    let userId: string | undefined;
    if (requestedSessionId) {
      const sessionRecord = await c.env.AUTH_KV.get<{
        user: User;
        secret: string;
      }>(`session:${requestedSessionId}`, "json");
      if (!sessionRecord) {
        return c.json({ error: "session_not_found" }, 404);
      }
      userId = sessionRecord.user.id;
      const db = drizzle(c.env.DB);
      const credentials = await db
        .select({
          id: passkeyCredentials.id,
          transports: passkeyCredentials.transports,
        })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.userId, userId));
      allowCredentials = credentials.map((credential) => ({
        id: credential.id,
        type: "public-key" as const,
        transports: credential.transports ?? undefined,
      }));
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials,
    });

    const authenticationChallenge: WebAuthnChallenge = {
      flow: "authentication",
      challenge: options.challenge,
      sessionId,
      sessionSecret,
      userId,
    };
    await c.env.AUTH_KV.put(
      `webauthn:challenge:${challengeId}`,
      JSON.stringify(authenticationChallenge),
      { expirationTtl: options.timeout ?? 60000 },
    );

    return c.json(
      {
        id: sessionId,
        secret: sessionSecret,
        challenge: { id: challengeId, options },
      },
      200,
    );
  })
  // ログイン検証
  .post("/-/challenge", authenticationChallengeValidator, async (c) => {
    const payload = c.req.valid(
      "json",
    ) as unknown as AuthenticationWebAuthnJSON;
    const rawChallengeRecord = await c.env.AUTH_KV.get<WebAuthnChallenge>(
      `webauthn:challenge:${payload.challengeId}`,
      "json",
    );

    const parsed = webAuthnChallengeSchema.safeParse(rawChallengeRecord);
    if (!parsed.success || parsed.data.flow !== "authentication") {
      return c.json({ error: "challenge_not_found" }, 400);
    }
    const challengeRecord = parsed.data;

    const { rpID, expectedOrigin } = getRpConfig(c);
    const db = drizzle(c.env.DB);

    const [storedCredential] = await db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.id, payload.id))
      .limit(1);

    if (!storedCredential) {
      return c.json({ error: "credential_not_found" }, 404);
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: toWebAuthnAuthenticationJSON(payload),
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

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, storedCredential.userId))
      .limit(1);
    if (!user) {
      return c.json({ error: "user_not_found" }, 404);
    }

    await c.env.AUTH_KV.delete(`webauthn:challenge:${payload.challengeId}`);

    await createSession(
      c,
      user,
      challengeRecord.sessionId,
      challengeRecord.sessionSecret,
    );

    return c.body(null, 204);
  })
  .delete("/-", requireSid, async (c) => {
    const sessionId = c.get("sessionId");
    await c.env.AUTH_KV.delete(`session:${sessionId}`);
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });
