# Jules Prompt Templates

High-fidelity prompts are the antidote to hallucinated, stubbed, or buggy outputs from autonomous coding agents. Use these templates to formulate precise, constrained prompts for Jules.

---

## 1. Computational Core / Algorithm Prompt

```markdown
Objective:
Implement 2D wall collision detection and raycasting in `src/engine/geometry.ts`.

Context & Interfaces:
- Follow existing data types defined in `src/types/index.ts` (`Point`, `Segment`, `SensorDef`).
- Coordinate system convention: Canvas 2D frame (Origin at top-left, +X points right/East, +Y points down/South).

Specific Requirements:
1. Implement `lineSegmentIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null` using vector cross-product math. Return null if segments are collinear or parallel.
2. Implement `castRay(origin: Point, angleRad: number, maxDist: number, walls: Segment[]): Point`.
3. Implement `computeSensorFOV(sensor: SensorDef, walls: Segment[]): Point[]` to compute a polygonal visibility polygon clipped by walls.

Constraints & Anti-Patterns:
- Do NOT modify `src/types/index.ts` or any files in `src/components/`.
- Do NOT stub functions with `// TODO` or placeholder returns.
- Handle edge cases: vertical lines ($x_1 = x_2$), rays grazing wall corners, zero-length segments.

Verification Requirement:
- Create unit tests in `tests/geometry.test.ts`.
- Cover orthogonal collisions, diagonal intersections, and field-of-view wall occlusions.
- Run `npm test tests/geometry.test.ts` and ensure all tests pass with exit code 0.
```

---

## 2. Benchmark Scenario / Dataset Fixture Prompt

```markdown
Objective:
Implement realistic forensic benchmark scenarios in `src/data/scenarios/eldercareFall.ts` and `src/data/scenarios/petDiscrimination.ts`.

Context & Interfaces:
- Adhere strictly to `ScenarioDef` and `SensorEvent` interfaces in `src/types/index.ts`.
- Sensor hardware coordinates are mounted on walls (`x: 0, y: 12`). Room Points-of-Interest (POI) are distinct physical points (`x: 2.0, y: 14.5`). Do not snap ground truth paths to wall mounts.

Specific Requirements:
1. `eldercareFall`:
   - Narrative: Resident walks from Bedroom to Bathroom, suffers a fall inside camera-free privacy blind spot, remains immobile for 45 minutes.
   - Kinematics: Walking speed 0.6 m/s. Dwell at `{x: 2.0, y: 14.5}` for 2700s.
   - Observations: PIR trigger at bathroom entry at T=0. No subsequent exit triggers.
2. `petDiscrimination`:
   - Narrative: 12 lb dog running erratically in Living Room.
   - Kinematics: High angular velocity (jitter > 100 deg/s), rapid direction reversals, non-human acceleration.
   - Observations: PIR motion with low amplitude, Amazon Vision AI Pet Filter classification.

Constraints & Anti-Patterns:
- Every waypoint timestamp must strictly obey kinematics: distance / time = realistic velocity.
- Do NOT generate synthetic random noise that violates wall boundaries.

Verification Requirement:
- Create `tests/scenarios.test.ts` verifying that `eldercareFall` and `petDiscrimination` pass kinematic feasibility checks and wall non-permeability.
- Run `npm test tests/scenarios.test.ts` with exit code 0.
```

---

## 3. UI Component / Dashboard Prompt

```markdown
Objective:
Implement `src/components/TimelineControls.tsx` for forensic trajectory playback.

Context & Interfaces:
- Connect to existing state props: `currentTime`, `duration`, `isPlaying`, `speedMultiplier`, `onSeek(t)`, `onTogglePlay()`, `onSetSpeed(m)`.
- Use existing Tailwind CSS and Lucide React icons (`Play`, `Pause`, `RotateCcw`, `FastForward`).

Specific Requirements:
1. Render a responsive timeline scrub bar showing current timestamp format `MM:SS` vs total `MM:SS`.
2. Provide speed multiplier selector ($0.5\times, 1\times, 2\times, 5\times$).
3. Include keyboard shortcut listener: Spacebar toggles play/pause, Left/Right arrow keys scrub by $\pm 5$ seconds.

Constraints & Anti-Patterns:
- Do NOT install additional UI libraries or icon packages.
- Ensure event listeners are properly cleaned up in `useEffect` returns to prevent memory leaks.
- Do NOT touch canvas rendering logic or engine modules.

Verification Requirement:
- Create component tests in `tests/TimelineControls.test.tsx` using React Testing Library.
- Test play/pause toggle, scrub input change, and speed multiplier selection.
- Run `npm test tests/TimelineControls.test.tsx` with exit code 0.
```

---

## 4. Isolated Bug Fix / Test Repair Prompt

```markdown
Objective:
Fix failing tests in `tests/sensorDegradation.test.ts`.

Context:
- Vitest reports 2 failures:
  1. "flags unobserved transit when sensor fails to trigger" - expected status 'DEGRADED', got 'HEALTHY'.
  2. "calculates battery voltage sag probability" - expected probability > 0.85, got 0.0.

Instructions:
1. Inspect `src/engine/degradation.ts` and `tests/sensorDegradation.test.ts`.
2. Identify why the transit counter is not decrementing sensor health when an inferred particle path traverses the sensor's active polygon.
3. Fix the sensor polygon containment check in `src/engine/degradation.ts`.
4. Ensure voltage sag Bayesian update correctly factors battery voltage below 2.9V.

Constraints:
- Do NOT alter test expectations unless the test asserts mathematically incorrect behavior.
- Do NOT touch `src/engine/geometry.ts` or UI files.

Verification Requirement:
- Run `npm test tests/sensorDegradation.test.ts` and verify 100% passing tests.
```
