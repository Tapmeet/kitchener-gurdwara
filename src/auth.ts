// src/auth.ts
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import GoogleProvider from 'next-auth/providers/google';
import AppleProvider from 'next-auth/providers/apple';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextAuthOptions } from 'next-auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcrypt';

export type AllowedRole =
  | 'ADMIN'
  | "ADMIN"
  | "STAFF"
  | 'LANGRI'
  | 'VIEWER';

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),

    // Make Apple optional (skip if envs not present)
    ...(process.env.AUTH_APPLE_ID &&
    process.env.AUTH_APPLE_SECRET &&
    process.env.AUTH_APPLE_KEY_ID &&
    process.env.AUTH_APPLE_TEAM_ID
      ? [
          AppleProvider({
            clientId: process.env.AUTH_APPLE_ID!,
            clientSecret: process.env.AUTH_APPLE_SECRET!, // For production, consider generating JWT-based secret
          }),
        ]
      : []),

    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user || !user.passwordHash) return null;
        const ok = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );
        return ok ? user : null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On first sign-in, 'user' is populated
      if (user) {
        (token as any).role = ((user as any).role as AllowedRole) ?? 'VIEWER';

        // Auto-promote configured emails to ADMIN
        const admins = parseAdminEmails();
        if (token.email && admins.includes(token.email.toLowerCase())) {
          (token as any).role = 'ADMIN';
          await prisma.user.update({
            where: { email: token.email as string },
            data: { role: 'ADMIN' as any },
          });
        }
      } else if (token.email) {
        // Refresh role from DB
        const db = await prisma.user.findUnique({
          where: { email: token.email as string },
          select: { role: true },
        });
        if (db?.role) (token as any).role = db.role as AllowedRole;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.sub) (session.user as any).id = token.sub;
      (session.user as any).role = (token as any).role ?? 'VIEWER';
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};
