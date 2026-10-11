export const serverBaseUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:8000";

export async function fetchWithFallback<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${serverBaseUrl}${path}`);
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

export async function postWithFallback<T>(
  path: string,
  body: unknown,
  fallback: T,
): Promise<T> {
  try {
    const response = await fetch(`${serverBaseUrl}${path}`, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

// Short names used by the Hangar/lessons/planner pages; same functions, no duplicate logic.
export const fetchFallback = fetchWithFallback;
export const postFallback = postWithFallback;
