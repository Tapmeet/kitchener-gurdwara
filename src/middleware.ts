import { withAuth } from 'next-auth/middleware';

export default withAuth({
  callbacks: {
    authorized: ({ token, req }) => {
      const isAdminPath = req.nextUrl.pathname.startsWith('/admin');
      if (!isAdminPath) return true;
      const role = (token as any)?.role;
      return role === "ADMIN";
    },
  },
});

export const config = {
  matcher: ['/admin/:path*'],
};
