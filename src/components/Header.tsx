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

const AUTH_USERS_KEY = "unitools:authUsers";
const AUTH_LAST_USER_KEY = "unitools:lastUserName";

function readAuthUsers(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(AUTH_USERS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {}
  return {};
}

function writeAuthUsers(users: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

function LoginButton(props: {
  onLogin: () => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <Button type="button" onClick={props.onLogin} disabled={props.disabled}>
      Login
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
        placeholder="alice"
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
      Logout for {props.user.userName}
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(AUTH_LAST_USER_KEY);
    if (saved) {
      setUserName(saved);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(AUTH_LAST_USER_KEY, userName);
  }, [userName]);

  const handleSignup = useCallback(async () => {
    if (!client || authBusy) return;
    const nextName = userName.trim();
    if (!nextName) {
      setAuthError("Please enter a username.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await client.api.v1.auth.$post({
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
      const { options, userId } = await res.json();
      const response = await startRegistration({ optionsJSON: options });
      const verifyRes = await client.api.v1.auth[":userId"].verify.$post({
        param: { userId },
        json: { flow: "registration", ...response },
      });
      if (!verifyRes.ok) {
        setAuthError("Could not verify signup.");
        return;
      }
      const users = readAuthUsers();
      users[nextName] = userId;
      writeAuthUsers(users);
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
    const nextName = userName.trim();
    if (!nextName) {
      setAuthError("Please enter your username.");
      return;
    }
    const users = readAuthUsers();
    const userId = users[nextName];
    if (!userId) {
      setAuthError("No local account found for that username.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const challengeRes = await client.api.v1.auth[":userId"].challenge.$get({
        param: { userId },
      });
      if (!challengeRes.ok) {
        setAuthError("Login challenge failed.");
        return;
      }
      const options = await challengeRes.json();
      const response = await startAuthentication({ optionsJSON: options });
      const verifyRes = await client.api.v1.auth[":userId"].verify.$post({
        param: { userId },
        json: { flow: "authentication", ...response },
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
  }, [authBusy, client, userName]);

  const handleLogout = useCallback(async () => {
    if (!client || authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await client.api.v1.auth.session.$delete();
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
