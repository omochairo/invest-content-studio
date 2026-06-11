import { Easing, interpolate, useCurrentFrame } from "remotion";

/**
 * Animate a number from 0 up to `target` across [start, start+duration] frames,
 * easing out and clamping EXACTLY to `target` on/after the final frame so any
 * still captured at scene settle shows the true (load-bearing) value — never a
 * mid-tween approximation (AGENTS.md §3: numbers on screen are never wrong).
 *
 * Domain-agnostic: callers pass an already-validated number and format the
 * returned value with the SAME formatter they use statically, so the count-up
 * and the final reading agree to the digit. Negative targets count 0 -> target
 * (intermediate values stay on the correct side of zero).
 */
export function useCountUp(target: number, start = 0, duration = 22): number {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  // t is exactly 1 once frame >= start + duration, so the product is the exact
  // target (no floating drift) for the settled portion of the scene.
  return target * t;
}
