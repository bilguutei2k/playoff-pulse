// The roster-state model `live-2026.27-v4` (docs/live/registration-v4.md). Shadow only:
// v2 stays the published model (`LIVE_MODEL_VERSION` in params.ts). Nothing here is
// read by v1 or v2.
//
// Nothing under src/lib/season imports src/lib/score, so the 548 score's frozen Stage 1
// coefficients are copied here by hand; tests/roster-state-params.test.ts pins them to
// docs/score/fit.json (`primary.beta`) and the fitted values to docs/live/v4-fit.json.

export const V4_MODEL_VERSION = "live-2026.27-v4";

/** First ET date with v4 seals (shadow only). Moved by a commit before merging if the merge slips. */
export const V4_FIRST_ET_DATE: string | null = "2026-11-23";

/** sha256 of data/season/v4/warm-2026.bin.gz, the state after 2025-26 the live job starts from. */
export const V4_WARM_SHA256 = "f593a0ac0405da093813b26915a9f50efe50761ed21b72262405b9c68873c914";

/** The Stage 1 box counts, in coefficient order (`BOX_STATS` of src/lib/score/box-model.ts). */
export const V4_BOX_STATS = [
  "points",
  "fieldGoalsAttempted",
  "freeThrowsAttempted",
  "threePointersMade",
  "assists",
  "turnovers",
  "offensiveRebounds",
  "defensiveRebounds",
  "steals",
  "blocks",
  "fouls",
] as const;

/** Stage 1's primary coefficients, per 100 on-court possessions, in `V4_BOX_STATS` order. */
export const V4_BOX_COEFFICIENTS: readonly number[] = [
  0.48030929275536516, -0.41542755462374464, 0.0697059087738173, 0.7754914700092205, 0.7385756414415388,
  -0.8712462397697645, 0.2530402697150996, 0.21718030845939018, 1.1669162279062186, 0.40488243606508434,
  -0.3537907611499167,
];

/** Fixed by the plan (M1), not fitted. */
export const V4_FIXED = {
  b2b: 1.5,
  hcaPlayoffDelta: 1.5,
  marginCap: 30,
  /** Team minutes below this: the team-game takes the pseudo-player path. */
  usableTeamMinutes: 200,
  /** Box observation only for lines with at least this many minutes. */
  minBoxMinutes: 5,
  /** Pseudo-player weight for a team-game without usable lines. */
  pseudoWeight: 5,
  /** Running-average minutes of a player with no minutes history (not fitted; disclosed). */
  newPlayerMinutes: 12,
  /** Starting home-court state and variance, as v1 (not fitted). */
  hca0: 1,
  hcaVar0: 1,
  /** M5: regular-season games in the probit-scale window, and the minimum before it is used. */
  scaleWindow: 3000,
  scaleMinimum: 1000,
  /** M5: exact enumeration up to this many Questionable or Doubtful players, else seeded draws. */
  enumerateUpTo: 6,
  enumerationDraws: 256,
} as const;

// ---------------------------------------------------------------------------
// The frozen fit, copied from docs/live/v4-fit.json (frozen set: origin 2024-25, fitted on
// 2010-11 to 2023-24). Never refit; tests/roster-state-params.test.ts pins these to the file.
// ---------------------------------------------------------------------------

import type { GroupHazardTable, BackgroundParams } from "@/lib/season/availability-v4";
import type { V4RatingParams, StatusWeights } from "@/lib/season/roster-state";

export const V4_FROZEN: {
  ratings: V4RatingParams;
  background: BackgroundParams;
  statusTable: StatusWeights;
  hazards: GroupHazardTable;
  /** S2's H in days; null when S2 is not part of v4. */
  horizonDays: number | null;
} = {
  "ratings": {
    "sigma": 13.31,
    "sBox": 17.72727273,
    "qP": 0.003278688525,
    "qC": 0.015944049,
    "qH": 0.001382875219,
    "rhoP": 0.8,
    "qOff": 0.1526855713,
    "rhoC": 0.7125,
    "tauC": 0.4626519474,
    "muNew": -1,
    "tauNew": 2.44,
    "alpha": 0.3896794459,
    "kappa": 1
  },
  "background": {
    "halfLife": 1,
    "shrinkage": 320,
    "tierRates": [
      0.5666918324681751,
      0.7453209306922687,
      0.8249133847892375,
      0.869325547427574
    ]
  },
  "statusTable": {
    "O": 0.998950036205648,
    "D": 0.9834123222748815,
    "Q": 0.48272195640616694,
    "P": 0.18594000457980306,
    "A": 0.18594000457980306
  },
  "hazards": {
    "classTable": {
      "long": [
        0.34705882352941175,
        0.05970149253731343,
        0.025477707006369428,
        0.02441860465116279,
        0.025075225677031094,
        0.01236603462489695
      ],
      "short": [
        0.4314753396811811,
        0.29011194029850745,
        0.18154269972451792,
        0.09877399953735831,
        0.0554675118858954,
        0.02254791431792559
      ],
      "classUsed": true
    },
    "shrinkage": 5,
    "cells": {
      "injury:surgery": {
        "atRisk": [
          24,
          57,
          149,
          375,
          598,
          710
        ],
        "returns": [
          4,
          1,
          1,
          7,
          9,
          10
        ]
      },
      "injury:strain": {
        "atRisk": [
          225,
          369,
          470,
          364,
          125,
          49
        ],
        "returns": [
          47,
          61,
          63,
          47,
          12,
          2
        ]
      },
      "injury:tear": {
        "atRisk": [
          12,
          41,
          64,
          120,
          145,
          169
        ],
        "returns": [
          1,
          1,
          0,
          0,
          4,
          4
        ]
      },
      "injury:sprain": {
        "atRisk": [
          615,
          754,
          805,
          675,
          321,
          90
        ],
        "returns": [
          190,
          156,
          117,
          60,
          25,
          1
        ]
      },
      "injury:management": {
        "atRisk": [
          269,
          89,
          160,
          230,
          297,
          256
        ],
        "returns": [
          217,
          9,
          14,
          10,
          7,
          4
        ]
      },
      "injury:bruise": {
        "atRisk": [
          327,
          248,
          193,
          138,
          64,
          72
        ],
        "returns": [
          161,
          74,
          38,
          14,
          5,
          0
        ]
      },
      "admin": {
        "atRisk": [
          310,
          258,
          289,
          212,
          154,
          95
        ],
        "returns": [
          130,
          80,
          87,
          23,
          8,
          5
        ]
      },
      "injury:soreness": {
        "atRisk": [
          1068,
          858,
          645,
          449,
          207,
          20
        ],
        "returns": [
          527,
          250,
          101,
          33,
          14,
          1
        ]
      },
      "gleague": {
        "atRisk": [
          389,
          880,
          1229,
          1028,
          370,
          123
        ],
        "returns": [
          64,
          96,
          118,
          93,
          21,
          2
        ]
      },
      "injury:fracture": {
        "atRisk": [
          64,
          120,
          198,
          270,
          158,
          153
        ],
        "returns": [
          12,
          5,
          7,
          12,
          13,
          0
        ]
      },
      "protocols": {
        "atRisk": [
          269,
          522,
          359,
          36,
          14,
          21
        ],
        "returns": [
          20,
          73,
          101,
          6,
          0,
          1
        ]
      },
      "injury:other": {
        "atRisk": [
          181,
          221,
          246,
          302,
          184,
          24
        ],
        "returns": [
          62,
          50,
          21,
          15,
          7,
          2
        ]
      },
      "injury:acl": {
        "atRisk": [
          17,
          31,
          61,
          112,
          145,
          229
        ],
        "returns": [
          5,
          1,
          0,
          0,
          1,
          2
        ]
      },
      "injury:concussion": {
        "atRisk": [
          24,
          27,
          14,
          1,
          0,
          0
        ],
        "returns": [
          5,
          11,
          5,
          1,
          0,
          0
        ]
      },
      "unlisted": {
        "atRisk": [
          5206,
          4082,
          2713,
          745,
          0,
          0
        ],
        "returns": [
          2323,
          1509,
          632,
          123,
          0,
          0
        ]
      },
      "rest": {
        "atRisk": [
          112,
          3,
          2,
          0,
          0,
          0
        ],
        "returns": [
          93,
          1,
          0,
          0,
          0,
          0
        ]
      },
      "injury:illness": {
        "atRisk": [
          335,
          240,
          68,
          21,
          2,
          0
        ],
        "returns": [
          186,
          117,
          20,
          2,
          1,
          0
        ]
      },
      "injury:achilles": {
        "atRisk": [
          62,
          32,
          29,
          41,
          36,
          42
        ],
        "returns": [
          42,
          9,
          4,
          2,
          0,
          1
        ]
      },
      "injury:stress": {
        "atRisk": [
          8,
          12,
          37,
          64,
          70,
          47
        ],
        "returns": [
          3,
          0,
          1,
          0,
          3,
          0
        ]
      }
    }
  },
  "horizonDays": null
};
