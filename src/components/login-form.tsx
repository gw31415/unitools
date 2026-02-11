import { GalleryVerticalEnd } from "lucide-react";
import type { ComponentProps, FormEvent } from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { User } from "@/models";

type LoginFormProps = ComponentProps<"div"> & {
  user?: User;
  onSignup: (username: string, invitationCode: string) => Promise<void>;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  authBusy?: boolean;
  authError?: string | null;
};

type SignUpFormItemsProps = {
  onSignup: (username: string, invitationCode: string) => Promise<void>;
  disabled?: boolean;
};

function SignUpFormItems({ onSignup, disabled }: SignUpFormItemsProps) {
  const usernameRef = useRef<HTMLInputElement>(null);
  const invitationCodeRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const username = usernameRef.current?.value ?? "";
    const invitationCode = invitationCodeRef.current?.value ?? "";
    await onSignup(username, invitationCode);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-7">
      <Field>
        <FieldLabel htmlFor="username">Username</FieldLabel>
        <Input
          ref={usernameRef}
          id="username"
          type="text"
          placeholder="alice_123"
          autoComplete="off"
          disabled={disabled}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="invitation-code">Invitation Code</FieldLabel>
        <Input
          ref={invitationCodeRef}
          id="invitation-code"
          placeholder="Enter your invitation code"
          autoComplete="off"
          className="font-mono"
          disabled={disabled}
          required
        />
      </Field>
      <Field>
        <Button type="submit" disabled={disabled}>
          Sign Up
        </Button>
      </Field>
    </form>
  );
}

export function LoginForm({
  className,
  user,
  onSignup,
  onLogin,
  onLogout,
  authBusy,
  authError,
  ...props
}: LoginFormProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-2 text-center">
          <a href="/" className="flex flex-col items-center gap-2 font-medium">
            <div className="flex size-8 items-center justify-center rounded-md">
              <GalleryVerticalEnd className="size-6" />
            </div>
          </a>
          <h1 className="text-xl font-bold">Welcome to Unitools</h1>
          <FieldDescription>
            Login / Sign up with WebAuthn to continue
          </FieldDescription>
        </div>
        {user ? (
          <>
            <FieldDescription className="text-center">
              You are logged in as {user.username}.
            </FieldDescription>
            <Field className="flex justify-center">
              <Button type="button" onClick={onLogout} disabled={authBusy}>
                Logout
              </Button>
            </Field>
          </>
        ) : (
          <>
            <SignUpFormItems onSignup={onSignup} disabled={authBusy} />
            <FieldSeparator>Or</FieldSeparator>
            <Field className="flex gap-4">
              <Button
                variant="outline"
                type="button"
                onClick={onLogin}
                disabled={authBusy}
              >
                Login
              </Button>
            </Field>
          </>
        )}
        {authError ? (
          <FieldDescription className="text-destructive text-sm text-center">
            {authError}
          </FieldDescription>
        ) : null}
      </FieldGroup>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <a href="/terms">Terms of Service</a> and{" "}
        <a href="/privacy">Privacy Policy</a>.
      </FieldDescription>
    </div>
  );
}
