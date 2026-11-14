// A sleeping hosted service needs longer than ordinary interactive requests.
export const loginSecurityAttemptTimeoutMs = 60_000;
export const loginSecurityTimeoutMs = loginSecurityAttemptTimeoutMs * 2 + 5_000;

export async function retryLoginSecurity<T>(
  check: () => Promise<T>,
  wait: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 1000))
): Promise<T> {
  try {
    return await check();
  } catch (error) {
    const failure = error as { code?: string; status?: number } | null;
    const temporary = failure?.code === "API_TIMEOUT" || failure?.code === "NETWORK_ERROR"
      || [408, 502, 503, 504].includes(failure?.status || 0);
    if (!temporary) throw error;
    await wait();
    return check();
  }
}
