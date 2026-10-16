# Pose Kit plan

> **Owned by Claude.** Coding agents (Codex and others): **read only, never edit this file.** Log every run in
> [STATUS.md](STATUS.md); Claude reads that log and updates this plan. Rules for agents are in [AGENTS.md](../../AGENTS.md).

## Status

| Phase | What | State | Commits |
|---|---|---|---|
| 1 | Blender pose kit add-on + CLI (`tools/ffa_pose_kit.py`) | done | `de24491`, `cb3f7a3`, `d3b8195` |
| 2 | GLB inspector (`tools/inspect_poses.py`) | done | `de24491`, `cb3f7a3` |
| 3 | Game: hold poses + weapon sockets | done | `a88443b` |
| 3b | Game: per-weapon fallback, ignore unposed clips, keep T-pose (rev 2, unblocked) | **next** | — |
| 4 | Game: crouch + death from clips | after 3b | — |
| 5 | `?posecheck` view + README docs | after 4 | — |
| A | Animators: pose every character and gun | ongoing, in Blender | — |

Run the first phase that isn't done. 3b → 4 → 5 all edit `index.html`, so run them one at a time.

## Context

The game used to pose every character in code. `poseArms()` solves one carbine grip by two-bone IK. `GRIPS` nudges the guns, and `CROUCH_POSE` and `LIMP_POSE` are hardcoded hinge angles. Animators now pose each character in Blender with the Rigify controls in its source `.blend`:
- one hold pose and in-hand gun placement per weapon (pistol, carbine, rifle, shotgun)
- a crouch pose
- a death pose

The pose kit exports these to `models/poses/<Char>.glb`, and the game reads that file. A character without one keeps the old procedural poses.

First-person viewmodel placement is out of scope.

## What exists (Phases 1–3)

**Files**

- `tools/chars.py` is the shared `CHARS` table (character → source blend, rig, meshes) plus the Blender helpers. `build_characters.py` and `ffa_pose_kit.py` both import it.
- `tools/ffa_pose_kit.py` works as a Blender add-on (the N-panel "FFA Pose Kit" tab) and as a CLI:
  ```bash
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/ffa_pose_kit.py -- setup|export "/Users/austinhermann/Downloads/Asset Library/00_Exports " "/Users/austinhermann/Documents/GitHub/ffa-prototype" [Char ...]
  ```
  The source folder name **ends in a space**, so keep the quotes.
  - **`setup`** writes `<SRC>/Poses/<Char>_poses.blend`, a copy of the source blend that is never written back. The copy gets:
    - six single-frame actions: `hold_pistol`, `hold_carbine`, `hold_rifle`, `hold_shotgun`, `crouch`, `death`;
    - a muted NLA track named after each action;
    - `Socket_<weapon>` empties on `DEF-Wrist.R`;
    - preview guns parented to the sockets, in the `PoseKit_Preview` collection;
    - a `PoseKit_Anchor` triangle mesh, so the exporter takes the skin path.
  - **`export`** writes `models/poses/<Char>.glb`, then patches two things into the file:
    - the sockets, which Blender 5 drops from bone-parented empties;
    - the orphaned Rigify control bones, reattached so three.js can reach them (`d3b8195`).
- `tools/inspect_poses.py <Char>` prints the clips and sockets, and runs a rest check in **model space** against `models/<Char>.glb`. It exits non-zero on a mismatch.

**`index.html`**, around L1324–1460:
- `parsePoses(key)` returns the whole gltf, or null for a character with no poses file.
- `poseDefaults` and `applyClipFirstFrame` pose the poses scene from a clip's first keyframe.
- `retargetToCharacter` re-derives each bone's local transform against **its parent in the character's own skeleton**. The poses GLB keeps extra Rigify parents (`HIP-Spine1`, `CHST-Spine1`, `FK-OS-Spine3`, `FK-Shoulder.R`), so raw local transforms are never copied.
- `socketLocalMatrix` reads each socket's local matrix.
- `nativeMuzzlePoint` and `computeModelGuns` compute `model.guns[id].muzzle` for bots.
- `loadModels` sets these when a poses file exists:
  - `model.poses = { <clip>: { <sanitised bone name>: {pos, quat} } }`;
  - `model.sockets = { <weapon>: Matrix4 }`;
  - `poseArms` is skipped, and `hold_carbine` is baked onto the shared scene.
- `setRigWeapon` (~L1512): when `m.poses` exists, it writes `hold_<id>` (falling back to `hold_carbine`) into `rig.upper[].rest/pos`. It seats a plain clone of the weapon (native frame, no `centeredClone`) under the wrist using the socket matrix.
- `botMuzzle` uses `m.guns` when it is present.

**Conventions**
- three r128's GLTFLoader strips `.` from names and turns spaces into `_`: `DEF-Wrist.R` → `DEF-WristR`. Socket and action names use only `[A-Za-z0-9_]`.
- **Weapon native frame:** guns sit under the socket as authored in their own GLB, with no recentring and no `orientWeapon` yaw. The shotgun is the group `makeShotgun()` returns.
- Use Blender 5.0.1 at `/Applications/Blender.app`. Exporter option names change between versions.

## Phase 3b: per-weapon fallback, ignore unposed clips, keep the T-pose (next)

This is revision 2. It answers Codex's 2026-10-16 question in STATUS.md, because revision 1 contradicted itself.

**The rule: every weapon decides on its own.**
- If `hold_<id>` is authored (posed), use that clip's arm pose and seat the gun on `Socket_<id>`.
- Otherwise use the original procedural hold for that weapon: the `poseArms` arm pose, with `GRIPS` / `gunHand` placement.
- **Never borrow another weapon's authored pose or socket.** The `hold_carbine` fallback and the `m.sockets.carbine` fallback are removed.

Animators fill in weapons one at a time, and each one switches over as soon as it's posed.

**Steps in `index.html`:**

1. **Capture the T-pose first.** In `loadModels`, for every model with `DEF-WristR`, record `tpose` before any pose is applied. Use the same regex as `poseArms` (L1263–1264). This also fixes deaths for authored models.
2. **Run the procedural pose for every library character, whether or not it has a poses file.**
   - Run `poseArms(sc)` and keep its outputs on the model as today: `gunDir`, `gunHand`, `gunBoneInv`, `gunBoneName`, `muzzle`, `sway = true`.
   - Snapshot the posed bones as `model.procHold = { <bone name>: {pos, quat} }` for every bone, read from `sc` right after `poseArms`.
   - The shared scene stays in this procedural pose. **Don't bake `hold_carbine` onto it any more.**
3. **Drop unposed clips.**
   - After retargeting, delete any clip in which every bone's quaternion is within 1e-3 rad of the T-pose local quaternion and every position is within 1e-4 of it.
   - Compare against the character's T-pose locals, captured before step 2.
   - If no clips survive, set `model.poses = null`.
4. **`setRigWeapon(rig, id)`:** set `authored = m.poses && m.poses['hold_' + id] && m.sockets && m.sockets[id]`.
   - **Authored:** write the clip into `rig.upper[].rest/pos` and seat a native clone of the gun under `m.sockets[id]` (the current authored branch, minus the fallbacks).
   - **Otherwise:** write `m.procHold` into `rig.upper[].rest/pos`, then run the existing `GRIPS` path unchanged.
   - Either way, update the matching `rig.armBones[].stand` as well, so the death pose starts from the hold the character actually has.
5. **`computeModelGuns`:**
   - Compute `m.guns[id]` only for authored weapons.
   - Bake `m.procHold` back onto the shared scene when it's done, instead of `hold_carbine`.
   - `botMuzzle` already falls back to the `gunHand` / `gunDir` formula when `m.guns[id]` is missing; keep that.

**Done when:**
- Soldier_2_heavy holds the pistol in its Blender pose.
- Its carbine, rifle and shotgun use exactly the old procedural arm pose and grip, the same as a stock character's.
- Its death flings the arms out like the stock characters.
- Characters without a poses file look unchanged.
- Bot tracers start at the muzzle for both the authored pistol and the procedural guns.

## Phase 4: crouch + death from clips

The clips are already in `model.poses.crouch` and `model.poses.death` once Phase 3b has dropped the unposed ones, retargeted to character-local `{pos, quat}`.

1. **Crouch**
   - In `makeRig`, give each `LEG_BONES` entry a `bn.crouch` quaternion:
     - the `crouch` clip's value for that bone if one exists;
     - otherwise `rest × axisAngle(axis, CROUCH_POSE[k])`.
     - `DEF-FootL/R` may be added to `bones` as crouch-only bones the same way.
   - Change `setBone(bn, ang)` to `setBone(bn, ang, C = 0)`, setting `q = slerp(rest, crouch, C) × axisAngle(axis, ang)`.
   - In `animRig`, pass the walk angle and `C` separately, so the `C * CP.x` terms go away. For non-authored models this is identical to today, so check that a stock character crouches exactly as before.
   - `measureCrouch` uses `setBone(b, 0, 1)` / `setBone(b, 0, 0)`.
   - Only the legs come from the clip. The upper-body crouch lean stays procedural in `poseUpper`.
2. **Death** (`updateCorpses`), for models with a `death` clip:
   - Slerp every bone in the clip from its standing pose to the clip value, using the existing ease and overshoot `k`.
     - Upper bones go from `armBones[].stand` (or `upper[].rest`) to the clip.
     - Leg bones go from `rest` to the clip by `f`, plus the existing wobble.
   - Skip `LIMP_POSE` and the hardcoded "diagonal arms" twist.
   - The backwards fall (`c.w.rotation.x`) stays procedural. **Death is posed standing upright** in Blender, and the game tips the body over.

**Done when:**
- A character with posed `crouch` and `death` clips crouches and dies into its Blender poses.
- Characters with neither clip, or without a poses file, behave exactly as before.

## Phase 5: check view + docs

1. **`?posecheck` URL flag**, in the character preview (`setPreview`, ~L3351):
   - keys `1–4` call `setRigWeapon(prev.rig, ['pistol','carbine','rifle','shotgun'][n-1])`;
   - `C` toggles crouch (drive `animRig` with crouch true);
   - `K` spawns a corpse of that model at the preview spot;
   - a corner label shows the character name and which clips are authored or procedural.
2. **`README.md`:** add a "Posing characters (Blender Pose Kit)" section under Characters, covering the animator handoff below.

**Done when:** `?posecheck` works for an authored and a non-authored character, and the README section exists.

## Animator handoff (Phase A, ongoing)

1. **Install the add-on by linking it, not with "Install from Disk".** Install from Disk copies only one file, and the add-on also needs `chars.py`:
   ```bash
   ln -s /Users/austinhermann/Documents/GitHub/ffa-prototype/tools/ffa_pose_kit.py "$HOME/Library/Application Support/Blender/5.0/scripts/addons/"
   ```
   ```bash
   ln -s /Users/austinhermann/Documents/GitHub/ffa-prototype/tools/chars.py "$HOME/Library/Application Support/Blender/5.0/scripts/addons/"
   ```
   Then restart Blender and enable **FFA Pose Kit** under Preferences → Add-ons.
2. **Run `setup` once per character.** Pose files exist for Soldier_2_heavy and Master; still to do are Soldier_3_thin, Soldier_4_bigframe, Soldier_5_smallframe, Apprentice and Officer.
3. **Pose in `<SRC>/Poses/<Char>_poses.blend`:**
   - Press N and open the FFA Pose Kit tab. Pick a weapon, pose it with Rigify at frame 1, facing the gun along Blender **−Y** and keeping it level.
   - Move and rotate `Socket_<weapon>` to seat the gun. Move the socket, never the preview gun.
   - Press **Key Pose**, and always key before switching to another pose.
   - Crouch: only the legs are used. Death: pose it standing; the game tips the body over.
4. **Export and check:**
   - Press **Export Poses** (set the Game folder once), then run `python3 tools/inspect_poses.py <Char>`. Commit `models/poses/<Char>.glb`.
   - Any weapon left unposed keeps the procedural hold once Phase 3b lands, so partial work is safe to commit.

## Verification (end to end)

1. `python3 tools/inspect_poses.py Soldier_2_heavy` passes the rest check and lists 6 clips and 4 sockets under `DEF-Wrist.R`.
2. Serve the game with `python3 -m http.server` in the repo and open `?posecheck` (after Phase 5).
   - Step through each weapon, crouch and death, for one authored and one stock character.
3. In a Free-for-all round, check:
   - bots hold their guns correctly;
   - tracers start at the muzzle;
   - pickups and the first-person view are unchanged;
   - the console shows no errors (a missing poses file must stay silent).
