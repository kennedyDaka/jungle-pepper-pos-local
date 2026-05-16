export function LoadingState({ label = "Loading data..." }: { label?: string }) {
  return <p className="text-sm text-muted-foreground">{label}</p>;
}

export function ErrorState({
  error,
  label = "Could not load data",
}: {
  error: unknown;
  label?: string;
}) {
  const message = error instanceof Error ? error.message : label;
  return <p className="text-sm text-destructive">{message}</p>;
}
