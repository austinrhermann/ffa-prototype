# FFA

Browser free-for-all shooter built with three.js. Characters, weapons and props come from the Blender asset library (exported to `models/*.glb`).

## Run locally

Any static file server works (the game fetches `models/` at runtime, so opening the file directly won't load assets):

```sh
npx serve .
```

## Deploy (Vercel)

Import the repo in Vercel, framework preset **Other**, no build command, output directory `.`. Every push to `main` redeploys.

## Fortress defend

The **Fortress** level is a hilltop fort on an island (from the Blender `Sets/Fortress` file), and it plays a co-op mode instead of free for all:

- All players are defenders and spawn inside the fort: the courtyard, the wall walk over the gate, the north building, the west wing, the tower room and the tower roof.
- Bots attack in waves, coming up from behind the hills. Each wave is bigger and better armed. **Attackers at once** caps how many are on the field; **Waves to survive** sets the length of the match.
- Attackers that reach the fort wear down its health (shown at the top of the screen). Hold out through every wave to win; if the fort reaches 0% it falls. Between waves the fort recovers a little.
- The fort has ammo, grenade crates and guns: carbines, a shotgun, and rifles in the tower room and on the roof. Dropped attacker guns can be picked up outside.
- Ladders: a doorway at the foot of the tower leads to a ladder up through the hatch into the tower room. A second ladder on the tower's courtyard wall goes to the roof. Walk into a ladder to climb and away from it to climb down.
- No friendly fire between players.

`models/Fortress.glb` is exported from the Blender file with `tools/export_fortress.py`, which applies modifiers, cuts the tower doorway and floors the open tower shaft:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b "<Asset Library>/Sets/Fortress/Fortress.blend" --python tools/export_fortress.py
```

## Multiplayer

- Open the site: you're the **host**. The start screen shows an invite link (`?join=<id>`) to send to friends.
- The host's browser runs the match: level, bots, difficulty and score limit (or waves on Fortress), plus all scoring, waves, pickups, grenades and gas cans.
- **Guests** opening the link only pick a name and character, then join.
- Networking is peer-to-peer WebRTC via [PeerJS](https://peerjs.com). The free public PeerJS server is used only to introduce players; game traffic goes directly between browsers, with a public TURN relay as a fallback for strict networks.
- If the host closes the tab, the match ends for everyone.

## Voice chat

Every player connects audio directly to every other player. The browser asks for microphone access when you join (guests) or when the first friend joins (host). Guests join with their mic muted. Press **M** to mute or unmute; on mobile use the **Mic** button. If mic access is denied you can still hear others.

## Text chat

Press **Enter** to open the chat box, type, and press **Enter** again to send (Esc cancels). Messages appear for everyone in the kill feed. On mobile use the **Chat** button.

## Controls

WASD move · Shift run · C crouch · Space jump · Left click shoot · Right click aim · R reload · F knife · G (hold) cook and throw grenade · Wheel / 1–4 switch weapon · M mute · Enter chat · Tab scores · Esc pause
