// Starts the in-process backend (and its background timers) when the server boots,
// instead of on the first request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getApi } = await import("./server");
  getApi();
}
