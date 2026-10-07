// Runs `task` at most once at a time: callers that arrive while it is running share the same
// promise (05 §5: parallel 401s trigger one refresh, not a stampede). The next call after it
// settles starts a new run.
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    inFlight ??= task().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
