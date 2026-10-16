# Pose Kit status log

This is the log for the [plan](PLAN.md). Coding agents **append** one entry per run at the bottom. Never edit or delete
earlier entries, and never edit `PLAN.md`; Claude reads this log and updates the plan.

Entry template:

```
## YYYY-MM-DD: Phase N: <agent>
- Did:
- Done-when result: pass/fail + evidence (command output, what was checked)
- Commit:
- Problems / questions for Claude:
```

---

## 2026-10-16: Phase 1: Claude
- **Did:**
  - Added `tools/ffa_pose_kit.py` (add-on + `setup`/`export` CLI) and moved the shared `CHARS` table and helpers into `tools/chars.py`.
  - Blender 5 drops bone-parented empties on export, so the sockets are injected into the GLB afterwards.
- **Done-when result:** pass. Running `setup` and `export` for Soldier_2_heavy wrote `models/poses/Soldier_2_heavy.glb` (~179 KB).
- **Commit:** `de24491`
- **Problems:** the rest check failed because the exporter keeps extra Rigify parent bones. That was fixed by the amendment below.

## 2026-10-16: Phase 2 + amendment: Claude
- **Did:**
  - Added `tools/inspect_poses.py`, and switched its rest check to model space.
  - Export no longer leaves the Master's sleeve reparent in the open `.blend`.
- **Done-when result:** pass. Rest check OK, 68 shared nodes.
- **Commit:** `cb3f7a3`
- **Problems:** none.

## 2026-10-16: Phase 1 fix: Claude
- **Did:** export now reattaches the orphaned Rigify control bones (`FK-OS-Spine3`, `HIP-Spine1`, `CHST-Spine1`). three.js couldn't reach any DEF bone under them.
- **Done-when result:** pass. The poses GLB loads in three.js.
- **Commit:** `d3b8195`
- **Problems:** none.

## 2026-10-16: Phase 3: Claude
- **Did:**
  - The game loads `models/poses/<key>.glb` and retargets each clip in model space against the character's own skeleton.
  - Weapons sit in their per-weapon sockets, and bot muzzles are precomputed.
  - Austin posed Soldier_2_heavy's pistol in Blender and exported it, which confirmed the export pipeline.
- **Done-when result:** pass for the pistol.
- **Commit:** `a88443b`
- **Problems:** found by Claude in review and planned as Phase 3b:
  - clips nobody has posed yet are treated as real T-poses;
  - authored models never record `tpose`.

## 2026-10-16: Phase 3b: Codex
- Did: Read the current plan and implementation. Stopped before changing game code because the missing-hold behavior is unclear, as required by AGENTS.md.
- Done-when result: not run; phase blocked on the fallback decision below. No runtime or asset changes made.
- Commit: this entry is committed as `Phase 3b: log hold fallback clarification for Claude`.
- Problems / questions for Claude:
  - Phase 3b specifies `hold_<id>`, then `hold_carbine`, then any surviving `hold_*` as the hold fallback order. With only Soldier_2_heavy's pistol posed, that selects its authored pistol arm pose for all four weapons. The same phase's Done when requires the other three guns to use the procedural grip, and its socket rule says to use the procedural GRIPS path unless an authored hold exists for that weapon. Please specify whether missing weapon holds should reuse another authored arm pose with procedural weapon placement, or restore the original poseArms arm pose and procedural weapon placement. These produce different arm poses and require different fallback transforms/muzzle handling.
  - Once this is resolved, capture the T-pose before applying any pose, filter unposed clips, and implement the agreed fallback together so the phase can be verified against one consistent completion check.

## 2026-10-16: Phase 3b answer: Claude
- **Did:** answered Codex's fallback question by rewriting Phase 3b in PLAN.md (revision 2).
  - The decision is per weapon: an authored `hold_<id>` with `Socket_<id>` uses the Blender pose. Otherwise that weapon uses the original `poseArms` arm pose with `GRIPS` placement.
  - No borrowing another weapon's pose or socket; the `hold_carbine` and `sockets.carbine` fallbacks are removed.
  - `poseArms` runs for every library character, and its result is snapshotted as `model.procHold`.
- **Done-when result:** n/a (plan change only).
- **Commit:** see the commit that adds this entry.
- **Problems / questions for Claude:** none. Phase 3b is unblocked.

## 2026-10-16: Phase 3b: Codex (implementation, asset blocker)
- Did:
  - Captured character T-pose locals before posing, retained procedural holds for every library character, and added the specified per-weapon authored/procedural selection without borrowing sockets or holds.
  - Added unposed-clip filtering at the specified position/angle thresholds, synchronized death standing transforms when switching weapons, and restricted authored muzzle computation to matching holds and sockets while restoring the shared procedural scene afterwards.
  - Preserved procedural low-ready arm correction; authored holds use zero correction as in Phase 3.
- Done-when result: fail/blocked. JavaScript syntax and `git diff --check` pass. `python3 tools/inspect_poses.py Soldier_2_heavy` passes (68 shared nodes). Headless Chrome loads all seven characters without JavaScript page errors, but all six Eli clips survive the specified filter. Further implementation/verification stopped under AGENTS.md.
- Commit: this entry is committed with the implementation as `Phase 3b: implement per-weapon holds and document asset blocker`.
- Problems / questions for Claude:
  - The current `models/poses/Soldier_2_heavy.glb` has six clips with 213 tracks each whose output accessor bytes are identical across all six clips, including `hold_pistol`. Verified independently by reading the GLB JSON/binary chunks and comparing outputs by target node name and property. There is no distinct authored pistol in this checked-in asset to meet Done when.
  - In three.js r128, retargeting each clip produces the same four bone quaternion differences from the base T-pose: upper arms approximately 0.001231 radians, forearms approximately 0.001352–0.001354 radians (normalized comparisons); position differences are below 1.8e-7. Thus the plan's 1e-3 angle threshold retains every clip even though their animation data is identical. Please supply the intended authored pistol export and resolve the rest-pose angular discrepancy or revise the filtering rule. No threshold workaround, asset changes, or Phase 4 work was attempted.

## 2026-10-16: Phase 3b review: Claude
- **Did:** reviewed `3191f8c`. It implements rev 2 correctly.
- **Blockers resolved in PLAN.md (Phase 3b.1):**
  - **Threshold:** the unposed-clip threshold rises to 0.01 rad / 1e-3 m. Rigify's rest-sampling noise is about 0.0013 rad.
  - **Empty asset:** the pistol pose was never saved in `Soldier_2_heavy_poses.blend` (last saved 10:11), and the 11:30 re-export in `d3b8195` overwrote the GLB. Austin will re-pose, save and re-export.
- **Problems / questions for Claude:** none.

## 2026-10-16: Phase 3b.1: Codex (threshold fix verified)
- Did: Raised the unposed-clip thresholds in loadModels to 0.01 radians / 1e-3 metres, per the updated plan. No assets or later phases changed.
- Done-when result: partial pass; current all-unposed Eli asset now produces model.poses === null and no authored muzzle entries. Headless Chrome regression checks passed for all seven characters: shared procedural bone positions/quaternions matched fresh poseArms output; all four weapon grips and switching back to pistol matched the Phase 3 procedural branch; crouch/walk transforms matched; deaths completed with valid arm transforms; bot muzzle coordinates were finite. No JavaScript page errors. Inspector passed the rest/reachability checks (68 shared nodes); JavaScript syntax and git diff --check passed.
- Commit: this entry is committed with the threshold fix as `Phase 3b.1: tolerate Rigify rest noise in unposed clips`.
- Problems / questions for Claude: Authored-pistol verification remains pending. The current committed Soldier_2_heavy asset is still the all-unposed export identified in the preceding entries. Phase 3b.1 explicitly requires Austin to key, save, export and commit a real pistol pose before its authored checks can pass. Stopped here as directed; Phase 4 was not started.

## 2026-10-16: Plan change (Austin's decision): Claude
- **Did:** reviewed `da45bd6`; the threshold fix is correct, and 3b and 3b.1 are done. Austin decided no Blender posing happens during this plan, so every character keeps its current procedural pose.
  - Authored-path verification moves to a new Phase 3c: a `?posefixture` URL flag that builds synthetic authored poses for Soldier_2_heavy in code.
  - Phases 4 and 5 verify against that fixture too.
  - Real posing (Phase A) is deferred to animators.
- **Problems / questions for Claude:** none. Phase 3c is next and needs no assets.

## 2026-10-16: Phase 3c: Codex
- Did:
  - Added the immutable rotateAbout helper and a URL-gated Soldier_2_heavy hold_pistol fixture that raises root-level right-arm bones by -0.6 radians about X.
  - Built the pistol socket after weapon loading from the procedural grip matrix and the native weapon's yaw/recentre matrix. Other weapons receive no fixture entries, and the shared model scene remains procedural.
- Done-when result: pass. Headless Chrome compared every character against da45bd6 with no flag: bone transforms, all four weapon grips and bot muzzle points matched exactly. With ?posefixture, only Eli's pistol changed; the other three weapon results and the other six characters matched exactly. The pistol wrist rose 0.279943 m; wrist-local native grip matrices matched with zero error; the bot muzzle matched the rendered native barrel point within 5.6e-17 m; switching back to carbine restored procedural holds. Visual inspection confirmed the raised pistol follows the hand. No JavaScript page errors. JavaScript syntax and git diff --check passed. Verification script: /private/tmp/ffa-phase3c-check.cjs.
- Commit: this entry is committed with the implementation as `Phase 3c: add URL-gated authored pistol fixture`.
- Problems / questions for Claude: none. Phase 4 is ready for the next run; real pose exports remain deferred.

## 2026-10-16: Phase 4: Codex
- Did:
  - Added per-leg crouch targets from authored clips, separate walk/crouch blending, and clip-aware crouch-drop measurement. Procedural targets retain their original same-axis hinge arithmetic to preserve existing output exactly.
  - Added authored death interpolation for every clip bone, including translations, using current arm/upper standing transforms, leg rest transforms, existing ease/overshoot and settling wobble. Authored deaths skip the procedural limp hinges/diagonal twist and retain the backwards body fall.
  - Added URL-gated Eli fixture clips: crouch hinges at 1.3 times procedural angles, and T-pose arms with the left arm rotated +0.8 radians about Z plus legs at 1.5 times the limp angles.
- Done-when result: pass. Headless Chrome compared all seven characters against 70a3a94 without the flag: all sampled bone transforms, root crouch offsets and corpse rotations matched exactly across 80 crouch/walk transition frames and eight death samples. With ?posefixture, the other six characters still matched exactly. Eli's crouch drop increased from 0.463805 m to 0.706110 m; the leg targets matched the fixture, while upper holds remained procedural. Authored deaths started from the selected pistol hold and reached the arm targets, with correct leg interpolation/wobble and the original -pi/2 body fall. A temporary translated/rotated neck clip also verified non-arm/non-leg bones and position interpolation. Maximum quaternion error was below 6e-8 radians; position errors were zero. Visual comparison confirmed the deeper fixture crouch. No JavaScript page errors. JavaScript syntax and git diff --check passed. Verification scripts: /private/tmp/ffa-phase4-check.cjs and /private/tmp/ffa-phase4-visual.cjs.
- Commit: this entry is committed with the implementation as `Phase 4: blend authored crouch and death poses`.
- Problems / questions for Claude: none. Phase 5 is ready for the next run; no Blender work or asset changes were needed.

## 2026-10-16: Phase 5: Codex
- Did:
  - Added the ?posecheck character preview: opens directly into the arena menu, frames the full body, switches weapons with 1–4, toggles crouch with C and replays deaths with K. Weapon/crouch changes return to the live preview; character selection preserves the selected weapon/crouch state.
  - Added a corner label with the character, each hold/crouch/death source, active view, shortcuts and fixture indicator. Shortcuts ignore editable controls and gameplay; the label hides outside the preview menu.
  - Kept preview corpses in the preview scene and passed them explicitly to updateCorpses, leaving gameplay corpse state untouched. The death camera zooms out for the outstretched arms.
  - Added README's Posing characters (Blender Pose Kit) section, covering both-file add-on linking, setup, source-folder trailing space, key/save/export/inspect workflow, pose conventions, preview controls and test-only fixture behavior. Real posing remains deferred.
- Done-when result: pass. Headless Chrome exercised actual keyboard controls with ?posecheck and ?posecheck&posefixture, including Eli and stock Beto: four weapons, correct source labels, crouch blending, isolated corpse animation, repeated K cleanup, return to live preview, character switching, ignored text-field shortcuts and label hiding. Without the flag, all seven characters' bones/grips/muzzles matched 83e7560 exactly and no test UI appeared. Standing and death preview screenshots were visually inspected. No JavaScript page errors. JavaScript syntax and git diff --check passed. Verification script: /private/tmp/ffa-phase5-check.cjs.
- Commit: this entry is committed with the implementation as `Phase 5: add pose-check preview and animator documentation`.
- Problems / questions for Claude: none. Planned game phases are implemented; animator posing remains deferred per Austin's decision. PLAN.md was left unchanged for Claude to update.
