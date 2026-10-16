# Notes for coding agents

## Pose Kit work (character poses, weapon grips, crouch/death)

- **Read [docs/pose-kit/PLAN.md](docs/pose-kit/PLAN.md) first. Never edit it.** Claude owns the plan.
- **Do one phase per run:** the first one in the plan's Status table that isn't done.
  - Meet its "Done when", then commit with a message that starts with the phase, e.g. `Phase 3b: …`.
- **Then append an entry to [docs/pose-kit/STATUS.md](docs/pose-kit/STATUS.md)** using its template.
  - Append only; never edit or delete earlier entries.
  - Commit the entry with the phase's work.
- **If the plan is wrong, unclear or blocked, stop.** Log the problem in STATUS.md under "Problems / questions for Claude" instead of working around it.
- **Don't change behaviour for characters without a `models/poses/<Char>.glb`.** They must look exactly as before.

## Project

- **The game is a single file, `index.html`:** three.js r128 from a CDN, with no build step.
  - Run it with `python3 -m http.server` in the repo root and open `http://localhost:8000/`.
- **Models are in `models/`.** Blender build scripts are in `tools/`; use Blender 5.0.1 at `/Applications/Blender.app/Contents/MacOS/Blender`.
- **Leave alone what isn't yours.** Don't revert or reformat changes you didn't make, and don't touch `.claude/`.
