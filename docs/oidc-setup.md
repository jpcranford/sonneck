# OIDC / SSO setup

**Sign in with…** lets people sign in through your own identity provider (Authelia, Authentik, Keycloak, Okta, Google Workspace, or anything else that speaks standard OIDC) instead of Sonneck's built-in **No login**/**Password** modes. Unlike those two, this mode can give each user their own named account with unique permissions.

Setup is by env var only; picking it on the first-launch setup screen just shows an explanation, since it needs secrets (a client secret, a redirect URI) that a pre-auth web form can't safely collect. Set `AUTH_METHOD=oidc` plus the variables below, and restart.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `AUTH_METHOD` | (unset) | Set to `oidc` to enable this mode. |
| `OIDC_ISSUER_URL` | (unset) | Your identity provider's base URL — Sonneck fetches `{issuer}/.well-known/openid-configuration` from it at startup. Required. |
| `OIDC_CLIENT_ID` | (unset) | This app's client ID, as registered with your identity provider. Required. |
| `OIDC_CLIENT_SECRET` | (unset) | This app's client secret. Required. |
| `OIDC_REDIRECT_URI` | (unset) | The full, externally-reachable callback URL (e.g. `https://sonneck.example.com/api/auth/oidc/callback`) — must match what's registered with your identity provider exactly. Required. |
| `EXTERNAL_PROVIDER` | `your identity provider` | Display name shown on the "Sign in with…" button. |
| `OIDC_ALLOW_REGISTRATION` | `true` | Whether a person signing in for the first time automatically gets an account (with `OIDC_DEFAULT_PERMISSIONS` below), or is rejected until an admin pre-provisions them via `link-oidc-account`. |
| `OIDC_DEFAULT_PERMISSIONS` | `read` | Comma-separated permissions (`read`, `download`, `practice`, `edit`, `upload`, `create`, `delete`, `admin`) granted to a newly auto-provisioned account. |

If Sonneck can't reach your identity provider's discovery document at startup with these values, the server fails to start with a clear error rather than starting in a broken state.

## How accounts resolve

- **The very first person to sign in through OIDC is handed Sonneck's existing account** — so any favorites, notes, and tags already in your library carry over rather than being orphaned. Everyone who signs in after that gets their own new account.
- A new account's display name and avatar come from your identity provider's `name`/`picture` claims, and are **re-synced on every login** — that identity is your provider's to manage, not something editable from inside Sonneck (User Settings' name field is disabled for an OIDC account for this reason).
- If `OIDC_ALLOW_REGISTRATION=false`, only accounts you've already linked via `link-oidc-account` (below) can sign in — anyone else is turned away with a clear message instead of getting an account automatically.

## Pre-provisioning or fixing an account

`link-oidc-account` is one of the [admin CLI commands](../README.md#admin-cli-commands) — run it the same way as any other:

```sh
docker exec -it <container-name> sonneck link-oidc-account <user-id-or-name> <subject>
```

It links an existing Sonneck account to a specific identity-provider identity (that identity's `sub` claim), without waiting for that person to sign in first — useful with `OIDC_ALLOW_REGISTRATION=false`, or to correct an account that got linked to the wrong identity. It refuses to relink a `sub` that's already claimed by a different account rather than silently reassigning it.

## Switching to or away from OIDC on a running install

Changing `AUTH_METHOD` on an install that's already been through first-launch setup is safe — Sonneck notices on its next restart and walks you through it before anything else loads, the same way first-launch setup itself does. Moving to OIDC is a quick acknowledgment (your existing favorites, notes, and tags carry over to whoever signs in first). Moving away from OIDC with more than one account asks you to choose which account should survive — every other account, and anything specific to just those accounts, is permanently deleted once you confirm. Nothing takes effect until you click that final confirmation, so you can always change `AUTH_METHOD` back and pick up where you left off if you change your mind partway through.
