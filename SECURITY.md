# Security Policy

## Supported versions

The latest release on `main` is supported. Older tags stay available for pinning
but do not receive security fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

- Repository → **Security** → **Report a vulnerability**

Do not open a public issue for a vulnerability, and never paste API keys,
tokens, QQ numbers, group ids or full logs into an issue or pull request.

## Scope notes

- Session core stores conversation state and access grants on the local host;
  it does not store provider credentials.
- `<DSH_HOME>` is writable by the host user; protect it like any local state
  directory.
