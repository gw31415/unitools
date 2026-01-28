import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { hc } from "hono/client";
import { PanelLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@/db/schema";
import type { ServerAppType } from "@/server";
import { Logo } from "./Logo";
import { SideMenuTrigger } from "./SideMenu";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

const normalizeUserName = (value: string) => value.trim();

function LoginButton(props: {
  onLogin: () => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <Button type="button" onClick={props.onLogin} disabled={props.disabled}>
      Passkey Login
    </Button>
  );
}

function SignupButton(props: {
  userName: string;
  onChangeUserName: (next: string) => void;
  onSignup: () => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <>
      <Input
        placeholder="new username"
        value={props.userName}
        onChange={(event) => props.onChangeUserName(event.target.value)}
        className="w-40"
        disabled={props.disabled}
      />
      <Button type="button" onClick={props.onSignup} disabled={props.disabled}>
        Sign Up
      </Button>
    </>
  );
}

function LogoutButton(props: { user: User; onLogout: () => Promise<void> }) {
  return (
    <Button type="button" onClick={props.onLogout}>
      Logout for {props.user.username}
    </Button>
  );
}

export function Header(props: { user: User | undefined }) {
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const client = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : hc<ServerAppType>(window.location.origin),
    [],
  );

  useEffect(() => {
    setLoading(false);
  }, []);

  const handleSignup = useCallback(async () => {
    if (!client || authBusy) return;
    const nextName = normalizeUserName(userName);
    if (!nextName) {
      setAuthError("Please enter a username.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await client.api.v1.users.$post({
        json: { username: nextName },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          body?.error === "username_unavailable"
            ? "That username is already taken."
            : "Signup failed. Please try again.";
        setAuthError(message);
        return;
      }
      const { challenge } = await res.json();
      const response = await startRegistration({
        optionsJSON: challenge.options,
      });
      const verifyRes = await client.api.v1.users["-"].challenge.$post({
        json: { challengeId: challenge.id, ...response },
      });
      if (!verifyRes.ok) {
        setAuthError("Could not verify signup.");
        return;
      }
      window.location.reload();
    } catch (error) {
      console.error(error);
      setAuthError("Signup failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, client, userName]);

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
      window.location.reload();
    } catch (error) {
      console.error(error);
      setAuthError("Login failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, client]);

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
    <header className="h-10 sticky flex items-center gap-2 px-2 py-1 border-b">
      <SideMenuTrigger asChild className="hidden md:flex">
        <Button size="icon" variant="ghost" aria-label="Open side menu">
          <PanelLeft />
        </Button>
      </SideMenuTrigger>
      {props.user ? (
        <LogoutButton user={props.user} onLogout={handleLogout} />
      ) : (
        <>
          <SignupButton
            userName={userName}
            onChangeUserName={setUserName}
            onSignup={handleSignup}
            disabled={authBusy}
          />
          <LoginButton onLogin={handleLogin} disabled={authBusy} />
          {authError ? (
            <span className="text-destructive text-xs">{authError}</span>
          ) : null}
        </>
      )}
      <Logo className="fill-foreground py-1 h-full" />
      <div className="grow" />
      {loading ? <Spinner className="mx-1" /> : undefined}
    </header>
  );
}
