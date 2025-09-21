// src/types/next-auth.d.ts
import NextAuth, { DefaultSession, DefaultUser } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role?: 'ADMIN' | 'SECRETARY' | 'GRANTHI' | 'LANGRI' | 'VIEWER';
    } & DefaultSession['user'];
  }
  interface User extends DefaultUser {
    role?: 'ADMIN' | 'SECRETARY' | 'GRANTHI' | 'LANGRI' | 'VIEWER';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'ADMIN' | 'SECRETARY' | 'GRANTHI' | 'LANGRI' | 'VIEWER';
  }
}
