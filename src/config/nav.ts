// src/config/nav.ts
export type AppRole = "ADMIN" | "ADMIN" | "STAFF" | "LANGRI" | "VIEWER";

export type NavItem = {
  label: string;
  href: string;
  roles?: AppRole[]; // if omitted, visible to everyone
};

// Central menu registry — add routes here once and they appear in the nav.
// Tip: If you add new pages later, just append them below.
export const NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },

  // Public/user routes (uncomment or add as needed)
  // { label: "Calendar", href: "/calendar" },
  // { label: "Book a Program", href: "/bookings/new" },

  // Authenticated user convenience
  { label: "My Assignments (.ics)", href: "/api/me/assignments.ics" },

  // Admin-only
  { label: "Admin · Schedule", href: "/admin/schedule", roles: ["ADMIN"] },
  { label: "Admin · Staff", href: "/admin/staff", roles: ["ADMIN"] },
  { label: "Admin · Swap Assignments", href: "/admin/assignments/swap", roles: ["ADMIN"] },
];
