import { hc } from "hono/client";
import { PanelLeft, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SideMenuTrigger } from "@/components/SideMenu";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { User } from "@/models";
import type { ServerAppType } from "@/server";

export function Header({ user }: { user?: User }) {
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

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

  const handleCreateEditor = useCallback(async () => {
    if (!client || !user || isCreating) return;
    setIsCreating(true);

    try {
      const res = await client.api.v1.editor.$post();

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

  return (
    <header className="h-10 sticky flex items-center gap-2 px-2 py-1 border-b">
      <SideMenuTrigger asChild className="hidden md:flex">
        <Button size="icon" variant="ghost" aria-label="Open side menu">
          <PanelLeft />
        </Button>
      </SideMenuTrigger>
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
