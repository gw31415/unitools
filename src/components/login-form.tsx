import { GalleryVerticalEnd } from "lucide-react";
import type { ComponentProps } from "react";
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
  userName: string;
  onChangeUserName: (next: string) => void;
  onSignup: () => Promise<void>;
  onLogin: () => Promise<void>;
  onLogout: () => Promise<void>;
  authBusy?: boolean;
  authError?: string | null;
};

type SignUpFormItemsProps = {
  userName: string;
  onChangeUserName: (next: string) => void;
  onSignup: () => Promise<void>;
  disabled?: boolean;
};

function SignUpFormItems({
  userName,
  onChangeUserName,
  onSignup,
  disabled,
}: SignUpFormItemsProps) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="username">Username</FieldLabel>
        <Input
          id="username"
          type="text"
          placeholder="alice_123"
          value={userName}
          onChange={(event) => onChangeUserName(event.target.value)}
          disabled={disabled}
          required
        />
      </Field>
      <Field>
        <Button type="button" onClick={onSignup} disabled={disabled}>
          Sign Up
        </Button>
      </Field>
    </>
  );
}

export function LoginForm({
  className,
  user,
  userName,
  onChangeUserName,
  onSignup,
  onLogin,
  onLogout,
  authBusy,
  authError,
  ...props
}: LoginFormProps) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <a
              href="/"
              className="flex flex-col items-center gap-2 font-medium"
            >
              <div className="flex size-8 items-center justify-center rounded-md">
                <GalleryVerticalEnd className="size-6" />
              </div>
              <span className="sr-only">Acme Inc.</span>
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
              <SignUpFormItems
                userName={userName}
                onChangeUserName={onChangeUserName}
                onSignup={onSignup}
                disabled={authBusy}
              />
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
      </form>
      <FieldDescription className="px-6 text-center">
        By clicking continue, you agree to our{" "}
        <a href="/terms">Terms of Service</a> and{" "}
        <a href="/privacy">Privacy Policy</a>.
      </FieldDescription>
    </div>
  );
}
