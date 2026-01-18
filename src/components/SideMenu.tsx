import { Slot } from "@radix-ui/react-slot";
import type { ComponentProps, ReactNode } from "react";
import { Children, isValidElement } from "react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function SideMenu(props: { children?: ReactNode; className?: string }) {
  const { openMobile, setOpenMobile, isMobile } = useSidebar();
  const menuLayout = (
    <SidebarContent className={props.className}>
      {props.children}
    </SidebarContent>
  );

  return (
    <>
      <Drawer direction="bottom" open={openMobile} onOpenChange={setOpenMobile}>
        <DrawerContent className="md:hidden">{menuLayout}</DrawerContent>
      </Drawer>
      <Sidebar
        side="left"
        collapsible={isMobile ? "none" : "offcanvas"}
        className={cn(
          "hidden md:flex md:min-h-svh md:h-full md:w-(--sidebar-width) md:border-r",
          props.className,
        )}
      >
        {menuLayout}
      </Sidebar>
    </>
  );
}

export function SideMenuProvider({ children }: { children: ReactNode }) {
  const nodes = Children.toArray(children);
  const sideMenus: ReactNode[] = [];
  const content: ReactNode[] = [];

  for (const node of nodes) {
    if (isValidElement(node) && node.type === SideMenu) {
      sideMenus.push(node);
    } else {
      content.push(node);
    }
  }

  return (
    <SidebarProvider className="flex-col md:flex-row">
      {sideMenus}
      {content.length > 0 ? <SidebarInset>{content}</SidebarInset> : null}
    </SidebarProvider>
  );
}

export function SideMenuTrigger({
  asChild = false,
  onClick,
  ...props
}: ComponentProps<"button"> & {
  asChild?: boolean;
}) {
  const { toggleSidebar } = useSidebar();
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      {...props}
      onClick={(e) => {
        onClick?.(e);
        toggleSidebar();
      }}
    />
  );
}
