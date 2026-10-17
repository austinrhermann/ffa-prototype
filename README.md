# The Space Explorers

Browser free-for-all shooter built with three.js. Characters, weapons and props come from the Blender asset library (exported to `models/*.glb`).

## Title page

The game opens on a title page (`title.jpg`, a placeholder render of the fort; replace it with any image) with two choices. Everything starts loading as soon as the page opens.

- **Battle in the Arena**: free for all on Complex, Facility, Bunker or Creek.
- **Defend the Fort**: the tower defense. Its menu has two invite buttons: **Invite an apprentice** (the normal invite) and **Invite pirates** (`&team=pirates`, joins as an attacker). The rules, role choice, difficulty and controls are behind the **Instructions and controls** switch.

- **Test Drive**: a little stadium oval with cars and motorcycles to drive, tune and crash, with friends (see below). It's where the vehicle mechanics get worked out before they go into the other games.

Each menu shows only what you need to start (the arena: level and Play); everything else is behind its **Options and controls** switch, including mouse sensitivity and whether right click holds or toggles aim (remembered in your browser). **Play again** on the title page starts the last game you hosted.

Invited friends skip the title page. **Main menu** on the pause screen (every mode) goes back to the title page; a host leaving ends the game for everyone who joined.

## Characters

Seven characters and the Midas carbine come from the Blender asset library (`00_Exports`, T-pose Rigify rigs). `tools/build_characters.py` turns them into the game GLBs (body, head and worn gear skinned to the DEF- bones; handheld guns, mortar and shield left out):

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_characters.py -- "<00_Exports folder>" models [name ...]
```

Eli, Beto, Zeke and Deigo are `Soldier_2_heavy`, `Soldier_3_thin`, `Soldier_4_bigframe` and `Soldier_5_smallframe`; Apprentice, Master, Officer and `Midas_Carbine` keep their names. The new characters have no baked gun, so `poseArms` in `index.html` swings their arms down from the T-pose into a carbine grip when the models load. The Apprentice, Master and Officer faces use their painted head textures only: the projected face details (eyes, brows, mouth) don't export.

### Posing characters (Blender Pose Kit)

Real posing is deferred to animators. Normal play currently keeps the procedural poses; the committed Eli pose file is unposed and is ignored. Each weapon switches to an authored hold only when both its posed `hold_<weapon>` clip and matching `Socket_<weapon>` exist. Missing or unposed clips keep the procedural behavior, including crouch and death. First-person weapon placement is unchanged.

For a future animator handoff, use Blender 5.0.1 at `/Applications/Blender.app`:

1. Link **both** add-on files into Blender's add-ons folder. “Install from Disk” copies only one file and misses the shared `chars.py` dependency:

   ```sh
   mkdir -p "$HOME/Library/Application Support/Blender/5.0/scripts/addons"
   ln -s /Users/austinhermann/Documents/GitHub/ffa-prototype/tools/ffa_pose_kit.py "$HOME/Library/Application Support/Blender/5.0/scripts/addons/"
   ln -s /Users/austinhermann/Documents/GitHub/ffa-prototype/tools/chars.py "$HOME/Library/Application Support/Blender/5.0/scripts/addons/"
   ```

   Restart Blender, then enable **FFA Pose Kit** under Preferences → Add-ons.
2. Run setup once per character, substituting the source folder and character name:

   ```sh
   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/ffa_pose_kit.py -- setup "<00_Exports folder>" "/Users/austinhermann/Documents/GitHub/ffa-prototype" Soldier_2_heavy
   ```

   The local source folder is `/Users/austinhermann/Downloads/Asset Library/00_Exports `, with a **trailing space**; preserve it inside the quotes. Setup creates `<source>/Poses/<Char>_poses.blend` without changing the source character file. Pose files already exist for Soldier_2_heavy and Master; the other five still need setup.
3. Open that pose file and use the **FFA Pose Kit** tab in the viewport's N-panel. Choose a weapon and pose its Rigify controls at frame 1. Face the gun along Blender **−Y**, keeping it level. Move and rotate `Socket_<weapon>` to seat the gun; move the socket rather than the preview gun. Click **Key Pose** before changing poses, and **save the .blend** so future exports retain the work.
4. Author `hold_pistol`, `hold_carbine`, `hold_rifle`, `hold_shotgun`, `crouch` and `death` as needed. Only the legs are used from crouch. Pose death standing upright; the game supplies the backwards fall. Keep action/socket names and DEF bone names unchanged. Partial posing is supported.
5. Click **Export Poses** with the Game folder set to this repository, or run:

   ```sh
   /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/ffa_pose_kit.py -- export "<00_Exports folder>" "/Users/austinhermann/Documents/GitHub/ffa-prototype" Soldier_2_heavy
   python3 tools/inspect_poses.py Soldier_2_heavy
   ```

   Export writes `models/poses/<Char>.glb`. Check the inspector's rest/reachability results, inspect the game preview, then commit the GLB.

To check poses, serve the repository and open `http://localhost:8000/?posecheck`. The character preview opens directly: select a character, press **1–4** for pistol/carbine/rifle/shotgun, **C** to toggle crouch, and **K** to replay a death. A corner label lists each pose's authored/procedural source. Changing weapons or toggling crouch returns from the death preview. Shortcuts work while the menu is visible and focus is outside a text field or selector.

Use `http://localhost:8000/?posecheck&posefixture` to exercise the authored paths without Blender. **`?posefixture` is test data only**: it gives Eli a raised pistol hold, deeper crouch and asymmetric death pose; his other weapons and all other characters remain procedural. It writes no assets and has no effect when the flag is absent.

## Run locally

Any static file server works (the game fetches `models/` at runtime, so opening the file directly won't load assets):

```sh
npx serve .
```

## Deploy (Vercel)

Import the repo in Vercel, framework preset **Other**, no build command, output directory `.`. Every push to `main` redeploys.

## Test Drive

A little stadium oval (open it directly with `?level=drive`): two 120 m straights and banked turns, a tall outer wall with a catch fence so nobody leaves the track, a low inner wall with a gap onto the infield, and three ramps on the straights (each covers half the track, so you can hit it or drive round it). The infield parking lot has six open-chassis cars (Kart, two Roadsters, Muscle, Buggy, Hauler) and two motorcycles (Sport bike, Dirt bike). Nobody carries a gun, and on foot you're in third person. Walk up to a vehicle and press **E**.

- **Cars** are bare chassis: frame, floor, two seats, a steering wheel and four wheels, so the driver's-seat view (**V**) has nothing in the way. The bikes lean into turns.
- **Driving**: W/S throttle, brake and reverse; A/D steer; Space handbrake; R puts you back on your wheels where you are. Wheels follow the banking and ramps, you fly off ramp lips, W/S tip the nose in the air, and the body dives, squats, rolls and bounces on its suspension. A lap timer runs from the line on the front straight (last and best lap in the corner).
- **Tuning (Tab in a vehicle)**: sliders for acceleration, top speed, brakes, reverse, handbrake power and grip, steering lock (with the turning radius it gives) and how it fades with speed, tyre grip and cornering limit, weight, length, width, wheel size, suspension stiffness, damping and travel, lean (bikes), gravity, nose control in the air and how hard you bounce off walls. Changes apply as you drag, to that vehicle, for everyone in the game. **Use these on every car** copies them across; **Copy settings** puts the numbers on the clipboard. Tab again (or Drive) goes back to driving.
- **Multiplayer**: the normal invite link. Whoever drives a vehicle simulates it on their own machine and sends its state; the host simulates the parked ones and relays everything. In a crash each machine pushes the vehicles it simulates using the other's reported speed and weight, so both cars react. Other drivers are seen sitting in their seats.

All of it lives in `vehicles.js` (the main game calls into it through `VEH`); the stadium is generated there too, not loaded from a file. The earlier truck and plane are in the git history (commit 7315060).

## Creek

An outdoor free-for-all map (open it directly with `?level=creek`): a canyon ringed by cliffs, a creek winding across the middle that you can wade through, a rock arch over it with the Master rifle on top, boulders and low barriers for cover, and a base at each end (orange and teal trim). Each base has a front room and a back room on the ground floor (shotgun in the back room), ramps up both outside walls to a roof with a parapet, and a raised platform at the back of the roof (carbine). The two halves mirror each other.

It's an original map in the spirit of the classic two-base canyon maps; everything in it, textures included, is generated by `tools/build_creek.py` (run it in Blender; the command is at the top). It writes `models/Creek.glb` (what you see) and `models/Creek_col.glb` (what everything collides with). Bots get around on a walking map of every floor (rooms, ramps, roofs, the arch) that the host builds when the level loads, and keep moving along their route while they fight.

## Fortress defend

The **Fortress** level (open it directly with `?level=fortress`) is James's tower defense: a hilltop fort on an island that the players hold against three waves of Midas soldiers (4, then 8, then 12). Each wave sets off as soon as the last one is beaten; the trucks' drive in is the only breather. If any defender dies, the fort is lost. The start screen has one setting, Difficulty; the pause screen has Restart game.

- **The Master**: Master rifle (20 shots in the fort; an ammo box adds 10), laser pistol, 4 grenades, double health (200). Plays alone if nobody else joins.
- **The Apprentice**: laser pistol only. Works the computer in the tower room (press **E** next to it): a map with every attacker on it, and **Space** opens or closes the gate. The gate starts shut and never moves by itself.
- **The Computer**: always an NPC. Fires the cannon on the wall over the gate by itself (a grenade-sized blast, then 10 s to recharge), trucks first. It only engages targets more than 25 m out from the wall, so it never reaches the gate: up close, the defenders have to do the work.
- Alone you're the Master. With a friend, the host picks Master or Apprentice and the friend gets the other. Everyone after the second joins the attackers as a Midas soldier (carbine and pistol); a dead attacker can press **E** to take over the NPC soldier closest to the gate.
- **Trucks**: the attackers ride in, 4 to a truck, along the road from behind the hill (out of sight from the fort for the first half of the drive) and get out 20 to 30 m in front of the gate; the empty trucks stay as cover, and later trucks stop and unload behind any truck already on the road. Trucks can be shot (bullets barely scratch them; the Master's rifle does real damage), grenaded and shelled. A destroyed truck burns, and anyone still in the back bails out hurt.
- **Leaning out**: press up against the parapet on the wall walk (or the tower room's front window) and look down, and your head goes out over the edge so you can shoot the attackers at the gate. Once you're out you can look left, right and up without pulling back in; step back from the wall to come in.
- Attackers batter the gate (two doors at the courtyard end of the passage, swinging inward; it only breaks once). Once it's open they come in and hunt the defenders anywhere in the fort, on a walking map of every floor the host builds when the level loads.
- White health boxes in the courtyard, on the wall walk, in the back corridor and in the tower room (attackers can't use them; they restock after each wave). Attackers move at 70% speed, carry Midas carbines and don't throw grenades. They shoot whenever they can see any of you, on the way up as well as inside: a head over the parapet or someone leaning out is a smaller target, but not a safe one. Dead pirates drop their carbines for the defenders to pick up, and there's a shotgun in the courtyard.
- **Look**: Fortress uses a flat sun-and-shadow look copied from the Blender renders (lit surfaces show their texture colour, shadowed ones the texture times a shadow colour, with a ramp for the edge). Esc, then **Look**, to change the sun, shadow colour, edge and sky live; **Copy settings** copies them for `LOOK_DEFAULT`. The other levels keep the original lighting.

The level comes from James's render set export, turned into two files by `tools/build_fortress.py` (run it in Blender; the command is at the top of the script):

- `models/Fortress_v5.glb` is what you see: characters, render helpers and the render cannon removed, heavy plants simplified, objects merged by material, textures shrunk to JPEG, geometry Draco-compressed (63 MB down to about 6 MB).
- `models/Fortress_v5_col.glb` is what everything collides with, shoots at and walks on: simplified terrain, the fort exact, props as boxes, no plants, the closed gate as a box named `Front_Gate`, every staircase replaced by a smooth ramp, and the way from the back corridor up to the wall walk trimmed open (`RAMPS` and `TRIM` in the script).

## Multiplayer

- Open the site: you're the **host**. The start screen shows an invite link (`?join=<id>`) to send to friends.
- The host's browser runs the match: level, bots, difficulty and score limit (or the waves on Fortress), plus all scoring, waves, pickups, grenades and gas cans.
- **Guests** opening the link only pick a name and character, then join.
- Networking is peer-to-peer WebRTC via [PeerJS](https://peerjs.com). The free public PeerJS server is used only to introduce players; game traffic goes directly between browsers, with a public TURN relay as a fallback for strict networks.
- If the host closes the tab, the match ends for everyone.

## Voice chat

Every player connects audio directly to every other player. The browser asks for microphone access when you join (guests) or when the first friend joins (host). Guests join with their mic muted. Press **M** to mute or unmute; on mobile use the **Mic** button. If mic access is denied you can still hear others.

## Text chat

Press **Enter** to open the chat box, type, and press **Enter** again to send (Esc cancels). Messages appear for everyone in the kill feed. On mobile use the **Chat** button.

## Bullet holes and scorch marks

Shots leave bullet holes on walls and anything else they hit, so you can draw on walls by shooting. Grenades and gas cans leave a big black scorch mark on the floor and walls around the blast. Both stay for the whole round and clear when a new round starts or the level changes. Everyone sees everyone's marks, including players who join mid-round.

## Muzzle flash and smoke

Each gun has its own muzzle flash and smoke, seen on your own gun and on other players and bots:

| Gun | Flash | Smoke |
| --- | --- | --- |
| Laser Pistol | Red energy ring with thin spikes | Glowing red sparks |
| Midas Carbine | Four-pointed star | Small light puffs |
| Master Rifle | Big flash with long side jets | Large white plume that lingers |
| Double Barrel | Ragged fireball | Thick dark-grey cloud |

These are drawn in code for now. To use your own art, add PNGs to an `fx/` folder and set `img` for that gun in `GUN_FX` near the top of the script in `index.html`, for example `img: 'fx/carbine_flash.png'`. Suggested names are `fx/<gun>_flash.png` and `fx/<gun>_smoke.png`, where `<gun>` is `pistol`, `carbine`, `rifle` or `shotgun`.

- **Flash:** a square PNG (256×256 works well), centred, in full colour on a transparent or black background. It's drawn additively, so black shows as see-through. Each shot rotates it randomly.
- **Smoke:** a square, centred PNG of one soft puff on a transparent background. Draw it white or light grey, because `color` in `GUN_FX` tints it. Several puffs are spawned per shot, then rotated, grown and faded.
- `GUN_FX` also sets each gun's size, timing, puff count and drift, so you can tune those without new art. If a PNG fails to load, the built-in drawing stays and the console shows a warning.

## Controls

WASD move · Shift run · C crouch · Space jump · Left click shoot · Right click or X aim (X toggles; Ctrl-click is a right click) · R reload (it also reloads by itself when empty) · Q, wheel or 1–4 switch weapon · F or G grenade (hold to cook) · E use (computer, vehicle, take over a soldier), otherwise knife · M mute · Enter chat · Tab scores · Esc pause

Every action has a key, so a one-button Mac mouse or a trackpad can play everything. A scroll-wheel swipe switches weapon once, however long the swipe keeps scrolling. Short hints appear the moment they matter (the keys, low ammo, the wall walk, the computer, the vehicles) a few times per browser, then stop.
