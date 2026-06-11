import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansJP";
import { BRAND, SCENE_FADE_FRAMES } from "./theme";

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "800"],
  subsets: ["latin", "japanese"],
});

export const SceneTransition: React.FC<{
  durationInFrames: number;
  children: React.ReactNode;
}> = ({ durationInFrames, children }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, SCENE_FADE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - SCENE_FADE_FRAMES, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );
  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      {children}
    </AbsoluteFill>
  );
};

export const Bumper: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const min = Math.min(width, height);
  const sizeChannel = Math.max(32, min * 0.07);
  const sizeTitle = Math.max(24, min * 0.045);
  const sizeTagline = Math.max(18, min * 0.03);

  const op = interpolate(
    frame,
    [
      0,
      SCENE_FADE_FRAMES,
      durationInFrames - SCENE_FADE_FRAMES,
      durationInFrames,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b1220",
        fontFamily,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
        opacity: op,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: Math.max(20, min * 0.035),
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: sizeChannel, fontWeight: 800, color: "#fff" }}>
          {BRAND.channelName}
        </div>

        {/* Accent Bar */}
        <div
          style={{
            width: min * 0.15,
            height: Math.max(4, min * 0.006),
            background: "#4a8fe0",
            borderRadius: 4,
          }}
        />

        <div style={{ fontSize: sizeTitle, fontWeight: 700, color: "#9fb3c8" }}>
          {title}
        </div>
        <div
          style={{ fontSize: sizeTagline, fontWeight: 400, color: "#8aa0b2" }}
        >
          {BRAND.tagline}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  const min = Math.min(width, height);
  const sizePrimary = Math.max(28, min * 0.065);
  const sizeSecondary = Math.max(20, min * 0.045);
  const sizeChannel = Math.max(18, min * 0.035);

  const op = interpolate(
    frame,
    [
      0,
      SCENE_FADE_FRAMES,
      durationInFrames - SCENE_FADE_FRAMES,
      durationInFrames,
    ],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b1220",
        fontFamily,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: 40,
        opacity: op,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: Math.max(20, min * 0.035),
          textAlign: "center",
        }}
      >
        <div
          style={{ fontSize: sizePrimary, fontWeight: 800, color: "#4a8fe0" }}
        >
          {BRAND.ctaPrimary}
        </div>
        <div
          style={{ fontSize: sizeSecondary, fontWeight: 700, color: "#cdd9e5" }}
        >
          {BRAND.ctaSecondary}
        </div>

        {/* Short divider */}
        <div
          style={{
            width: min * 0.1,
            height: Math.max(2, min * 0.003),
            background: "#1b2838",
            borderRadius: 2,
            margin: "8px 0",
          }}
        />

        <div
          style={{ fontSize: sizeChannel, fontWeight: 700, color: "#8aa0b2" }}
        >
          {BRAND.channelName}
        </div>
      </div>
    </AbsoluteFill>
  );
};
