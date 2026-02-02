import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { SideMenuTrigger } from "@/components/SideMenu";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function Header() {
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
      {loading ? <Spinner className="mx-1" /> : undefined}
    </header>
  );
}
