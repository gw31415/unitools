import { hc } from "hono/client";
import { Plus } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { User } from "@/models";
import type { ServerAppType } from "@/server";

const MAX_TITLE_LENGTH = 20;
type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<"form">["onSubmit"]>
>[0];

export function Header({
  user,
  title,
  fallbackTitle,
  editorId,
  initialTitle,
}: {
  user?: User;
  title: string;
  fallbackTitle: string;
  editorId?: string;
  initialTitle?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isTitleDialogOpen, setIsTitleDialogOpen] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState<string | undefined>(
    initialTitle?.trim() || undefined,
  );
  const [displayTitle, setDisplayTitle] = useState(title);

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
    setCurrentTitle(initialTitle?.trim() || undefined);
    setDisplayTitle(title);
  }, [initialTitle, title]);

  const handleCreateEditor = useCallback(async () => {
    if (!client || !user || isCreating) return;
    setIsCreating(true);

    try {
      const res = await client.api.v1.editor.$post({
        json: {
          title: "",
        },
      });

      if (!res.ok) {
        console.error("Failed to create new article");
        return;
      }

      const newEditor = await res.json();

      // Navigate to the new editor
      window.location.href = `/editor/${newEditor.id}`;
    } catch (fetchError) {
      console.error(fetchError);
    } finally {
      setIsCreating(false);
    }
  }, [client, user, isCreating]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsTitleDialogOpen(open);
      if (open) {
        setTitleInput(currentTitle ?? "");
        setTitleError(null);
      }
    },
    [currentTitle],
  );

  const handleSaveTitle = useCallback(async () => {
    if (!client || !editorId || !user || isSavingTitle) return;
    setIsSavingTitle(true);
    setTitleError(null);

    const normalizedTitle = titleInput.trim();
    const nextTitle = normalizedTitle || undefined;

    try {
      const res = await client.api.v1.editor[":id"].$patch({
        param: { id: editorId },
        json: { title: nextTitle },
      });

      if (!res.ok) {
        setTitleError("Failed to update title.");
        return;
      }

      setCurrentTitle(nextTitle);
      setDisplayTitle(nextTitle ?? fallbackTitle);
      setIsTitleDialogOpen(false);
    } catch (error) {
      console.error(error);
      setTitleError("Failed to update title.");
    } finally {
      setIsSavingTitle(false);
    }
  }, [client, editorId, fallbackTitle, isSavingTitle, titleInput, user]);

  const isDeleteAction = Boolean(currentTitle) && titleInput.trim() === "";
  const confirmLabel = isDeleteAction ? "Delete title" : "Save title";
  const handleSubmit = useCallback(
    (event: FormSubmitEvent) => {
      event.preventDefault();
      void handleSaveTitle();
    },
    [handleSaveTitle],
  );

  return (
    <header className="h-10 sticky flex items-center gap-2 px-2 py-1 border-b">
      <Dialog open={isTitleDialogOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-w-[min(60vw,24rem)] justify-start px-3 text-left"
            aria-label="Article title"
            disabled={!user || !editorId}
          >
            <span className="truncate">{displayTitle}</span>
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Edit title</DialogTitle>
              <DialogDescription>
                Title can be up to {MAX_TITLE_LENGTH} characters.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-2">
              <Input
                value={titleInput}
                onChange={(event) => setTitleInput(event.target.value)}
                maxLength={MAX_TITLE_LENGTH}
                placeholder="Untitled"
                autoFocus
              />
              {titleError ? (
                <p className="text-sm text-destructive">{titleError}</p>
              ) : null}
            </div>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsTitleDialogOpen(false)}
                disabled={isSavingTitle}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSavingTitle}>
                {confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <div className="grow" />
      <Button
        size="icon"
        variant="ghost"
        disabled={loading || !user || isCreating}
        onClick={handleCreateEditor}
        aria-label="Create new article"
      >
        {isCreating ? <Spinner /> : user ? <Plus /> : undefined}
      </Button>
    </header>
  );
}
