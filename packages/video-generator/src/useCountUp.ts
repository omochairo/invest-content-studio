import { Easing, interpolate, useCurrentFrame } from "remotion";

/**
 * Pure count-up: a number eased from 0 up to `target` across
 * [start, start+duration] frames, clamping EXACTLY to `target` on/after the
 * final frame so any still captured at scene settle shows the true
 * (load-bearing) value — never a mid-tween approximation (AGENTS.md §3:
 * numbers on screen are never wrong).
 *
 * This is the pure form (frame passed in) so it can be called inside a `.map()`
 * over bars/points without breaking the rules of hooks — the caller reads the
 * frame once with useCurrentFrame() and feeds a per-item `frame - i*stagger`.
 *
 * Domain-agnostic: callers pass an already-validated number and format the
 * returned value with the SAME formatter they use statically, so the count-up
 * and the final reading agree to the digit. Negative targets count 0 -> target
 * (intermediate values stay on the correct side of zero).
 */
export function countUp(target: number, frame: number, start = 0, duration = 22): number {
  const t = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  // t is exactly 1 once frame >= start + duration, so the product is the exact
  // target (no floating drift) for the settled portion of the scene.
  return target * t;
}

/** Hook form for a single value (reads the current frame for you). Do NOT call
 *  this inside a loop — use the pure `countUp` with a shared frame there. */
export function useCountUp(target: number, start = 0, duration = 22): number {
  return countUp(target, useCurrentFrame(), start, duration);
}
