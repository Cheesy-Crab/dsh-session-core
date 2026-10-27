# dsh-session-core

Core-owned session service for DSH. It manages workspaces, session lifecycle, turn queues, reply splitting and titles for every communication surface.

```text
QQ / Web / Telegram
        ↓ conversation key + send callbacks
@dsh/session-core
        ↓
platform core (capabilities / prompts / delivery)
```

## What it owns

- workspace path allocation
- session creation / resume / deletion
- turn queue
- reply splitting
- session titles
- per-session state

## What it does not own

- QQ / OneBot / NapCat
- image generation or other abilities
- plugin-specific prompts
- mention / chat surface rules

## Install

This is a core service plugin. Load it before any communication adapter:

```text
@dsh/platform-core
@dsh/session-core
dsh-qq-bridge   # optional
```

DSH Desktop → Plugins → install:

```text
https://github.com/Cheesy-Crab/dsh-session-core.git
```

## Service

```js
const sessionService = ctx.get('sessionService')

const manager = sessionService.createManager({
  ctx,
  config,
  root,
  log,
  send,
  sendImage,
  store,
  approval,
  bindSession,
  resolveChat,
  behavior,
})
```

The communication adapter supplies callbacks; it does not construct `ChatAgentManager` directly.

## Boundary

The package must not import QQ, OneBot, NapCat or any capability plugin. Its only inputs are:

- a conversation target (`type` + `id`)
- send callbacks
- approval bridge
- session binding / reverse lookup
- behavior extensions

## Test

```bash
node --test --test-force-exit
```

## Status

`0.48.0` — extracted from `dsh-qq-bridge` as a required core service plugin; owns session, workspace and access primitives.

## License

MIT License.

