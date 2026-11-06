# The Space Explorers

Browser free-for-all shooter built with three.js. Characters, weapons and props come from the Blender asset library (exported to `models/*.glb`).

## Title page

The game opens on a title page (`title.jpg`, a placeholder render of the fort; replace it with any image). Loading starts as soon as the page opens: the characters, the guns and the level you start on before **Play**, then the other levels behind the menu (a level picked before it's in shows **Loading level…** on Play). The **Fortress Free-For-All** is the game.

The other modes are for the host and for development. Add `?dev` to the address and the title page shows them too (it applies to that page load only):

- **Battle in the Arena**: free for all on Complex, Facility, Bunker or Creek.
- **Test Drive**: a little stadium oval with cars and motorcycles to drive, tune and crash, with friends (see below). It's where the vehicle mechanics get worked out before they go into the other games.

`?dev` also brings back the **Look** button in Settings. `?level=<name>` still opens a level directly.

Every menu (start, join, pause and round results) looks like the title page: big white heading, solid black buttons, over the title picture (or over the game while paused). It fits on one screen, and on a phone it stacks and scrolls.

- The fort's start screen: **Play**, **Copy invite link**, **How to play**, **Settings** and **‹ Back**, with your name, character and the chat beside them.
- **How to play** has the rules and the controls.
- **Settings** is all buttons: bots on each side, difficulty, mouse sensitivity (− / +), whether right click holds or toggles aim, god mode and proximity voice chat. Sensitivity and the aim setting are remembered in your browser.
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

## Sewer

Mike's map, a test blockout for 2 to 8 players (dev only: open it with `?dev&level=sewer`, or pick **Sewer** on the `?dev` title page). A walled hall over a sewer channel, three floors high:

- **Sewer (L1):** a walkway along each side of knee-deep water, with two crossings.
- **Second floor (L2):** an open floor under the platform and an east floor with six crates, split by an opening down to the water with a bridge across.
- **Top floor (L3):** a platform at the west end with two crates and two long ramps down. A short hallway leads to the rocket room, with a bazooka on its crate.
- **Outside the hall:** a long enclosed curved stair from the platform corner down to L2; a square stairwell shaft from the sewer to the top, wrapped round an open well; and the perch tower.
- **Perch tower:** a **lift** from the sewer up to L2, then a ladder up through a hatch to the perch, where the Master rifle is. The perch's window looks back over the hall.

The lift waits at the bottom. Stand on it and it rides up, waits until it's been empty a moment, then goes back down (`lifts` in a level's definition, `updateLifts`).

`tools/build_sewer.py` builds it (the command is at the top) into `models/Sewer.glb` and `models/Sewer_col.glb`. The game draws it like the arena levels. Its first argument scales the map across, keeping floor heights; `levelSewer`'s `SCALE` has to match it.

## Minimal + tunnel

Mike's third way into the fort, on a copy of the Minimal map (dev only while it's tried out: open it with `?dev&level=tunnel`, or pick **Minimal + tunnel** on the `?dev` title page; plain Minimal is unchanged). The fort now has three ways in: the front gate, James's back trail, and the tunnel.

- **Shed:** a square hole in the shed's floor opens on a shaft. Drop down it, or climb the ladder back up. The Master rifle waits in the shed's corner (the tunnel makes a long hallway for it); the bazooka moved out to the top of the hill in the middle, between the fort and the shed.
- **Tunnel:** about 52 m long, 2 m wide and 2.4 m tall, lit by bulbs on a wire. It runs level under the valley, then ramps up toward the fort.
- **Cellar:** under the fort's west wall, with crates and barrels.
- **Way in:** open stairs (nothing between the flights, so the two sides can shoot each other across the stairwell) wind up from the cellar to a wooden door in the back wall of the room left of the gate. E opens and shuts it from either side, and nobody can lock it. Bots open it (and the shed's doors) when their way goes through.
- **Bots' ways in:** Midas bots head into the fort by one of three ways, taken in turn as they spawn: the front twice in every four, then James's back trail, then the tunnel, so over a game half go in the front and a quarter each by the trail and the tunnel. Rebel bots hold their ground behind the shed as before. Tunnel bots drop down the hole (they can't climb the ladder, so for them the tunnel only leads into the fort). `fortRoutes`, `drops` and `navLinks` in `levelMinimalTunnel`; the last joins the narrow squeeze from the back door's corridor into the room behind it, which the bots' 0.5 m walking map misses.

It's built when the level loads (`TUNNEL_MINIMAL`, `buildTunnel`): `cutConvex` cuts the doorway, the stairwell, the cellar and the shaft out of the set (picture and collision alike), then the tunnel's pieces are added. To carry it over to the Fortress, the same description with Fortress's shed spot and ground heights should do.

## Fortress: the island to the south

The Fortress level (`?level=fortress`, the default) has grown (Austin's drawing). The fort and the old island are as they were; the island now carries on south around its old southern half, out to a new coast, and the shed is gone.

- **Spawns:** the Rebels start in clearing **A** (south-west) and Midas in clearing **B** (south-east), each reached by a road. Both sides' bots head for the fort from their clearings (`rebelsAdvance`; on Minimal + tunnel the Rebels hold their ground instead). The spawns behind the shed are gone; the road behind the hill (where Midas used to start) is a free-for-all spawn now. The jeep (the truck) is back where it always parked, on the road behind the hill, with the Master's rifle and a shotgun behind it. The valley is widened there (a level pad, `FORT_EXT.pads`, cut into the hillside by `regradeGround`) and the bots' walking map leaves out the spot the truck stands on, so they path round it instead of getting stuck.
- **Roads:** both branch off the road that runs from the fort's gate down the valley (A about 45 m down it, B at its end by the truck) and are levelled for vehicles: no steeper than 9%, 3.8 m wide, flat within 2.2 m of the middle. The old ground is cut and filled to them at load (`regradeGround`; the road profiles are `FORT_EXT`, printed by the build script), and the new ground is built to the same profile.
- **Mountain divider:** the old south hill carries on south as a steep rock spine to the south coast, so the two clearings can't see or walk to each other except round the north end (over the old hill, or up the roads). The bazooka is on its crest.
- **Bunker:** a small concrete door (the doorway and a little padding) in the west face of the hill west of the fort, tucked in beside the big tree and facing west (the room's floor is the ground by the door, 25.4). E opens and shuts the steel door from either side. From inside, hold E for 4 seconds at the shut door to lock it (a tap still opens it): it stays shut until someone inside taps E to unlock it, or it's shot open. While it's locked it has a health bar on both faces like the gate's (240 health, `FORT_BUNKER.lock`), anyone's bullets wear it down, and the bots whose way in is the tunnel, on any side but the one that locked it, walk up to it and shoot it (`siegeDoor`); the locker's own side go in by the front instead, and a bot out of ammo gives up and looks for some. Bots' paths treat a locked door as a wall. The host decides: guests send `blk` (lock done), `bhit` (a shot) and `sdoor` (E), and see the lock and its health in the snapshot (`bk`). Behind it is a small room (the Master rifle lies on its floor), and from the room a tunnel runs east, stays level under the hill, turns north and climbs and ends in the same cellar the shed's tunnel does on Minimal + tunnel, so the way up into the fort is the one there. Bots take it as their third way in (the front twice in every four, then the back trail, then the tunnel). Underground the Fortress's look is too dark, so the bunker, tunnel and cellar are unlit materials with the bulbs' light baked into their vertex colours (`bakeLight`).

The new ground is built by `tools/build_fortress_ext.py` (the command is at the top of the script): it adds a second ground mesh to the Fortress set, painted in the old ground's own palette (the dominant colours of its map: olive, dark olive, dark green, taupe, and the pale grey-pink of the road), and writes `models/Fortress_ext.glb` (picture, with its texture, and the roads) and `models/Fortress_ext_col.glb` (collision); the game adds them to the Fortress set when it loads. `tools/fortress_ext_terrain.py` has the shape: `DESIGN` is traced from the drawing (coast, divider, roads, clearings), and the new ground lies over the old, higher where it fills the old coast's banks and 0.6 m under it elsewhere, so the two meet without a seam. The hill over the bunker (`FORT_BUNKER.mound`) is made by `regradeGround` too, raising the old ground, with a level apron in front of the door (`mound.apron`): the door is cut into a cross slope that was a metre higher on its right than its left. The bunker, its tunnel and its door are built when the level loads (`FORT_BUNKER`, `buildBunker`, sharing `tunnelKit` and `buildCellar` with `buildTunnel`), and the Fortress's definition (`levelFortress`) has the spawns, pickups and the bots' ways in.

## The fort

The **Fortress** level (`?level=fortress`, the default) is James's hilltop fort on an island, played as a team free-for-all (Midas against the Rebels). (It started as a tower defense, Defend the Fort, with waves of pirates riding in by truck, a Master, an Apprentice and the Computer's cannon; that mode was taken out on 2026-11-03.)

- **The Computer** in the tower room: press **E** next to it for a map with everyone on it; **Space** opens or closes the gate.
- **Gate**: two doors at the courtyard end of the passage, swinging inward. While it's shut it has a health bar; Midas bots and everyone's shots wear it down until it gives way, and once it's been broken open it can't be shut again for 30 s. E at the open gate (or the computer) shuts it, whole again.
- **Leaning out**: press up against the parapet on the wall walk (or the tower room's front window) and look down, and your head goes out over the edge. Once you're out you can look left, right and up without pulling back in; step back from the wall to come in.
- **Tower door**: the doorway from the back corridor into the tower's lower stair room has a door, open at the start. A player presses **E** beside it to close and lock it (E again opens it). Bots pressed against it break it down in about 20 bot-seconds (two bots: 10 s); once broken it stays broken.
- **The roof**: in the computer room, walk up to the back window and press **E** to climb out onto a small balcony. A ladder beside the window goes up to the roof. E at the window climbs back in. Bots don't follow you up.
- An invisible fence runs along the rim of the valley between the fort and the hill so bots stay on the road side.
- The bots find their way on a walking map of every floor the host builds when the level loads (it leaves out anywhere a body wouldn't fit at head or waist height, such as along the side of a staircase).
- White health boxes in the courtyard, on the wall walk, in the back corridor and in the tower room.
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
- The host's browser runs the match: level, bots, difficulty and score limit, plus all scoring, pickups, grenades and gas cans.
- **Guests** opening the link only pick a name and character, then join.
- Networking is peer-to-peer WebRTC via [PeerJS](https://peerjs.com). The free public PeerJS server is used only to introduce players; game traffic goes directly between browsers, with a public TURN relay as a fallback for strict networks.
- If the host closes the tab, the match ends for everyone.

## Voice chat

Every player connects audio directly to every other player. The browser asks for microphone access when you join (guests) or when the first friend joins (host). Guests join with their mic muted. Press **M** to mute or unmute; on mobile use the **Mic** button. If mic access is denied you can still hear others.

**Proximity voice** is a host-only toggle in Settings (off by default). Off, everyone hears everyone at full volume, as above. On, you only hear players within a sphere around you: full volume up close, fading out, then silent past about 22 m. Moving apart on the map splits a group's chat into smaller ones; walking back together lets everyone hear each other again. The setting applies live for the whole match.

## Camera

Anyone can turn their camera on, any time, with **N** (or the **Cam** button on mobile); it needs no host setting. Everyone with a camera on gets a small tile in a grid at the top-left of the screen, like a video call's thumbnail strip, labelled with their name. A tile's border lights up while that player is talking (it uses the same mic feed as voice chat, so a muted player's tile doesn't light up). Camera video rides along the same connection as voice chat, so there's nothing extra to connect.

## Text chat

Press **Enter** to open the chat box, type, and press **Enter** again to send (Esc cancels). Messages appear for everyone in the kill feed. On mobile use the **Chat** button.

## Bullet holes and scorch marks

Shots leave bullet holes on walls and anything else they hit, so you can draw on walls by shooting. Grenades and gas cans leave a big black scorch mark on the floor and walls around the blast. Both stay for the whole round and clear when a new round starts or the level changes. Everyone sees everyone's marks, including players who join mid-round.

## Draw: the pen and the spray can

Press **P** (or **Draw** on the pause screen) to put your weapons away and take out a pen and a spray can; P again (or **Weapons**) brings your weapons back as they were. Everything is in `art.js` (`ART` in `index.html`).

- **Pen**: a click leaves a dot, and holding the button draws a line, on whatever is up to 3 m away.
- **Spray can**: each click puts down one big splatter, up to 8 m away. It's bigger and thinner the further you spray from (0.3 m across up close, about 1.1 m at 8 m). There are four splatter shapes, each turned at random.
- **Colours**: six (`PALETTE`: terracotta, mustard, slate blue, olive, black, white). **1–6** pick one, and each tool keeps its own. **Q** or the wheel switches tool. The HUD shows the tool and the colours, and the crosshair is the pen's dot or the splatter's size, in the colour (faint when out of reach). Paint never runs out.
- **What it sticks to**: everything you can see.
  - The level, and its doors: paint on a door swings with it.
  - Vehicles: it rides along.
  - Characters, others and bots: it moves with the body. When someone dies, their paint stays on the body and they come back clean.
- **Layers**: each click is a new layer, drawn over the ones before. Bullet holes go on top of paint, and paint goes on top of scorch marks.
- **How long it lasts**: until the round resets or the level changes, like the bullet holes. Past 1500 layers the oldest go.
- **Who sees it**: everyone sees everyone's paint as it's drawn, including players who join mid-round (`pl` messages, in pieces under 24 KB).
- **Safety**: while drawing, nothing hurts you but a fall, and bots leave you alone. With no weapons out you can't hurt anyone either.
  - The tools take a second to come out, and you're only safe once they're in your hand.
  - Going back to weapons ends the safety at once, and the gun takes a second to come up.
- **In hand**: you hold the tool in first person, and others see you holding it. The pen and the can are drawn in code (like the knife), and their caps take the colour.
- **On a phone**: Draw is on the pause screen. Fire paints, Swap switches tool, and you tap a colour in the column on the right.
- **Where it works**: every game but Test Drive. You can't paint from a seat where you couldn't shoot.

## Muzzle flash and smoke

Each gun has its own muzzle flash and smoke, seen on your own gun and on other players and bots:

| Gun | Flash | Smoke |
| --- | --- | --- |
| Laser Pistol | Red energy ring with thin spikes | Glowing red sparks |
| Midas Carbine | Four-pointed star | Small light puffs |
| Master Rifle | Big flash with long side jets | Large white plume that lingers |
| Battery Gun | Ragged fireball | Thick dark-grey cloud |
| Uzi | Small four-pointed star | One small light puff |
| Bazooka | Huge orange fireball | Big grey cloud out the back, and a trail behind the rocket |

These are drawn in code for now. To use your own art, add PNGs to an `fx/` folder and set `img` for that gun in `GUN_FX` near the top of the script in `index.html`, for example `img: 'fx/carbine_flash.png'`. Suggested names are `fx/<gun>_flash.png` and `fx/<gun>_smoke.png`, where `<gun>` is `pistol`, `carbine`, `rifle`, `shotgun`, `uzi` or `bazooka`.

- **Flash:** a square PNG (256×256 works well), centred, in full colour on a transparent or black background. It's drawn additively, so black shows as see-through. Each shot rotates it randomly.
- **Smoke:** a square, centred PNG of one soft puff on a transparent background. Draw it white or light grey, because `color` in `GUN_FX` tints it. Several puffs are spawned per shot, then rotated, grown and faded.
- `GUN_FX` also sets each gun's size, timing, puff count and drift, so you can tune those without new art. If a PNG fails to load, the built-in drawing stays and the console shows a warning.

## Uzi (draft)

Mike's machine pistol (`models/Cobray_M11.glb`, modelled on a Cobray M11 in the style of James's guns and painted by Mike; called the Uzi in game). It's the SMG: 16 shots a second for less damage per hit than the Midas Carbine, so it wins up close, but it sprays (0.20 hip spread at 40 m and beyond) and its bullets weaken with distance (full damage to 10 m, half from 30 m; `falloff` in `WEAPONS.uzi`, bots too). 32-round magazine, quicker reload. Its sound, `sounds/uzi.wav`, is original, made in code and levelled to match the carbine. The numbers are a first draft in `WEAPONS.uzi`.

It isn't on any map yet while it's being tuned. To try it, add `?give=uzi` to the address (or `&give=uzi` after an invite link): you spawn with it every life. It works for any gun, e.g. `?give=rifle`. A dropped Uzi can be picked up by others in that game.

## Headshots and the Master rifle

- **Master rifle:** a headshot kills, and so does a shot through the middle of the upper chest, from the front, back or side (the top half of the torso, its middle three quarters across and front to back, `core` in `makeBotMesh`). Anywhere else (stomach, arms, legs) takes half your health, so two of those kill. A bot's rifle hit kills about half the time.
- **Midas Carbine:** a headshot kills; a body hit does 22. Bots' carbine headshots still do 58 (`botHead`), so a lucky bot burst doesn't one-shot a player.
- **Fortress gate:** `hp: 800` (it was 2000, then cut by 60%). In the new weapon system (`range.js`) a shut gate and the locked bunker door take your bullets (each pellet's body damage × `DOOR_K` = 5, one hit per shot) and blasts (the ring damage × `DOOR_BLAST_K` = 10, so about 5 grenades break the gate and 2 the bunker door); the bots shoot them as before. The gate starts open in the new weapon system, so shut it first (E).
- **Stuck bots:** a bot that makes no headway for 1.5 s on its way somewhere (a lip the walking map thinks it can step, a parked truck) keeps off that spot for 20 s and plans another way (`walkFine`, `blockT` in `fortPath`).

## Controls

WASD move · Shift run · C crouch · Space jump · Left click shoot · Right click or X aim (X toggles; Ctrl-click is a right click) · R reload (it also reloads by itself when empty) · Q, wheel or 1–5 switch weapon · F or G grenade (hold to cook) · E use (computer, vehicle, take over a soldier), otherwise knife · P draw (pen and spray can) · M mute · N camera · Enter chat · Tab scores · Esc pause

Every action has a key, so a one-button Mac mouse or a trackpad can play everything. A scroll-wheel swipe switches weapon once, however long the swipe keeps scrolling. Short hints appear the moment they matter (the keys, low ammo, the wall walk, the computer, the vehicles) a few times per browser, then stop.

## Bazooka, grenade and shed (`tools/build_new_props.py`)

`models/Bazooka.glb`, `models/Grenade.glb` and `models/Shed.glb` are built from the sketches by a Blender script (no source file needed):

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python tools/build_new_props.py -- models
```

- **Grenade**: the thrown frag grenade (and the one in your hand while you cook it) now uses the model; it tumbles in flight.
- **Bazooka** (key 6, `?give=bazooka` to test): one rocket in the tube, 2 spare (4 at most; an ammo box adds one), 4.5 s reload. The rocket flies at 38 m/s and blows up on the first wall, soldier or truck it touches: 11.5 m blast, up to 240 damage (you take half from your own). A bazooka waits inside the shed on each map (on Minimal + tunnel, on the middle hill instead); it comes back 60 s after someone takes it, and dropped ones expire like other guns. Bots don't pick it up or use it yet.
- **Shed**: a 3.6 x 2.8 m hut you can walk into (`sheds: [[x, z, yaw], ...]` in a level's definition; the door faces +z at yaw 0). E at the door opens and shuts it (a shut door blocks movement, bullets and sight); bots open a shut door when their way goes through it. `shedCut: true` cuts away ground that pokes up through the floor (Minimal has it). A bulb lights the inside, and there is a window in the front and one in the back. A level's `clearTrees: [[x, z, r]]` removes the trees standing within r metres of a spot (the Fortress shed needed one). One stands in the field outside the fort on both Fortress and Minimal.

## Health and the dots over players' heads

Everyone has 32 health in the weapon system (`LIFE` in `range.js`; it was 40 until 2026-11-03, so 20% less), and damage saved in a browser from before is cut down to fit. The health circle over a player's head (blue full, red nearly gone) is the size of the letters of their name and shows only with the name, once your crosshair has rested on them a moment, fading in and out with it.

## Vehicles: the truck and the camera

The truck's default tuning is Austin's (`PRESETS.truck` in `vehicles.js`: 55 km/h top speed, 4460 kg, gentle suspension). The chase camera starts a little above and behind the vehicle (`CAM_PITCH` 0.25 rad, looking down about 22°) and stays wherever the mouse leaves it: it no longer swings back behind the vehicle after a second (V still switches between the chase and the seat views, each starting from its own default).

- **The truck is cover.** Its body stops bullets and sight lines, the bots' too (`TRUCK_ARMOR` and `armorRay` in `vehicles.js`; `castShot` and `losPts` in `index.html` ask it). The openings are the windshield, the two door windows (measured off the model: 2.42 to 2.78 m up) and the container's open back. In the cab you're covered below the window line, so a bot only ever sees your head (`VEH.inArmour` in `seenAt`). A passenger shoots out through the windows only, and someone in the back only out of the open end.
- **The back fills from the tailgate in**, so the first one aboard sits at the open end, where they can see out and shoot.
- **Seats aim where they look.** In a seat your shots go where the camera points, from your eyes. The cab's eyes sit higher than before (1.05 m above the seat), so you can see the road over the hood; the cars' too.
- **You can shoot from a bike**, from either view. Driving the truck or a car you still can't.

## Bots getting past each other

The bots' walking map doesn't know anyone is standing on it, so bots on one path used to pile up behind whoever stopped first (one fighting, one stuck at the closest spot to somewhere they can't reach), and body block kept them from walking through each other. Now (`avoidBots`, `ghostT` in `updateBot`, `bodyBlock`): a bot steps to the free side of anyone standing, slow or coming at it just ahead (only where there's room: not in a doorway or the tunnel); a bot held up for a moment by one of its own side walks through them for 2.5 s; and a bot cut off from the rest of the walking map for a few seconds (a pocket in a cliff it slid into) is put back on it (`FN.comp`). A bot that makes no headway for eight seconds is moved on along its path (`ai.jamT`), and nodes under a parked car, truck or bike are shut off for a couple of seconds (`markVehicles`) so paths go round it.

Paths also keep off steep banks: a node beside a slope too steep to stand on but not a wall (the cut bank on the inside of a road bend) costs extra in `fortPath` (`pen`, from `steepNear` in `buildFortNav`), because the shortest route cuts the corner onto the bank and the body is pushed back off it. Ten Midas bots spawned in clearing B used to stall one after another at the bend at about (20, 67) in the first ten seconds.
