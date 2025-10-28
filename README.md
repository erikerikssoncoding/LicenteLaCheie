# LicenteLaCheie

## Environment configuration

Set the authentication secrets for NextAuth in every environment. Define `AUTH_SECRET` and `AUTH_SALT`, or use the equivalent `NEXTAUTH_SECRET` and `NEXTAUTH_SALT` variables. These values are required for JWT encryption and session validation.

## Auth middleware debug tools

When you need more visibility into the authentication flow, enable the structured logger by setting `AUTH_DEBUG=true` in your environment. With the flag active:

- Every request that goes through `middleware.ts` records key checkpoints (incoming request, token decoding result, role-based redirects, etc.) in memory and prints them to the server console with the `[auth-debug]` prefix.
- You can inspect the most recent events (up to 50) by calling `GET /api/debug/auth`, which returns both the configuration summary detected by the middleware and the buffered log entries.

Disable the flag after troubleshooting to avoid leaking sensitive metadata in shared environments.
