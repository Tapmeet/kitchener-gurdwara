// src/config/nav.ts
export type AppRole = 'ADMIN' | 'STAFF' | 'LANGRI' | 'VIEWER';

export type NavItem = {
  label: string;
  href: string;
  roles?: AppRole[]; // if omitted, visible for any role
};

// Single source of truth for all menu items
export const NAV_ITEMS: NavItem[] = [
  // Public / general
  { label: 'Home', href: '/' },
  { label: 'Book a Program', href: '/book' },

  // Logged-in convenience
  {
    label: 'My Bookings',
    href: '/my-bookings',
    roles: ['ADMIN', 'STAFF', 'LANGRI', 'VIEWER'],
  },
  {
    label: 'My Assignments',
    href: '/my-assignments',
    roles: ['ADMIN', 'STAFF', 'LANGRI'],
  },
  {
    label: 'Program Types',
    href: '/program-types',
    roles: ['ADMIN', 'STAFF'],
  },

  // Admin section
  { label: 'Admin · Schedule', href: '/admin/schedule', roles: ['ADMIN'] },
  { label: 'Admin · Staff', href: '/admin/staff', roles: ['ADMIN'] },
  { label: 'Admin · Bookings', href: '/admin/bookings', roles: ['ADMIN'] },
  {
    label: 'Admin · Fairness Report',
    href: '/admin/reports/fairness',
    roles: ['ADMIN'],
  },
  {
    label: 'Admin · Swap Assignments',
    href: '/admin/assignments/swap',
    roles: ['ADMIN'],
  },
  {
    label: 'Admin · Space Bookings',
    href: '/admin/space-bookings',
    roles: ['ADMIN'],
  },
];
