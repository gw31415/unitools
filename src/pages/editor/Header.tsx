import { hc } from "hono/client";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react";
import { useState } from "react";
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
import { formatEditorLabel } from "@/lib/editorLabel";
import type { ServerAppType } from "@/server";
import { currentUserAtom, editorStateAtom } from "@/store";

const MAX_TITLE_LENGTH = 20;
const TITLE_DIALOG_ID = "title-dialog-8f3a2c7d";
const getClient = () =>
  typeof window === "undefined"
    ? null
    : hc<ServerAppType>(window.location.origin);

export function Header() {
  const user = useAtomValue(currentUserAtom);
  const editorState = useAtomValue(editorStateAtom);
  const [isCreating, setIsCreating] = useState(false);
  const [isTitleDialogOpen, setIsTitleDialogOpen] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);

  // Calculate display title from editor state
  const displayTitle = editorState.editorId
    ? formatEditorLabel({
        id: editorState.editorId,
        createdAt: editorState.createdAt ?? Number.NaN,
        title: editorState.title,
      })
    : "";

  const handleCreateEditor = async () => {
    const client = getClient();
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
  };

  const handleOpenChange = (open: boolean) => {
    setIsTitleDialogOpen(open);
    if (open) {
      setTitleInput(editorState.title ?? "");
      setTitleError(null);
    }
  };

  const handleSaveTitle = async () => {
    const client = getClient();
    if (!client || !editorState.editorId || !user || isSavingTitle) return;
    setIsSavingTitle(true);
    setTitleError(null);

    const nextTitle = titleInput.trim() || undefined;

    try {
      const res = await client.api.v1.editor[":id"].$patch({
        param: { id: editorState.editorId },
        json: { title: nextTitle },
      });

      if (!res.ok) {
        setTitleError("Failed to update title.");
        return;
      }
      // Reload the page to reflect the updated title
      window.location.reload();
    } catch (error) {
      console.error(error);
      setTitleError("Failed to update title.");
    } finally {
      setIsSavingTitle(false);
    }
  };

  const isDeleteAction = Boolean(editorState.title) && titleInput.trim() === "";
  const confirmLabel = isDeleteAction ? "Delete title" : "Save title";

  return (
    <header className="h-10 sticky flex items-center gap-2 px-2 py-1 border-b">
      <Dialog open={isTitleDialogOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild aria-controls={TITLE_DIALOG_ID}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-w-[min(60vw,24rem)] justify-start px-3 text-left"
            aria-label="Article title"
            aria-controls={TITLE_DIALOG_ID}
            disabled={!user || !editorState.editorId}
          >
            <span className="truncate">{displayTitle}</span>
          </Button>
        </DialogTrigger>
        <DialogContent id={TITLE_DIALOG_ID}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveTitle();
            }}
          >
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
        disabled={!user || isCreating}
        onClick={handleCreateEditor}
        aria-label="Create new article"
      >
        {isCreating ? <Spinner /> : user ? <Plus /> : undefined}
      </Button>
    </header>
  );
}
