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
