// The artifact the pipeline publishes. It is bundled at build time, and every
// pipeline commit triggers a new deployment. A state from before v2 is upgraded on
// read, so the site never breaks between a deploy and the job's next run.

import publishedState from "../../../data/live/state.json";
import { upgradeLiveState } from "@/lib/season/state-schema";
import type { LiveState } from "@/lib/season/types";

export const liveState: LiveState = upgradeLiveState(publishedState);
