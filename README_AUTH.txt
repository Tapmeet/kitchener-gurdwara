
Auth & Assignments Wiring (added by helper)

1) Env (.env):
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=...random...
   AUTH_GOOGLE_ID=...
   AUTH_GOOGLE_SECRET=...
   AUTH_APPLE_ID=...
   AUTH_APPLE_SECRET=...
   AUTH_APPLE_KEY_ID=...
   AUTH_APPLE_TEAM_ID=...
   DATABASE_URL=postgresql://USER:PASS@localhost:5432/gurdwara?schema=public

2) Prisma:
   npm i @prisma/client
   npm i -D prisma
   npx prisma generate
   npx prisma migrate dev -n "nextauth"

3) Routes:
   - /login (Credentials, Google, Apple)
   - /api/auth/[...nextauth]
   - /bookings/[id]/assignments (role-gated server component)

4) Roles allowed to view assignments: ADMIN, SECRETARY, GRANTHI, LANGRI
