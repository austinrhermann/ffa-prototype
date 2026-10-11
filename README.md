# FFA

Browser free-for-all shooter built with three.js. Characters, weapons and props come from the Blender asset library (exported to `models/*.glb`).

## Run locally

Any static file server works (the game fetches `models/` at runtime, so opening the file directly won't load assets):

```sh
npx serve .
```

## Deploy (Vercel)

Import the repo in Vercel, framework preset **Other**, no build command, output directory `.`. Every push to `main` redeploys.

## Multiplayer

- Open the site: you're the **host**. The start screen shows an invite link (`?join=<id>`) to send to friends.
- The host's browser runs the match: level, bots, difficulty and score limit, plus all scoring, pickups, grenades and gas cans.
- **Guests** opening the link only pick a name and character, then join.
- Networking is peer-to-peer WebRTC via [PeerJS](https://peerjs.com). The free public PeerJS server is used only to introduce players; game traffic goes directly between browsers, with a public TURN relay as a fallback for strict networks.
- If the host closes the tab, the match ends for everyone.

## Voice chat

Every player connects audio directly to every other player. The browser asks for microphone access when you join (guests) or when the first friend joins (host). Press **M** to mute or unmute; on mobile use the **Mic** button. If mic access is denied you can still hear others.

## Controls

WASD move · Shift run · C crouch · Space jump · Left click shoot · Right click aim · R reload · F knife · G (hold) cook and throw grenade · Wheel / 1–4 switch weapon · M mute · Tab scores · Esc pause
