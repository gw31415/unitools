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
import { env } from "hono/adapter";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import { passkeyCredentials, users } from "@/db/schema";
import { bytesToBase64 } from "@/lib/base64";
import { createApp, type Env } from "@/lib/hono";
import { type ULID, ulid } from "@/lib/ulid";
import type {
  PasskeyCredentialInsert,
  User,
  WebAuthnChallenge,
} from "@/models";
import {
  authenticationChallengeValidator,
  registrationChallengeValidator,
  sessionInitValidator,
  signupValidator,
  webAuthnChallengeSchema,
} from "@/validators/auth";

const PASSKEY_SESSION_COOKIE = "sid";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const SESSION_PREFIX = "session";

const sessionKey = (userId: string, sessionId: string) =>
  `${userSessionPrefix(userId)}:${sessionId}`;
const userSessionPrefix = (userId: string) => `${SESSION_PREFIX}:${userId}:`;

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

async function loadSessionFromRequest<EnvExtended extends Env>(
  c: Context<EnvExtended>,
): Promise<{
  user: User;
  sessionId: string;
} | null> {
  const sessionToken = getCookie(c, PASSKEY_SESSION_COOKIE);

  if (!sessionToken) {
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return null;
  }

  const [userId, sessionId, secret] = sessionToken.split(":");
  if (!userId || !sessionId || !secret) {
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return null;
  }

  const record = await c.env.AUTH_KV.get<{ user: User; secret: string }>(
    sessionKey(userId, sessionId),
    "json",
  );
  if (!record || record.secret !== secret || record.user.id !== userId) {
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return null;
  }

  return { user: record.user, sessionId };
}

const deleteUserSessionsFromKv = async (
  kv: CloudflareBindings["AUTH_KV"],
  userId: string,
) => {
  const prefix = userSessionPrefix(userId);
  let cursor: string | undefined;
  for (;;) {
    const result = await kv.list({ prefix, cursor });
    if (result.keys.length > 0) {
      await Promise.all(
        result.keys.map(async (key) => {
          await kv.delete(key.name);
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
    userId: string;
  };
}> = async (c, next) => {
  const session = await loadSessionFromRequest(c);
  if (!session) {
    return c.json({ authenticated: false }, 401);
  }

  c.set("sessionId", session.sessionId);
  c.set("userId", session.user.id);
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
  c: Context<Env>,
  user: User,
  sessionId: ULID,
  sessionSecret: string,
) {
  const sessionRecord = { user, secret: sessionSecret };
  await c.env.AUTH_KV.put(
    sessionKey(user.id, sessionId),
    JSON.stringify(sessionRecord),
    {
      expirationTtl: SESSION_TTL_SECONDS,
    },
  );
  setCookie(
    c,
    PASSKEY_SESSION_COOKIE,
    `${user.id}:${sessionId}:${sessionSecret}`,
    getRpConfig(c).toCookieOptions(),
  );
}

/**
 * 招待コードの検証と使用済み管理を行う
 *
 * 仕組み:
 * 1. INVITATION_CODES環境変数のハッシュ(SHA-256)をキーとしてKVに未使用コード一覧を保存
 * 2. 初回は全コードが未使用リストに含まれる
 * 3. 使用されたコードはリストから削除され、再利用を防止
 * 4. 環境変数が変更されるとハッシュが変わり、古いKVエントリーを削除してリセット
 */
async function isValidInvitation(
  c: Context<Env>,
  code: string | undefined,
): Promise<boolean> {
  if (!code) return false;
  const { INVITATION_CODES } = env<{ INVITATION_CODES?: string }>(c);
  if (!INVITATION_CODES || INVITATION_CODES.length === 0) {
    return false;
  }
  const invitationCodes = INVITATION_CODES.split(/\s+/g);

  // Create hash from INVITATION_CODES to detect changes
  const data = new TextEncoder().encode(INVITATION_CODES);
  const hash = bytesToBase64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
  );

  // Clean up old KV entries from previous INVITATION_CODES versions
  const prefix = "invitationCodes:env:";
  const prefixWithHash = `${prefix}${hash}`;
  let cursor: string | undefined;
  for (;;) {
    const result = await c.env.AUTH_KV.list({ prefix, cursor });
    for (const key of result.keys) {
      // Delete entries that don't match current hash
      if (key.name !== prefixWithHash) {
        await c.env.AUTH_KV.delete(key.name);
      }
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }

  const unused = new Set(
    (await c.env.AUTH_KV.get<string[]>(prefixWithHash, "json")) ??
      invitationCodes,
  );

  const ok = unused.delete(code);
  if (ok) {
    await c.env.AUTH_KV.put(prefixWithHash, JSON.stringify([...unused]));
  }
  return ok;
}

export const usersApi = createApp()
  // サインアップ
  .post("/", signupValidator, async (c) => {
    const { username, invitationCode } = c.req.valid("json");

    // Verify invitation code from environment variable
    if (!(await isValidInvitation(c, invitationCode))) {
      return c.json({ error: "invalid_invitation_code" as const }, 400);
    }

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
      } satisfies PasskeyCredentialInsert)
      .returning();

    await c.env.AUTH_KV.delete(`webauthn:challenge:${payload.challengeId}`);

    const sessionId = ulid();
    const sessionSecret = createSessionSecret();
    await createSession(c, user, sessionId, sessionSecret);

    return c.body(null, 204);
  })
  .delete("/-", requireUser, async (c) => {
    const user = c.get("user");
    const db = drizzle(c.env.DB);

    // Delete user from database (cascade handles passkeyCredentials)
    await db.delete(users).where(eq(users.id, user.id));

    // Clean up all sessions from KV
    await deleteUserSessionsFromKv(c.env.AUTH_KV, user.id);

    // Delete session cookie
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });

    return c.body(null, 204);
  });

export const sessionsApi = createApp()
  // ログイン（チャレンジ生成）
  .post("/-", sessionInitValidator, async (c) => {
    const { id: requestedSessionId, userId: requestedUserId } =
      c.req.valid("json");
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

    let userId: ULID | undefined;
    if (requestedSessionId) {
      if (!requestedUserId) {
        return c.json({ error: "user_id_required" }, 400);
      }
      const sessionRecord = await c.env.AUTH_KV.get<{
        user: User;
        secret: string;
      }>(sessionKey(requestedUserId, requestedSessionId), "json");
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
    const userId = c.get("userId");
    await c.env.AUTH_KV.delete(sessionKey(userId, sessionId));
    deleteCookie(c, PASSKEY_SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });
