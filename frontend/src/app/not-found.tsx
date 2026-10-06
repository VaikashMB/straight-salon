import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="placeholder">
      <h1>Page not found</h1>
      <p>
        <Link href="/">Back to home</Link>
      </p>
    </main>
  );
}
