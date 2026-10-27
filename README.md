# The Space Explorers

Browser free-for-all shooter built with three.js. Characters, weapons and props come from the Blender asset library (exported to `models/*.glb`).

## Title page

The game opens on a title page (`title.jpg`, a placeholder render of the fort; replace it with any image). Everything starts loading as soon as the page opens. **Defend the Fort** is the game; it's the only choice on the title page.

The other modes are for the host and for development. Add `?dev` to the address and the title page shows them too (it applies to that page load only):

- **Battle in the Arena**: free for all on Complex, Facility, Bunker or Creek.
- **Test Drive**: a little stadium oval with cars and motorcycles to drive, tune and crash, with friends (see below). It's where the vehicle mechanics get worked out before they go into the other games.

`?dev` also brings back the **Look** button in Settings. `?level=<name>` still opens a level directly.

Every menu (start, join, pause and round results) looks like the title page: big white heading, solid black buttons, over the title picture (or over the game while paused). It fits on one screen, and on a phone it stacks and scrolls.

- The fort's start screen: **Play**, **Invite an apprentice** (the normal invite), **Invite pirates** (`&team=pirates`, joins as an attacker), **How to play**, **Settings** and **‹ Back**, with your name, character and the chat beside them.
- **How to play** has the rules and the controls.
- **Settings** is all buttons: your role with a friend (Master or Apprentice), difficulty, mouse sensitivity (− / +), whether right click holds or toggles aim and god mode. Sensitivity and the aim setting are remembered in your browser.
- The pause screen (Esc) has **Resume**, **Restart game**, the same **How to play** and **Settings**, and **Main menu**.
- **Play again** on the title page starts the last game you hosted.

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

A little stadium oval (open it directly with `?level=drive`): two 120 m straights and banked turns, a tall outer wall with a catch fence so nobody leaves the track, a low inner wall with a gap onto the infield, and three ramps on the straights (each sits in one lane, leaving a clear lane down the middle). A walkway through the outer wall on the back straight leads to the grandstand, whose rows you can climb (people only: vehicles are held back). The infield parking lot has six open-chassis cars (Kart, two Roadsters, Muscle, Buggy, Hauler), the fort's Truck (the Cargo Truck model), and two motorcycles (Sport bike, Dirt bike). Nobody carries a gun, and on foot you're in third person. Walk up to a vehicle and press **E**: where you stand picks the seat. The left side drives, the right side **rides along** in the passenger seat, and the Truck's tailgate climbs into the back (six seats). Bikes seat one. E again gets you out.

- **Cars** are bare chassis: frame, floor, two seats, a steering wheel and four wheels, so the driver's-seat view (**V**) has nothing in the way. The bikes lean into turns.
- **Driving**: W/S throttle, brake and reverse; A/D steer; Space handbrake; R puts you back on your wheels where you are. Wheels follow the banking and ramps, you fly off ramp lips, W/S tip the nose in the air, and the body dives, squats, rolls and bounces on its suspension. A lap timer runs from the line on the front straight (last and best lap in the corner).
- **Tuning (Tab in a vehicle)**: sliders for acceleration, top speed, brakes and reverse; steering lock, how it fades with speed and how fast the wheels turn, grip (how hard it can corner) and downforce (extra grip at speed), with a readout of the tightest turn and the speed where grip takes over from the steering; slide recovery, handbrake power and grip on the handbrake; weight, length, width, wheel size, suspension stiffness, damping and travel, lean (bikes), gravity, nose control in the air and how hard you bounce off walls. The ranges go well past realistic on purpose. Grip is what limits turning once you're moving (the front wheels are drawn at the angle the car is really turning, not the angle you asked for), and the banking adds a little. The handbrake locks the back wheels: it brakes hard, cuts the engine and swings the back round in a turn. Changes apply as you drag, to that vehicle, for everyone in the game. **Use these on every car** copies them across; **Copy settings** puts the numbers on the clipboard. Tab again (or Drive) goes back to driving.
- **Multiplayer**: the normal invite link. Whoever drives a vehicle simulates it on their own machine and sends its state; the host simulates the parked ones and relays everything. In a crash each machine pushes the vehicles it simulates using the other's reported speed and weight, so both cars react. Other drivers are seen sitting in their seats.

All of it lives in `vehicles.js` (the main game calls into it through `VEH`); the stadium is generated there too, not loaded from a file. The earlier truck and plane are in the git history (commit 7315060).

## Creek

An outdoor free-for-all map (open it directly with `?level=creek`): a canyon ringed by cliffs, a creek winding across the middle that you can wade through, a rock arch over it with the Master rifle on top, boulders and low barriers for cover, and a base at each end (orange and teal trim). Each base has a front room and a back room on the ground floor (shotgun in the back room), ramps up both outside walls to a roof with a parapet, and a raised platform at the back of the roof (carbine). The two halves mirror each other.

It's an original map in the spirit of the classic two-base canyon maps; everything in it, textures included, is generated by `tools/build_creek.py` (run it in Blender; the command is at the top). It writes `models/Creek.glb` (what you see) and `models/Creek_col.glb` (what everything collides with). Bots get around on a walking map of every floor (rooms, ramps, roofs, the arch) that the host builds when the level loads, and keep moving along their route while they fight.

## Fortress defend

The **Fortress** level (open it directly with `?level=fortress`) is James's tower defense: a hilltop fort on an island that the players hold against three waves of Midas soldiers (4, then 8, then 12). Each wave sets off as soon as the last one is beaten; the trucks' drive in is the only breather. If any defender dies, the fort is lost. Beat all three waves and nobody shoots at you any more: the island is yours to explore, and Esc shows **Play again**. Settings has the difficulty and your role; the pause screen has Restart game.

- **The Master**: Master rifle (20 shots in the fort; an ammo box adds 10), laser pistol, 4 grenades, double health (200). Plays alone if nobody else joins.
- **The Apprentice**: laser pistol only. Works the computer in the tower room (press **E** next to it): a map with every attacker on it, and **Space** opens or closes the gate. The gate starts shut and never moves by itself.
- **The Computer**: always an NPC. Fires the cannon on the wall over the gate by itself (a grenade-sized blast, then 10 s to recharge), trucks first. It only engages targets more than 25 m out from the wall, so it never reaches the gate: up close, the defenders have to do the work.
- Alone you're the Master. With a friend, the host picks Master or Apprentice and the friend gets the other. Everyone after the second joins the attackers as a Midas soldier (carbine and pistol); a dead attacker can press **E** to take over the NPC soldier closest to the gate.
- **Trucks**: the attackers ride in, 4 to a truck, along the road from behind the hill (out of sight from the fort for the first half of the drive). The trucks are the asset library's Cargo Truck with its container back (`models/Cargo_Truck.glb`, see below), driven as real vehicles (James's jeep tuning, from `vehicles.js`) by an NPC: it follows the road, drives right up to the gate, inside the cannon's minimum range (later trucks queue behind the ones already parked, including earlier waves'), and the soldiers pile out of the container's open back. Once a truck is empty it's anyone's: walk up to the left side to **drive**, the right side to **ride along**, or the back to **climb into the container** (six seats on two benches). Passengers can shoot from their seats; the driver can't. Trucks can be shot (bullets barely scratch them; the Master's rifle does real damage), grenaded and shelled. A destroyed truck turns into the burnt wreck, anyone in it bails out, and soldiers still in the back jump out hurt.
- **Trucks are cover**, parked or wrecked: boxes round the cab, the container and the chassis stop bullets (yours and the bots'), the bots' line of sight and grenade blasts. Hide behind one and the pirates can't see or shoot you; they hide behind them too. Soldiers walk round trucks, not through them. Riding inside one hides you, and you can still shoot out of it.
- There are no other vehicles in the fort (the courtyard motorcycle is gone; Test Drive still has it).
- **Leaning out**: press up against the parapet on the wall walk (or the tower room's front window) and look down, and your head goes out over the edge so you can shoot the attackers at the gate. Once you're out you can look left, right and up without pulling back in; step back from the wall to come in.
- **Tower door**: the doorway from the back corridor into the tower's lower stair room has a door, open at the start. A defender presses **E** beside it to close and lock it (E again opens it). Attackers pressed against it break it down in about 20 attacker-seconds (two soldiers: 10 s); once broken it stays broken.
- **The roof**: in the computer room, walk up to the back window and press **E** to climb out onto a small balcony. A ladder beside the window goes up to the roof (a good rifle spot and a last stand). E at the window climbs back in. Bots don't follow you up.
- An invisible fence runs along the rim of the valley between the fort and the hill so soldiers stay on the road side. The cannon's blast radius is 5.7 m (it used to be 8).
- Attackers batter the gate (two doors at the courtyard end of the passage, swinging inward; it only breaks once). Once it's open they come in and hunt the defenders anywhere in the fort, on a walking map of every floor the host builds when the level loads (it leaves out anywhere a body wouldn't fit at head or waist height, such as along the side of a staircase).
- White health boxes in the courtyard, on the wall walk, in the back corridor and in the tower room (attackers can't use them; they restock after each wave). Attackers move at 70% speed, carry Midas carbines and don't throw grenades. They shoot whenever they can see any of you, on the way up as well as inside: a head over the parapet or someone leaning out is a smaller target, but not a safe one. Dead pirates drop their carbines for the defenders to pick up, and there's a shotgun in the courtyard.
- **Look**: the fort is lit the way the Blender renders are, by their compositor's own rules (`tools/build_fortress.py` reads them out of the set):
  - **Where the sun reaches is baked.** Every surface of the set carries the render's lit-or-shadow mask (Cycles, from the render's sun lamp, with its threshold), so the fort's shadows are the render's: dark interiors, no light leaking through walls, no flickering edges. Real-time shadows are only for what moves (characters, trucks, doors), and what moves is lit by a grid of where the sun reaches (`models/Fortress_v5_sun.png`), so a soldier walking into the tower goes dark with it, and so does your gun.
  - **The renders' colours**: lit surfaces at the renders' exposure, shadowed ones much darker (a touch lighter than the renders', so attackers in shadow stay visible), a blue haze that grows with distance from 20 m to 550 m, and the renders' sky gradient, deep blue overhead.
  - With `?dev`, Esc, then Settings, then **Look** changes the sun (for what moves; the fort's own shadows are baked), the lit and shadow colours, the edge and the sky live; **Copy settings** copies them for `LOOK_DEFAULT`. The other levels keep the original lighting.

The level is built straight from the render set, `SE4_Asset Library/Sets/Fortress/RENDER_set_v05_sky.blend`, by `tools/build_fortress.py` (the command is at the top of the script):

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b "<SE4_Asset Library>/Sets/Fortress/RENDER_set_v05_sky.blend" --python tools/build_fortress.py -- models
```

It takes what the render camera sees, with every modifier (mirrors, solidify, booleans, arrays) and geometry-node scatter applied as in the render, and leaves out the cameras, the characters posed for the shots, the wrecked truck on the road, the render-only cannons and a grey placeholder box in the courtyard. It takes about two minutes, most of it Cycles baking the sun (on the GPU). It writes three files:

- `models/Fortress_v5.glb` is what you see: the fort, the terrain and the props whole, the heaviest plants simplified, objects merged by material, textures shrunk to JPEG, geometry Draco-compressed (about 10 MB). Each object has a second UV map and its baked sun mask as the material's occlusion texture. The LEDs and the computer screen glow. Textures the .blend points at but that have moved are looked up in the set's `Textures` folder, `tools/textures` (the computer screen's map, which isn't in the asset library any more) and the rest of the asset library.
- `models/Fortress_v5_sun.png` is where the sun reaches, every 0.5 m over the play area (`SUN_GRID` in the script; `levelFortress` in `index.html` has the same numbers): slices by height, nine to a row.
- `models/Fortress_v5_col.glb` is what everything collides with, shoots at and walks on: simplified terrain, the fort exact, props as boxes, no plants, the closed gate as a box named `Front_Gate`, and the way from the back corridor up to the wall walk trimmed open (`RAMPS` and `TRIM` in the script). Every staircase is a smooth ramp with walls down its sides, a little wider than its stairs; the steps under it, the edges of the floors at its ends and (for the tower's flights and the computer room's metal steps) the staircase itself are cut away, so nothing catches your feet. The props on the wall walk (crates, batteries) have no collision: you walk through them.

The earlier files were built from an intermediate export of the set that had lost its mirror modifiers (half of the courtyard's scrap truck, the tower's metal steps and other mirrored pieces were missing), and the terrain and computer room were simplified until they broke up.

### The Cargo Truck

`models/Cargo_Truck.glb` is built by `tools/build_truck.py` from the asset library's Cargo Truck. The intact truck comes from `Cargo_Truck_v3.blend` with its container switched on, and the wreck from `Cargo_Truck_v4_damage.blend`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_truck.py -- "<SE4_Asset Library>/Vehicles/Cargo Truck" models
```

The file holds the body, the wreck, a left and a right wheel, the steering wheel on its column, and empties for the wheel centres, the eight seats, the container's open back and three cover boxes (the script's header lists them). `vehicles.js` (`setModel`) reads it, so the truck drives on the model's own wheelbase, track and wheel size; until it has loaded, the truck is built from boxes as before. The metal texture (`Untitled_Artwork 1 copy 2.psd`) isn't in the asset library, so the metal parts use their tint colour.

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
| Cobray M11 | Small four-pointed star | One small light puff |

These are drawn in code for now. To use your own art, add PNGs to an `fx/` folder and set `img` for that gun in `GUN_FX` near the top of the script in `index.html`, for example `img: 'fx/carbine_flash.png'`. Suggested names are `fx/<gun>_flash.png` and `fx/<gun>_smoke.png`, where `<gun>` is `pistol`, `carbine`, `rifle`, `shotgun` or `cobray`.

- **Flash:** a square PNG (256×256 works well), centred, in full colour on a transparent or black background. It's drawn additively, so black shows as see-through. Each shot rotates it randomly.
- **Smoke:** a square, centred PNG of one soft puff on a transparent background. Draw it white or light grey, because `color` in `GUN_FX` tints it. Several puffs are spawned per shot, then rotated, grown and faded.
- `GUN_FX` also sets each gun's size, timing, puff count and drift, so you can tune those without new art. If a PNG fails to load, the built-in drawing stays and the console shows a warning.

## Cobray M11 (draft)

Mike's machine pistol (`models/Cobray_M11.glb`, modelled on a Cobray M11 in the style of James's guns and painted by Mike). It fires faster than the Midas Carbine for less damage per hit, so it kills about as fast up close, but it sprays more and loses accuracy sooner with distance; 32-round magazine, quicker reload. It uses the carbine's sound for now. It replaces one carbine pickup on Complex, Facility, Bunker and Minimal (Creek and Fortress are unchanged). The numbers are a first draft in `WEAPONS.cobray`.

To try it without hunting for the pickup, add `?give=cobray` to the address: you spawn with it every life (it works for any gun, e.g. `?give=rifle`).

## Controls

WASD move · Shift run · C crouch · Space jump · Left click shoot · Right click or X aim (X toggles; Ctrl-click is a right click) · R reload (it also reloads by itself when empty) · Q, wheel or 1–5 switch weapon · F or G grenade (hold to cook) · E use (computer, vehicle, take over a soldier), otherwise knife · M mute · Enter chat · Tab scores · Esc pause

Every action has a key, so a one-button Mac mouse or a trackpad can play everything. A scroll-wheel swipe switches weapon once, however long the swipe keeps scrolling. Short hints appear the moment they matter (the keys, low ammo, the wall walk, the computer, the vehicles) a few times per browser, then stop.
