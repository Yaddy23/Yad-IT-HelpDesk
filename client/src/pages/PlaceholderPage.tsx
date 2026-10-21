/** Generic placeholder for modules arriving in later phases. */
export default function PlaceholderPage({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">This module is planned for {phase}.</p>
      </div>
    </div>
  );
}
