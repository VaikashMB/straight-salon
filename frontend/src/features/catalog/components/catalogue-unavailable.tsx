// Shown when the API cannot be reached while rendering a public page.
export function CatalogueUnavailable() {
  return (
    <section className="mx-auto grid max-w-xl gap-3 px-4 py-20 text-center">
      <h1 className="text-3xl font-semibold">We&apos;ll be right back</h1>
      <p className="text-muted-foreground">
        Our menu can&apos;t be loaded at the moment. Please try again in a few minutes, or call the
        salon to book.
      </p>
    </section>
  );
}
