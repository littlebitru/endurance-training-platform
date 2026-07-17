const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

type Tokens = { access: string; refresh: string };
export const tokenStore = {
  get: (): Tokens | null => { const value = localStorage.getItem("endurance_tokens"); return value ? JSON.parse(value) : null; },
  set: (tokens: Tokens) => localStorage.setItem("endurance_tokens", JSON.stringify(tokens)),
  clear: () => localStorage.removeItem("endurance_tokens"),
};

async function parseError(response: Response): Promise<string> {
  try { const body = await response.json(); return body.detail ?? Object.values(body).flat().join(" "); }
  catch { return `Request failed with status ${response.status}`; }
}

export async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const tokens = tokenStore.get();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (tokens?.access) headers.set("Authorization", `Bearer ${tokens.access}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (response.status === 401 && retry && tokens?.refresh) {
    const refresh = await fetch(`${API_URL}/auth/token/refresh/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: tokens.refresh }) });
    if (refresh.ok) { const next = await refresh.json(); tokenStore.set({ access: next.access, refresh: next.refresh ?? tokens.refresh }); return request<T>(path, options, false); }
    tokenStore.clear();
  }
  if (!response.ok) throw new Error(await parseError(response));
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  login: (username: string, password: string) => request<Tokens>("/auth/token/", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (data: Record<string, string>) => request("/auth/register/", { method: "POST", body: JSON.stringify(data) }),
  verifyEmail: (token: string) => request("/auth/verify-email/", { method: "POST", body: JSON.stringify({ token }) }),
  requestVerification: (email: string) => request("/auth/verify-email/request/", { method: "POST", body: JSON.stringify({ email }) }),
  requestPasswordReset: (email: string) => request("/auth/password-reset/", { method: "POST", body: JSON.stringify({ email }) }),
  confirmPasswordReset: (uid: string, token: string, new_password: string) => request("/auth/password-reset/confirm/", { method: "POST", body: JSON.stringify({ uid, token, new_password }) }),
  acceptInvitation: (token: string) => request(`/athlete-invitations/${token}/accept/`, { method: "POST" }),
  me: () => request<import("./types").User>("/users/me/"),
  plans: () => request<import("./types").Page<import("./types").TrainingPlan>>("/training-plans/?page_size=100"),
  athletes: () => request<import("./types").Page<import("./types").Relationship>>("/athletes/?page_size=100"),
  analytics: (athleteId?: number) => request<import("./types").Analytics>(`/coach/analytics/summary/${athleteId ? `?athlete_id=${athleteId}` : ""}`),
  invite: (email: string) => request("/athlete-invitations/", { method: "POST", body: JSON.stringify({ email }) }),
  createPlan: (data: object) => request("/training-plans/", { method: "POST", body: JSON.stringify(data) }),
  logWorkout: (data: object) => request("/workout-logs/", { method: "POST", body: JSON.stringify(data) }),
};
