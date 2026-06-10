import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// public/ holds the TTS output (audio/*.wav, audio/manifest.json).
Config.setPublicDir("public");
