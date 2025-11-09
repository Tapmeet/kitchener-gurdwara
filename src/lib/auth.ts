// src/lib/auth.ts
import { getServerSession, type DefaultSession } from 'next-auth';
import { authOptions } from '@/auth';

export async function auth() {
  return getServerSession(authOptions) as Promise<DefaultSession | null>;
}

export { authOptions };
