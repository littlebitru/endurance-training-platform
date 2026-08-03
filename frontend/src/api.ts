const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

type Tokens = { access: string };
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export const tokenStore = {
  get: (): Tokens | null => accessToken ? { access: accessToken } : null,
  set: (tokens: Tokens) => { accessToken = tokens.access; },
  clear: () => { accessToken = null; },
};

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/token/refresh/`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then(async (response) => {
      if (!response.ok) return null;
      const next = await response.json() as Tokens;
      tokenStore.set(next);
      return next.access;
    }).catch(() => null).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.detail ?? Object.values(body).flat().join(" ");
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const tokens = tokenStore.get();
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (tokens?.access) headers.set("Authorization", `Bearer ${tokens.access}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
  if (response.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, options, false);
    tokenStore.clear();
  }
  if (!response.ok) throw new Error(await parseError(response));
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function requestBlob(path: string, retry = true): Promise<{ blob: Blob; filename: string }> {
  const tokens = tokenStore.get();
  const headers = new Headers();
  if (tokens?.access) headers.set("Authorization", `Bearer ${tokens.access}`);
  const response = await fetch(`${API_URL}${path}`, { headers, credentials: "include" });
  if (response.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return requestBlob(path, false);
    tokenStore.clear();
  }
  if (!response.ok) throw new Error(await parseError(response));
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "workout.fit";
  return { blob: await response.blob(), filename };
}

export const api = {
  login: (username: string, password: string) => request<Tokens>("/auth/token/", { method: "POST", body: JSON.stringify({ username, password }) }),
  restoreSession: refreshAccessToken,
  logout: () => request<void>("/auth/logout/", { method: "POST", body: "{}" }, false),
  register: (data: Record<string, string>) => request("/auth/register/", { method: "POST", body: JSON.stringify(data) }),
  verifyEmail: (token: string) => request("/auth/verify-email/", { method: "POST", body: JSON.stringify({ token }) }),
  requestVerification: (email: string) => request("/auth/verify-email/request/", { method: "POST", body: JSON.stringify({ email }) }),
  requestPasswordReset: (email: string) => request("/auth/password-reset/", { method: "POST", body: JSON.stringify({ email }) }),
  confirmPasswordReset: (uid: string, token: string, new_password: string) => request("/auth/password-reset/confirm/", { method: "POST", body: JSON.stringify({ uid, token, new_password }) }),
  acceptInvitation: (token: string) => request(`/athlete-invitations/${token}/accept/`, { method: "POST" }),
  me: () => request<import("./types").User>("/users/me/"),
  plans: () => request<import("./types").Page<import("./types").TrainingPlan>>("/training-plans/?page_size=100"),
  athletes: () => request<import("./types").Page<import("./types").Relationship>>("/athletes/?page_size=100"),
  thresholds: (athleteId?: number) => request<import("./types").Page<import("./types").AthleteThreshold>>(`/athlete-thresholds/?page_size=100${athleteId ? `&athlete=${athleteId}` : ""}`),
  trainingZones: (athleteId?: number, sport?: string) => request<import("./types").Page<import("./types").TrainingZone>>(`/training-zones/?page_size=100${athleteId ? `&athlete=${athleteId}` : ""}${sport ? `&sport=${sport}` : ""}`),
  createThreshold: (data: object) => request<import("./types").AthleteThreshold>("/athlete-thresholds/", { method: "POST", body: JSON.stringify(data) }),
  updateThreshold: (id: number, data: object) => request<import("./types").AthleteThreshold>(`/athlete-thresholds/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  analytics: (athleteId?: number) => request<import("./types").Analytics>(`/coach/analytics/summary/${athleteId ? `?athlete_id=${athleteId}` : ""}`),
  athleteAnalytics: () => request<import("./types").Analytics>("/athlete/analytics/summary/"),
  performanceInsights: (athleteId?: number, dateFrom?: string, dateTo?: string, sport?: string) => {
    const params = new URLSearchParams();
    if (athleteId) params.set("athlete_id", String(athleteId));
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (sport) params.set("sport", sport);
    const query = params.toString();
    return request<import("./types").PerformanceInsights>(`/performance/insights/${query ? `?${query}` : ""}`);
  },
  wellnessCheckIns: (dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams({ page_size: "100" });
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    return request<import("./types").Page<import("./types").WellnessCheckIn>>(
      `/wellness-check-ins/?${params.toString()}`,
    );
  },
  createWellnessCheckIn: (data: object) => request<import("./types").WellnessCheckIn>(
    "/wellness-check-ins/",
    { method: "POST", body: JSON.stringify(data) },
  ),
  updateWellnessCheckIn: (id: number, data: object) => request<import("./types").WellnessCheckIn>(
    `/wellness-check-ins/${id}/`,
    { method: "PATCH", body: JSON.stringify(data) },
  ),
  deleteWellnessCheckIn: (id: number) => request<void>(
    `/wellness-check-ins/${id}/`,
    { method: "DELETE" },
  ),
  recoveryInsights: (athleteId?: number, days: 14 | 28 | 90 = 28) => {
    const params = new URLSearchParams({ days: String(days) });
    if (athleteId) params.set("athlete_id", String(athleteId));
    return request<import("./types").RecoveryInsights>(`/wellness/insights/?${params.toString()}`);
  },
  recoveryRoster: () => request<import("./types").RecoveryRoster>("/wellness/roster/"),
  calendar: (dateFrom: string, dateTo: string, athleteId?: number, sport?: string) => {
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (athleteId) params.set("athlete_id", String(athleteId));
    if (sport) params.set("sport", sport);
    return request<import("./types").TrainingCalendar>(`/calendar/?${params.toString()}`);
  },
  trainingGoals: (sport?: string) => request<import("./types").TrainingGoalProfile[]>(
    `/training-goals/${sport ? `?sport=${encodeURIComponent(sport)}` : ""}`,
  ),
  invite: (email: string) => request("/athlete-invitations/", { method: "POST", body: JSON.stringify({ email }) }),
  createPlan: (data: object) => request<import("./types").TrainingPlan>("/training-plans/", { method: "POST", body: JSON.stringify(data) }),
  generatePlan: (data: object) => request<import("./types").TrainingPlan>("/training-plans/generate/", { method: "POST", body: JSON.stringify(data) }),
  updatePlan: (id: number, data: object) => request<import("./types").TrainingPlan>(`/training-plans/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  publishPlan: (id: number) => request<import("./types").TrainingPlan>(`/training-plans/${id}/publish/`, { method: "POST", body: "{}" }),
  returnPlanToDraft: (id: number) => request<import("./types").TrainingPlan>(`/training-plans/${id}/return-to-draft/`, { method: "POST", body: "{}" }),
  archivePlan: (id: number) => request<import("./types").TrainingPlan>(`/training-plans/${id}/archive/`, { method: "POST", body: "{}" }),
  deletePlan: (id: number) => request<void>(`/training-plans/${id}/`, { method: "DELETE" }),
  createWeek: (data: object) => request<import("./types").WeeklyPlan>("/weekly-plans/", { method: "POST", body: JSON.stringify(data) }),
  duplicateWeek: (id: number, data: object) => request<import("./types").WeeklyPlan>(`/weekly-plans/${id}/duplicate/`, { method: "POST", body: JSON.stringify(data) }),
  createWorkout: (data: object) => request<import("./types").Workout>("/workouts/", { method: "POST", body: JSON.stringify(data) }),
  updateWorkout: (id: number, data: object) => request<import("./types").Workout>(`/workouts/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  duplicateWorkout: (id: number, data: object) => request<import("./types").Workout>(`/workouts/${id}/duplicate/`, { method: "POST", body: JSON.stringify(data) }),
  downloadScheduledGarminFit: (id: number, locale: string) => requestBlob(`/workouts/${id}/garmin-fit/?locale=${locale}`),
  deviceProviders: () => request<import("./types").DeviceProviderCapability[]>("/device-providers/"),
  deviceConnections: () => request<import("./types").Page<import("./types").DeviceConnection>>("/device-connections/?page_size=100"),
  startGarminAuthorization: () => request<{ authorization_url: string; expires_at: string }>(
    "/device-connections/garmin/authorize/",
    { method: "POST", body: "{}" },
  ),
  startStravaAuthorization: () => request<{ authorization_url: string; expires_at: string }>(
    "/device-connections/strava/authorize/",
    { method: "POST", body: "{}" },
  ),
  syncDevice: (id: number) => request<import("./types").ActivitySyncResult>(
    `/device-connections/${id}/sync/`,
    { method: "POST", body: "{}" },
  ),
  disconnectDevice: (id: number) => request<import("./types").DeviceConnection>(
    `/device-connections/${id}/disconnect/`,
    { method: "POST", body: "{}" },
  ),
  workoutDeliveries: () => request<import("./types").Page<import("./types").WorkoutDelivery>>(
    "/workout-deliveries/?page_size=100",
  ),
  queueWorkoutDelivery: (workoutId: number) => request<import("./types").WorkoutDelivery>(
    "/workout-deliveries/queue/",
    { method: "POST", body: JSON.stringify({ workout_id: workoutId }) },
  ),
  deleteWorkout: (id: number) => request<void>(`/workouts/${id}/`, { method: "DELETE" }),
  workoutTemplates: () => request<import("./types").Page<import("./types").WorkoutTemplate>>("/workout-templates/?page_size=100"),
  createWorkoutTemplate: (data: object) => request<import("./types").WorkoutTemplate>("/workout-templates/", { method: "POST", body: JSON.stringify(data) }),
  updateWorkoutTemplate: (id: number, data: object) => request<import("./types").WorkoutTemplate>(`/workout-templates/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  duplicateWorkoutTemplate: (id: number, data: object = {}) => request<import("./types").WorkoutTemplate>(`/workout-templates/${id}/duplicate/`, { method: "POST", body: JSON.stringify(data) }),
  assignWorkoutTemplate: (id: number, data: object) => request<import("./types").Workout>(`/workout-templates/${id}/assign/`, { method: "POST", body: JSON.stringify(data) }),
  previewGarminFit: (id: number, athleteId: number, locale: string) => request<import("./types").GarminFitPreview>(`/workout-templates/${id}/garmin-preview/?athlete_id=${athleteId}&locale=${locale}`),
  downloadGarminFit: (id: number, athleteId: number, locale: string) => requestBlob(`/workout-templates/${id}/garmin-fit/?athlete_id=${athleteId}&locale=${locale}`),
  deleteWorkoutTemplate: (id: number) => request<void>(`/workout-templates/${id}/`, { method: "DELETE" }),
  createExercise: (data: object) => request<import("./types").Exercise>("/exercises/", { method: "POST", body: JSON.stringify(data) }),
  createComment: (data: object) => request<import("./types").CoachComment>("/coach-comments/", { method: "POST", body: JSON.stringify(data) }),
  logWorkout: (data: object) => request<import("./types").WorkoutLog>("/workout-logs/", { method: "POST", body: JSON.stringify(data) }),
  activities: (athleteId?: number) => request<import("./types").Page<import("./types").Activity>>(`/activities/?page_size=100${athleteId ? `&athlete=${athleteId}` : ""}`),
  activity: (id: number) => request<import("./types").Activity>(`/activities/${id}/`),
  importActivity: (data: FormData) => request<import("./types").Activity>("/activities/import/", { method: "POST", body: data }),
  deleteActivity: (id: number) => request<void>(`/activities/${id}/`, { method: "DELETE" }),
};
