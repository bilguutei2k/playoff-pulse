// The artifact the pipeline publishes. It is bundled at build time, and every
// pipeline commit triggers a new deployment.

import publishedState from "../../../data/live/state.json";
import type { LiveState } from "@/lib/season/types";

export const liveState = publishedState as unknown as LiveState;
