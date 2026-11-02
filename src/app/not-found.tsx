import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="pp-container py-20 text-center">
      <p className="kicker">404</p>
      <h1 className="headline mt-2 text-[32px] sm:text-[40px]">Nothing here</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-2">
        That page does not exist. The date may be outside the season, or the game or team may be written differently.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3 text-[14px]">
        <Link href="/" className="pp-button pp-button-primary">Today&apos;s games</Link>
        <Link href="/teams" className="pp-button">All teams</Link>
      </div>
    </main>
  );
}
