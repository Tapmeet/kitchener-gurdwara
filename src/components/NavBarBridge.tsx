// src/components/NavBarBridge.tsx
'use client';

import { useSession } from 'next-auth/react';
import NavBar from '@/components/NavBar';

type Role = 'ADMIN' | 'STAFF' | 'LANGRI' | 'VIEWER' | (string & {});

export default function NavBarBridge() {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated';
  const role = ((session?.user as any)?.role ?? 'VIEWER') as Role;

  const user = isAuthenticated
    ? {
        name: session?.user?.name ?? null,
        email: session?.user?.email ?? null,
        image: (session?.user as any)?.image ?? null,
        role,
      }
    : null;

  // If you want an “isPrivileged” flag, base it on role on the client
  const isPrivileged = role === 'ADMIN';

  return (
    <NavBar
      user={user}
      isAuthenticated={isAuthenticated}
      isPrivileged={isPrivileged}
    />
  );
}
