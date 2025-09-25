// app/dashboard/page.tsx (server component)
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/auth';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user)
    redirect(`/login?callbackUrl=${encodeURIComponent('/dashboard')}`);
  return <div>Admin content</div>;
}
