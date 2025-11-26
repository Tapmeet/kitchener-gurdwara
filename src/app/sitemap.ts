import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const nextAuthUrl = process.env.NEXTAUTH_URL;

  // Derive base URL from NEXTAUTH_URL, fallback to localhost
  let baseUrl = 'http://localhost:3000';
  if (nextAuthUrl) {
    try {
      baseUrl = new URL(nextAuthUrl).origin;
    } catch {
      console.warn('Invalid NEXTAUTH_URL, falling back to localhost');
    }
  }

  const now = new Date();

  return [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${baseUrl}/book`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/my-bookings`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
    {
      url: `${baseUrl}/my-assignments`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.6,
    },
  ];
}
