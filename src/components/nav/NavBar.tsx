// src/components/nav/NavBar.tsx
import { auth } from "@/lib/auth";
import { NAV_ITEMS, type NavItem, type AppRole } from "@/config/nav";
import NavClient from "./NavClient";

export default async function NavBar() {
  const session = await auth();
  const role = ((session?.user as any)?.role ?? "VIEWER") as AppRole;

  const items: NavItem[] = NAV_ITEMS.filter((it) => {
    if (!it.href) return false;
    if (!it.roles) return true;
    return it.roles.includes(role);
  });

  return <NavClient items={items} />;
}
