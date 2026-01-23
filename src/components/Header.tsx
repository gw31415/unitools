import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { SideMenuTrigger } from "./SideMenu";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

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
      <Logo className="fill-foreground py-1 h-full" />
      <div className="grow" />
      {loading ? <Spinner className="mx-1" /> : undefined}
    </header>
  );
}
