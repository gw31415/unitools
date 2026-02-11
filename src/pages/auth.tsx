import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { hc } from "hono/client";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useState } from "react";
import { LoginForm } from "@/components/login-form";
import type { ServerAppType } from "@/server";
import { currentUserAtom } from "@/store";

const normalizeUserName = (value: string) => value.trim();

export default function AuthPage({ redirect }: { redirect?: string }) {
  const user = useAtomValue(currentUserAtom);
  const [userName, setUserName] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const client = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : hc<ServerAppType>(window.location.origin),
    [],
  );

  const handleLogin = useCallback(async () => {
    if (!client || authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const challengeRes = await client.api.v1.sessions["-"].$post({
        json: {},
      });
      if (!challengeRes.ok) {
        setAuthError("Login challenge failed.");
        return;
      }
      const { challenge } = await challengeRes.json();
      const response = await startAuthentication({
        optionsJSON: challenge.options,
      });
      const verifyRes = await client.api.v1.sessions["-"].challenge.$post({
        json: { challengeId: challenge.id, ...response },
      });
      if (!verifyRes.ok) {
        setAuthError("Login verification failed.");
        return;
      }
      if (redirect) {
        window.location.href = redirect;
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.error(error);
      setAuthError("Login failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, client, redirect]);

  const handleSignup = useCallback(async () => {
    if (!client || authBusy) return;
    const normalizedUserName = normalizeUserName(userName);
    if (!normalizedUserName) {
      setAuthError("Enter a username to sign up.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const signupRes = await client.api.v1.users.$post({
        json: { username: normalizedUserName, invitationCode },
      });
      if (!signupRes.ok) {
        const errorData = await signupRes.json().catch(() => null);
        if (signupRes.status === 409) {
          setAuthError("Username is already taken.");
        } else if (errorData?.error === "invalid_invitation_code") {
          setAuthError("Invalid invitation code. Please check and try again.");
        } else {
          setAuthError("Sign up failed.");
        }
        return;
      }
      const { challenge } = await signupRes.json();
      const response = await startRegistration({
        optionsJSON: challenge.options,
      });
      const verifyRes = await client.api.v1.users["-"].challenge.$post({
        json: { challengeId: challenge.id, ...response },
      });
      if (!verifyRes.ok) {
        setAuthError("Sign up verification failed.");
        return;
      }
      window.location.reload();
    } catch (error) {
      console.error(error);
      setAuthError("Sign up failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, client, userName, invitationCode]);

  const handleLogout = useCallback(async () => {
    if (!client || authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await client.api.v1.sessions["-"].$delete();
      if (!res.ok) {
        setAuthError("Logout failed. Please try again.");
        return;
      }
      window.location.reload();
    } catch (error) {
      console.error(error);
      setAuthError("Logout failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, client]);

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm
          user={user}
          userName={userName}
          onChangeUserName={setUserName}
          invitationCode={invitationCode}
          onChangeInvitationCode={setInvitationCode}
          onSignup={handleSignup}
          onLogin={handleLogin}
          onLogout={handleLogout}
          authBusy={authBusy}
          authError={authError}
        />
      </div>
    </div>
  );
}
