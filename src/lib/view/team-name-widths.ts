// How wide each team's three names print in Schibsted Grotesk, in em: [full, short,
// code], measured in Chromium at weight 900 (the widest; lighter weights are narrower)
// with no letter-spacing, on 2026-11-10. TeamLink's "auto" form uses them to pick the
// longest name that fits its slot; the widths are upper bounds, so a form it picks
// never runs past the slot. Re-measure if the font or a team name changes
// (tests/view-routes.test.ts checks every team has a row).

/** [full, short, code] in em at weight 900. Keyed by ESPN team ID. */
export const TEAM_NAME_EM: Readonly<Record<string, readonly [number, number, number]>> = {
  "1": [7.52, 3.53, 2.01],
  "2": [7.31, 3.56, 2.17],
  "17": [7.22, 2.39, 2.29],
  "30": [9.17, 4.12, 2.28],
  "4": [6.89, 2.58, 1.99],
  "5": [10.21, 4.88, 1.96],
  "6": [8.86, 5.43, 2.12],
  "7": [8.12, 4.20, 2.19],
  "8": [7.63, 3.84, 2.14],
  "9": [11.31, 4.63, 2.50],
  "10": [8.61, 4.15, 2.31],
  "11": [7.78, 3.60, 2.05],
  "12": [5.93, 4.36, 2.11],
  "13": [9.78, 3.52, 2.00],
  "29": [9.44, 4.52, 2.60],
  "14": [5.80, 2.42, 2.24],
  "15": [9.01, 3.16, 2.08],
  "16": [13.03, 7.42, 2.27],
  "3": [11.14, 4.41, 2.28],
  "18": [8.54, 3.52, 2.25],
  "25": [12.09, 4.42, 2.22],
  "19": [7.46, 3.13, 2.11],
  "20": [9.56, 2.88, 1.98],
  "21": [6.90, 2.53, 2.30],
  "22": [11.18, 6.49, 2.22],
  "23": [9.30, 2.88, 2.15],
  "24": [9.35, 3.03, 2.12],
  "28": [8.28, 4.09, 2.20],
  "26": [5.01, 2.41, 2.17],
  "27": [10.57, 4.30, 2.45],
};
