// src/components/nav/NavClient.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavItem } from "@/config/nav";

export default function NavClient({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="border-b bg-white/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-semibold">Gurdwara</Link>
        <button
          className="md:hidden border rounded-lg px-3 py-1 text-sm"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          Menu
        </button>
        <ul className="hidden md:flex items-center gap-4 text-sm">
          {items.map((it) => {
            const active = it.href !== "/" && pathname?.startsWith(it.href);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`px-2 py-1 rounded ${active ? "bg-gray-100 font-medium" : "hover:bg-gray-50"}`}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {open && (
        <ul className="md:hidden border-t p-2 space-y-1 text-sm">
          {items.map((it) => {
            const active = it.href !== "/" && pathname?.startsWith(it.href);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`block px-3 py-2 ${active ? "bg-gray-100 font-medium" : "hover:bg-gray-50"}`}
                  onClick={() => setOpen(false)}
                >
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
