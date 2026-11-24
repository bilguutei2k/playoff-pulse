import { connection } from "next/server";
import { getLiveState, getSeasonLedger } from "@/lib/live-data/published";
import { recordCsv } from "@/lib/view/record-csv";

export const dynamic = "force-dynamic";

/**
 * The public record as a CSV file, from the same month files and versions the /record
 * page reads (src/lib/view/record-csv.ts), at request time like every page.
 */
export async function GET() {
  await connection();
  const [liveState, ledger] = await Promise.all([getLiveState(), getSeasonLedger()]);
  const versions = [
    liveState.modelVersion,
    ...(liveState.referenceModelVersion !== liveState.modelVersion ? [liveState.referenceModelVersion] : []),
  ];
  return new Response(recordCsv(ledger, versions), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="548-record-${liveState.seasonLabel}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
