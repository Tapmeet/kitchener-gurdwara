import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const nextAuthUrl = process.env.NEXTAUTH_URL;

  // Safely derive the origin from NEXTAUTH_URL
  let baseUrl = 'http://localhost:3000';
  if (nextAuthUrl) {
    try {
      baseUrl = new URL(nextAuthUrl).origin;
    } catch {
      // If NEXTAUTH_URL is somehow invalid, keep the default
      console.warn('Invalid NEXTAUTH_URL, falling back to localhost');
    }
  }

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
