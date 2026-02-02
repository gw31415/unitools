import { PanelLeft, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { SideMenuTrigger } from "@/components/SideMenu";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { User } from "@/db/schema";

export function Header({ user }: { user?: User }) {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  return (
    <header className="h-10 sticky flex items-center gap-2 px-2 py-1 border-b">
      <SideMenuTrigger asChild className="hidden md:flex">
        <Button size="icon" variant="ghost" aria-label="Open side menu">
          <PanelLeft />
        </Button>
      </SideMenuTrigger>
      <div className="grow" />
      <Button size="icon" variant="ghost" disabled={loading}>
        {loading ? <Spinner /> : user ? <Plus /> : undefined}
      </Button>
    </header>
  );
}
