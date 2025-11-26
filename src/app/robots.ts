import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  const vercelEnv = process.env.VERCEL_ENV;
  const nodeEnv = process.env.NODE_ENV;

  const isProd =
    vercelEnv === 'production' || (!vercelEnv && nodeEnv === 'production');

  let baseUrl = 'http://localhost:3000';
  if (nextAuthUrl) {
    try {
      baseUrl = new URL(nextAuthUrl).origin;
    } catch {
      console.warn('Invalid NEXTAUTH_URL, falling back to localhost');
    }
  }

  // Block everything on non-prod
  if (!isProd) {
    return {
      rules: [
        {
          userAgent: '*',
          disallow: ['/'],
        },
      ],
    };
  }

  // Production rules
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: ['/admin', '/admin/*', '/api', '/api/*', '/auth', '/auth/*'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
