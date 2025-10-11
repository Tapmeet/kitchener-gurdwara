// src/types/next-auth.d.ts
import type { DefaultSession, DefaultUser } from 'next-auth';

type Role = 'ADMIN' | 'STAFF' | 'LANGRI' | 'VIEWER';

declare module 'next-auth' {
  interface User extends DefaultUser {
    id: string;
    role?: Role;
  }
  interface Session {
    user: { id: string; role?: Role } & DefaultSession['user'];
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: Role;
  }
}
export {};
