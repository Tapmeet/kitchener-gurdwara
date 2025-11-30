// src/auth.ts
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import GoogleProvider from 'next-auth/providers/google';
import AppleProvider from 'next-auth/providers/apple';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextAuthOptions } from 'next-auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcrypt';

export type AllowedRole = 'ADMIN' | 'STAFF' | 'LANGRI' | 'VIEWER';

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma as any),
  session: { strategy: 'jwt' },
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      // Safe for Google (verified emails). Lets a Google login attach to an
      // existing user row that was created via credentials earlier.
      allowDangerousEmailAccountLinking: true,
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
        const email = (credentials.email || '').toLowerCase();
        const user = await prisma.user.findUnique({ where: { email } });
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
    // 1) On every successful sign-in: link any anonymous bookings by contactEmail
    async signIn({ user, account }) {
      if (
        account?.provider === 'google' &&
        (account as any)?.emailVerified === false
      ) {
        return false;
      }
      const email = user?.email?.toLowerCase();
      if (!email) return true;

      try {
        await prisma.$transaction(async (tx) => {
          // Guarantee a User row exists for this email (idempotent)
          const u = await tx.user.upsert({
            where: { email },
            update: {}, // nothing to update
            create: {
              email,
              name: user?.name ?? null,
              role: 'VIEWER',
            },
            select: { id: true },
          });

          // Link all anonymous bookings (createdById null + contactEmail match)
          await tx.booking.updateMany({
            where: {
              createdById: null,
              contactEmail: { equals: email, mode: 'insensitive' },
            },
            data: { createdById: u.id },
          });
        });
      } catch (e) {
        console.error('Link bookings on sign-in failed:', e);
        // Don’t block login on a bookkeeping error
      }
      return true;
    },
    async jwt({ token, user }) {
      // Normalize email casing
      if (token?.email)
        (token as any).email = (token.email as string).toLowerCase();
      // On first sign-in, 'user' is populated
      if (user) {
        (token as any).role = ((user as any).role as AllowedRole) ?? 'VIEWER';

        // Auto-promote configured emails to ADMIN
        const admins = parseAdminEmails();
        if (token.email && admins.includes(token.email.toLowerCase())) {
          (token as any).role = 'ADMIN';
          try {
            const email = (token.email as string).toLowerCase();
            const existing = await prisma.user.findUnique({ where: { email } });
            if (existing?.role !== 'ADMIN') {
              try {
                await prisma.user.update({
                  where: { email: token.email as string },
                  data: { role: 'ADMIN' as any },
                });
              } catch (e) {
                // do not break OAuth if bookkeeping fails
                console.error('Admin autopromote update failed:', e);
              }
            }
          } catch (e) {
            console.error('Admin autopromote update failed:', e);
          }
        }
      } else if (token.email) {
        // Refresh role from DB
        const db = await prisma.user.findUnique({
          where: { email: (token.email as string).toLowerCase() },
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
