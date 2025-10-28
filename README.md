# LicenteLaCheie

## Environment configuration

Set the authentication secrets for NextAuth in every environment. Define `AUTH_SECRET` and `AUTH_SALT`, or use the equivalent `NEXTAUTH_SECRET` and `NEXTAUTH_SALT` variables. These values are required for JWT encryption and session validation.

## Generate authentication secrets

When you need fresh values for local development or production deployments, run the helper script:

```bash
node scripts/generate-auth-secrets.js
```

The script prints new `AUTH_SECRET` and `AUTH_SALT` pairs generated with `crypto.randomBytes(32).toString("base64")` and optionally writes them to any `.env` file you choose (for example `.env.local` or `.env.production`). Copy the resulting values into the environment files used by your deployment platform to keep session encryption consistent.

## Auth middleware debug tools

When you need more visibility into the authentication flow, enable the structured logger by setting `AUTH_DEBUG=true` in your environment. With the flag active:

- Every request that goes through `middleware.ts` records key checkpoints (incoming request, token decoding result, role-based redirects, etc.) in memory and prints them to the server console with the `[auth-debug]` prefix.
- You can inspect the most recent events (up to 50) by calling `GET /api/debug/auth`, which returns both the configuration summary detected by the middleware and the buffered log entries.

Disable the flag after troubleshooting to avoid leaking sensitive metadata in shared environments.
