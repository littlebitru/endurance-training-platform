import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { AthleteThresholdPanel } from "./AthleteThresholdPanel";
import { ActivitiesPage } from "./ActivitiesPage";
import { CalendarPage } from "./CalendarPage";
import heroImage from "./assets/endurance-hero-v2.webp";
import { useAuth } from "./auth";
import { localizeGeneratedWorkoutTitle } from "./generatedContent";
import { localizeApiError, useLanguage } from "./i18n";
import { TrainingPlansPage } from "./TrainingPlansPage";
import type { Analytics, Relationship, Role, TrainingCalendar, TrainingPlan, WeeklyAnalytics, Workout } from "./types";

function LanguageSwitcher() {
  const { locale, setLocale, t } = useLanguage();
  return (
    <div className="language-switcher" role="group" aria-label={t("language")}>
      <button className={locale === "ru" ? "active" : ""} onClick={() => setLocale("ru")} type="button">RU</button>
      <button className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")} type="button">EN</button>
    </div>
  );
}

function AuthStory({ security = false }: { security?: boolean }) {
  const { t } = useLanguage();
  return (
    <section className="auth-story">
      <img className="auth-visual" src={heroImage} alt="" />
      <div className="motion-orbit orbit-one" />
      <div className="motion-orbit orbit-two" />
      <span className="eyebrow">{security ? t("accountSecurity") : t("storyEyebrow")}</span>
      <h1>
        {security ? t("secureAccess") : t("storyTitleStart")}<br />
        <em>{security ? t("clearProgress") : t("storyTitleAccent")}</em>
      </h1>
      {!security && <p>{t("storyDescription")}</p>}
      {!security && (
        <div className="metric-row">
          <span>{t("plan")}</span><i /><span>{t("execute")}</span><i /><span>{t("adapt")}</span>
        </div>
      )}
    </section>
  );
}

function AuthPage() {
  const { login, user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === "login") {
        await login(String(data.username), String(data.password));
        navigate("/");
      } else {
        await api.register(data as Record<string, string>);
        setNotice(t("accountCreated"));
        setMode("login");
      }
    } catch (caught) {
      const message = (caught as Error).message || t("requestFailed");
      setError(localizeApiError(message, t));
    } finally {
      setSubmitting(false);
    }
  }

  const changeMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError("");
    setNotice("");
  };

  return (
    <main className="auth-shell">
      <LanguageSwitcher />
      <AuthStory />
      <section className="auth-card">
        <div className="brand-mark">EA</div>
        <h2>{mode === "login" ? t("welcomeBack") : t("createYourAccount")}</h2>
        <p>{mode === "login" ? t("signInSubtitle") : t("registerSubtitle")}</p>
        {notice && <div className="notice" role="status">{notice}</div>}
        {error && <div className="error" role="alert">{error}</div>}
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <label>{t("email")}<input name="email" type="email" required /></label>
              <div className="two">
                <label>{t("firstName")}<input name="first_name" /></label>
                <label>{t("lastName")}<input name="last_name" /></label>
              </div>
            </>
          )}
          <label>{t("username")}<input name="username" autoComplete="username" required /></label>
          <label>
            {t("password")}
            <input
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>
          {mode === "register" && (
            <label>
              {t("role")}
              <select name="role"><option value="athlete">{t("athlete")}</option><option value="coach">{t("coach")}</option></select>
            </label>
          )}
          <button className="primary" disabled={submitting} type="submit">
            {submitting
              ? (mode === "login" ? t("signingIn") : t("creatingAccount"))
              : (mode === "login" ? t("signIn") : t("createAccount"))}
          </button>
        </form>
        {mode === "login" && <Link className="text-button" to="/account-help">{t("verifyOrReset")}</Link>}
        <button className="text-button" disabled={submitting} onClick={changeMode} type="button">
          {mode === "login" ? t("newHere") : t("alreadyRegistered")}
        </button>
      </section>
    </main>
  );
}

function SimpleAuthCard({ title, text, children }: { title: string; text: string; children?: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <main className="auth-shell">
      <LanguageSwitcher />
      <AuthStory security />
      <section className="auth-card">
        <div className="brand-mark">EA</div>
        <h2>{title}</h2>
        <p>{text}</p>
        {children}
        <Link className="text-button" to="/auth">{t("backToSignIn")}</Link>
      </section>
    </main>
  );
}

function VerifyEmailPage() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const [message, setMessage] = useState(t("verifyingEmail"));
  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setMessage(t("incompleteVerification"));
      return;
    }
    api.verifyEmail(token).then(() => setMessage(t("emailVerified"))).catch((error) => setMessage(error.message));
  }, [params, t]);
  return <SimpleAuthCard title={t("emailVerification")} text={message} />;
}

function AccountHelpPage() {
  const { t } = useLanguage();
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (data.action === "verify") await api.requestVerification(String(data.email));
      else await api.requestPasswordReset(String(data.email));
      setMessage(t("emailSent"));
    } catch (caught) {
      setMessage(localizeApiError((caught as Error).message, t));
    }
  }
  return (
    <SimpleAuthCard title={t("accountHelp")} text={t("accountHelpText")}>
      {message && <div className="notice" role="status">{message}</div>}
      <form onSubmit={submit}>
        <label>{t("email")}<input name="email" type="email" required /></label>
        <label>
          {t("action")}
          <select name="action"><option value="verify">{t("verifyEmail")}</option><option value="reset">{t("resetPassword")}</option></select>
        </label>
        <button className="primary">{t("sendEmail")}</button>
      </form>
    </SimpleAuthCard>
  );
}

function ResetPasswordPage() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    try {
      await api.confirmPasswordReset(params.get("uid") || "", params.get("token") || "", password);
      setMessage(t("passwordUpdated"));
    } catch (caught) {
      setMessage(localizeApiError((caught as Error).message, t));
    }
  }
  return (
    <SimpleAuthCard title={t("choosePassword")} text={t("strongPassword")}>
      {message && <div className="notice" role="status">{message}</div>}
      <form onSubmit={submit}>
        <label>{t("newPassword")}<input name="password" type="password" minLength={8} required /></label>
        <button className="primary">{t("updatePassword")}</button>
      </form>
    </SimpleAuthCard>
  );
}

function InvitationPage() {
  const { t } = useLanguage();
  const { token } = useParams();
  const { refreshUser, user } = useAuth();
  const attempted = useRef(false);
  const [message, setMessage] = useState(t("acceptingInvitation"));
  useEffect(() => {
    if (!user) {
      setMessage(t("invitationSignIn"));
      return;
    }
    if (token && !attempted.current) {
      attempted.current = true;
      api.acceptInvitation(token)
        .then(async () => {
          await refreshUser();
          setMessage(t("invitationAccepted"));
        })
        .catch((error) => setMessage(error.message));
    }
  }, [refreshUser, token, user, t]);
  return <SimpleAuthCard title={t("coachInvitation")} text={message} />;
}

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const roleLabel = user?.role === "coach" ? t("coach") : t("athlete");
  return (
    <div className="app-shell">
      <aside>
        <div className="logo">EA</div>
        <div><strong>Endurance</strong><small>{t("trainingPlatform")}</small></div>
        <nav>
          <NavLink to="/">{t("overview")}</NavLink>
          <NavLink to="/calendar">{t("calendar")}</NavLink>
          <NavLink to="/plans">{t("trainingPlans")}</NavLink>
          <NavLink to="/activities">{t("activities")}</NavLink>
          {user?.role === "coach" && <NavLink to="/athletes">{t("athletes")}</NavLink>}
        </nav>
        <div className="account">
          <span>{user?.first_name?.[0] || user?.username[0]}</span>
          <div><strong>{user?.first_name || user?.username}</strong><small>{roleLabel}</small></div>
          <button onClick={() => void logout()} aria-label={t("signOut")}>↗</button>
        </div>
      </aside>
      <div className="content">
        <header>
          <div><span className="eyebrow">{roleLabel} · {t("workspace")}</span><h1>{t("clarity")}</h1></div>
          <div className="header-actions"><LanguageSwitcher /></div>
        </header>
        <div className="page-enter">{children}</div>
      </div>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  if (loading) return <div className="loader"><span />{t("loading")}</div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <Layout>{children}</Layout>;
}

function localDateKey(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function currentWeekRange(value = new Date()): { start: string; end: string } {
  const start = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start: localDateKey(start), end: localDateKey(end) };
}

function Overview() {
  const { user } = useAuth();
  const { locale, t } = useLanguage();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [stats, setStats] = useState<Analytics | null>(null);
  const [weekCalendar, setWeekCalendar] = useState<TrainingCalendar | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  useEffect(() => {
    if (!user) return;
    const week = currentWeekRange();
    const requests: Promise<unknown>[] = [
      api.plans().then((response) => setPlans(response.results)),
      api.calendar(week.start, week.end).then(setWeekCalendar),
    ];
    if (user.role === "coach") {
      requests.push(api.analytics().then(setStats));
      requests.push(api.athletes().then((response) => setRelationships(response.results)));
    } else {
      requests.push(api.athleteAnalytics().then(setStats));
    }
    Promise.all(requests).catch((caught) => setDashboardError(localizeApiError((caught as Error).message, t)));
  }, [t, user]);
  const scheduledWorkouts = plans.flatMap((plan) =>
    plan.weeks.flatMap((week) => week.workouts.map((workout) => ({ athleteId: plan.athlete, workout }))),
  );
  const next = scheduledWorkouts
    .filter((item) => new Date(item.workout.scheduled_at) >= new Date())
    .sort((left, right) => left.workout.scheduled_at.localeCompare(right.workout.scheduled_at))
    .slice(0, 4);
  const athleteNames = new Map(
    relationships.map((relationship) => [
      relationship.athlete.id,
      `${relationship.athlete.first_name} ${relationship.athlete.last_name}`.trim() || relationship.athlete.username,
    ]),
  );
  const activeAthleteCount = relationships.filter((relationship) => relationship.is_active).length;
  const isCoach = user?.role === "coach";
  const athletePlans = [...plans]
    .filter((plan) => plan.is_active && plan.publication_status !== "archived")
    .sort((left, right) => {
      const leftValue = Date.parse(left.updated_at || left.created_at || left.start_date);
      const rightValue = Date.parse(right.updated_at || right.created_at || right.start_date);
      return rightValue - leftValue || right.id - left.id;
    });
  const coachName = user?.coach
    ? `${user.coach.first_name} ${user.coach.last_name}`.trim() || user.coach.username
    : "";
  return (
    <>
      <WeeklyCommandCenter
        activePlanCount={athletePlans.length}
        athleteCount={activeAthleteCount}
        calendar={weekCalendar}
        nextWorkout={next[0]?.workout}
        role={isCoach ? "coach" : "athlete"}
      />
      {!isCoach && athletePlans.length > 0 && <AthletePlanPortfolio plans={athletePlans} />}
      {dashboardError && <div className="error" role="alert">{dashboardError}</div>}
      {stats?.weekly?.length ? <WeeklyProgress locale={locale} weeks={stats.weekly.slice(-8)} /> : null}
      {user?.role === "athlete" && (
        <section className={`coach-card ${user.coach ? "connected" : "unassigned"}`}>
          <span className="coach-avatar">{user.coach ? (user.coach.first_name?.[0] || user.coach.username[0]) : "?"}</span>
          <div>
            <span className="eyebrow">{t("yourCoach")}</span>
            <h3>{user.coach ? coachName : t("coachNotConnected")}</h3>
            <p>{user.coach ? t("coachSupport", { username: user.coach.username }) : t("coachNotConnectedText")}</p>
          </div>
          <span className={`status ${user.coach ? "active" : ""}`}>{user.coach ? t("connected") : t("notConnected")}</span>
        </section>
      )}
      <div className="section-title">
        <div><span className="eyebrow">{t("comingUp")}</span><h2>{isCoach ? t("coachNextSessions") : t("nextSessions")}</h2></div>
        <NavLink to="/calendar">{t("viewAll")}</NavLink>
      </div>
      <section className="session-list">
        {next.length ? next.map((item) => <WorkoutRow athleteName={isCoach ? athleteNames.get(item.athleteId) : undefined} key={item.workout.id} workout={item.workout} />) : <Empty text={t("noUpcoming")} />}
      </section>
    </>
  );
}

export function WeeklyCommandCenter({
  role,
  calendar,
  athleteCount,
  activePlanCount,
  nextWorkout,
}: {
  role: Role;
  calendar: TrainingCalendar | null;
  athleteCount: number;
  activePlanCount: number;
  nextWorkout?: Workout;
}) {
  const { locale, t } = useLanguage();
  const summary = calendar?.summary;
  const attentionCount = summary?.attention_count ?? 0;
  const isCoach = role === "coach";
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const sportKey = nextWorkout
    ? overviewSportKeys[nextWorkout.sport as keyof typeof overviewSportKeys]
    : undefined;
  const nextMetrics = nextWorkout
    ? [
      nextWorkout.planned_duration_minutes ? `${nextWorkout.planned_duration_minutes} ${t("minutes")}` : "",
      nextWorkout.planned_distance_km ? `${nextWorkout.planned_distance_km} km` : "",
    ].filter(Boolean).join(" · ")
    : "";
  const metrics: Array<{ label: string; value: string | number; tone?: string; to: string }> = isCoach
    ? [
      { label: t("athletesUnderCoaching"), value: athleteCount, to: "/athletes" },
      { label: t("plannedSessions"), value: summary?.planned_count ?? "—", to: "/calendar" },
      { label: t("attentionNeeded"), value: summary?.attention_count ?? "—", tone: attentionCount > 0 ? "attention" : "positive", to: "/calendar" },
      { label: t("averageCompliance"), value: summary?.average_compliance == null ? "—" : `${summary.average_compliance}%`, to: "/activities" },
    ]
    : [
      { label: t("activePlans"), value: activePlanCount, to: "/plans" },
      { label: t("plannedSessions"), value: summary?.planned_count ?? "—", to: "/calendar" },
      { label: t("completionRate"), value: summary ? `${summary.completion_rate}%` : "—", tone: "positive", to: "/calendar" },
      { label: t("actualLoad"), value: summary ? Math.round(Number(summary.training_load_score)) : "—", to: "/activities" },
    ];
  const title = isCoach
    ? attentionCount > 0 ? t("coachAttentionTitle") : calendar ? t("coachAllClearTitle") : t("coachWeekTitle")
    : t("athleteWeekTitle");
  const description = isCoach
    ? attentionCount > 0
      ? t("coachAttentionDescription", { count: attentionCount })
      : t("coachAllClearDescription")
    : t("athleteWeekDescription");
  const rhythmDays = calendar
    ? Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${calendar.date_from}T12:00:00`);
      date.setDate(date.getDate() + index);
      const key = localDateKey(date);
      const events = calendar.events.filter((event) => localDateKey(new Date(event.starts_at)) === key);
      const state = events.some((event) => event.attention_required)
        ? "attention"
        : events.some((event) => event.status === "completed")
          ? "completed"
          : events.length
            ? "planned"
            : "rest";
      return { date, events, key, state };
    })
    : [];
  const completedCount = summary?.completed_count ?? 0;
  const plannedCount = summary?.planned_count ?? 0;
  const nextWorkoutDate = nextWorkout ? localDateKey(new Date(nextWorkout.scheduled_at)) : "";

  return (
    <section className={`weekly-command-center ${role}`} aria-labelledby="weekly-command-title">
      <div className="weekly-command-copy">
        <span className="eyebrow">{isCoach ? t("coachCommandCenter") : t("athleteCommandCenter")}</span>
        <h2 id="weekly-command-title">{title}</h2>
        <p>{description}</p>
        <NavLink className="command-action" to="/calendar">
          {isCoach ? t("openReviewQueue") : t("openTrainingCalendar")} →
        </NavLink>
      </div>
      <div className="weekly-rhythm">
        <header>
          <span>{t("weekRhythm")}</span>
          <small>{plannedCount ? t("workoutsCompletedThisWeek", { completed: completedCount, planned: plannedCount }) : t("noSessionsThisWeek")}</small>
        </header>
        <div className="weekly-rhythm-days">
          {rhythmDays.map((day) => (
            <NavLink
              aria-label={day.date.toLocaleDateString(dateLocale, { weekday: "long", day: "numeric", month: "long" })}
              className={day.state}
              key={day.key}
              to={`/calendar?date=${day.key}`}
            >
              <small>{day.date.toLocaleDateString(dateLocale, { weekday: "narrow" })}</small>
              <i>{day.events.length || "·"}</i>
            </NavLink>
          ))}
        </div>
        {!isCoach && (
          nextWorkout ? (
            <NavLink className="next-workout-insight" to={`/calendar?date=${nextWorkoutDate}&workout_id=${nextWorkout.id}`}>
              <span>{t("nextTraining")}</span>
              <div>
                <strong>{sportKey ? t(sportKey) : nextWorkout.sport}</strong>
                <small>
                  {new Date(nextWorkout.scheduled_at).toLocaleString(dateLocale, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {nextMetrics ? ` · ${nextMetrics}` : ""}
                </small>
              </div>
              <b>→</b>
            </NavLink>
          ) : (
            <div className="next-workout-insight empty-insight">
              <span>{t("nextTraining")}</span>
              <div><strong>{t("recoveryWindow")}</strong><small>{t("noUpcomingSession")}</small></div>
            </div>
          )
        )}
      </div>
      <div className="weekly-command-metrics">
        {metrics.map((metric) => (
          <NavLink className={metric.tone ?? ""} key={metric.label} to={metric.to}>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
            <span aria-hidden="true">↗</span>
          </NavLink>
        ))}
      </div>
    </section>
  );
}

const overviewSportKeys = {
  running: "sportRunning",
  cycling: "sportCycling",
  swimming: "sportSwimming",
  triathlon: "sportTriathlon",
} as const;

export function AthletePlanPortfolio({ plans }: { plans: TrainingPlan[] }) {
  const { locale, t } = useLanguage();
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  return (
    <section className="athlete-plan-portfolio" aria-labelledby="athlete-plans-title">
      <div className="athlete-plan-portfolio-head">
        <div>
          <span className="eyebrow">{t("myTrainingPlans")}</span>
          <h3 id="athlete-plans-title">{t("activeGoals")}</h3>
          <p>{t("activeGoalsIntro")}</p>
        </div>
        <span>{plans.length}</span>
      </div>
      <div className="athlete-plan-portfolio-list">
        {plans.map((plan) => {
          const sessions = plan.weeks.reduce((total, week) => total + week.workouts.length, 0);
          const sportKey = overviewSportKeys[plan.primary_sport as keyof typeof overviewSportKeys];
          return (
            <NavLink className={`athlete-plan-card ${plan.primary_sport}`} key={plan.id} to={`/plans?plan_id=${plan.id}`}>
              <span className="athlete-plan-card-top">
                <i>{sportKey ? t(sportKey) : plan.primary_sport}</i>
                <small>{t("sessionsCount", { count: sessions })}</small>
              </span>
              <strong>{plan.title}</strong>
              <span>{plan.target_event_name || t("trainingPlan")}</span>
              <small>
                {new Date(`${plan.start_date}T12:00:00`).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}
                {" — "}
                {new Date(`${plan.end_date}T12:00:00`).toLocaleDateString(dateLocale, { day: "numeric", month: "short", year: "numeric" })}
              </small>
              <b>{t("openPlan")} →</b>
            </NavLink>
          );
        })}
      </div>
    </section>
  );
}

function WeeklyProgress({ locale, weeks }: { locale: string; weeks: WeeklyAnalytics[] }) {
  const { t } = useLanguage();
  const maximum = Math.max(1, ...weeks.flatMap((week) => [Number(week.planned_duration_minutes), Number(week.actual_duration_minutes)]));
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  return (
    <section className="weekly-progress">
      <div className="weekly-progress-head">
        <div><span className="eyebrow">{t("weeklyProgress")}</span><h3>{t("plannedVsActual")}</h3></div>
        <div className="chart-legend"><span className="planned">{t("plannedLabel")}</span><span className="actual">{t("actualLabel")}</span></div>
      </div>
      <div className="weekly-bars">
        {weeks.map((week) => (
          <article key={week.week_start} title={`${week.completion_rate}%`}>
            <div className="bar-pair">
              <i className="planned" style={{ height: `${Math.max(4, Number(week.planned_duration_minutes) / maximum * 100)}%` }} />
              <i className="actual" style={{ height: `${Math.max(4, Number(week.actual_duration_minutes) / maximum * 100)}%` }} />
            </div>
            <small>{new Date(`${week.week_start}T12:00:00`).toLocaleDateString(dateLocale, { day: "2-digit", month: "short" })}</small>
            <strong>{Math.round(week.completion_rate)}%</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function WorkoutRow({ athleteName, workout }: { athleteName?: string; workout: Workout }) {
  const { locale, t } = useLanguage();
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const sportLabels: Record<string, string> = {
    running: t("sportRunning"), cycling: t("sportCycling"), swimming: t("sportSwimming"), triathlon: t("sportTriathlon"),
  };
  const statusLabels: Record<string, string> = {
    planned: t("statusPlanned"), completed: t("statusCompleted"), skipped: t("statusSkipped"),
  };
  const workoutDate = localDateKey(new Date(workout.scheduled_at));
  return (
    <NavLink className="workout-row" to={`/calendar?date=${workoutDate}&workout_id=${workout.id}`}>
      <time><strong>{new Date(workout.scheduled_at).toLocaleDateString(dateLocale, { day: "2-digit" })}</strong><small>{new Date(workout.scheduled_at).toLocaleDateString(dateLocale, { month: "short" })}</small></time>
      <div className={`sport ${workout.sport}`} />
      <div className="grow"><strong>{localizeGeneratedWorkoutTitle(workout, t)}</strong><small>{sportLabels[workout.sport] || workout.sport} · {workout.intensity || t("openIntensity")}</small>{athleteName && <small className="athlete-context">{athleteName}</small>}</div>
      <div><strong>{workout.planned_duration_minutes ?? "—"} {t("minutes")}</strong><small>{workout.planned_distance_km ? `${workout.planned_distance_km} km` : t("distanceOpen")}</small></div>
      <span className={`status ${workout.status}`}>{statusLabels[workout.status] || workout.status}</span>
    </NavLink>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function AthletesPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [athletes, setAthletes] = useState<Relationship[]>([]);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState<Relationship | null>(null);
  useEffect(() => { if (user?.role === "coach") api.athletes().then((response) => setAthletes(response.results)); }, [user]);
  if (user?.role !== "coach") return <Navigate to="/" />;
  async function invite(event: FormEvent) {
    event.preventDefault();
    try {
      await api.invite(email);
      setMessage(t("invitationSent"));
      setEmail("");
    } catch (caught) {
      setMessage(localizeApiError((caught as Error).message, t));
    }
  }
  return (
    <>
      <div className="section-title">
        <div><span className="eyebrow">{t("roster")}</span><h2>{t("yourAthletes")}</h2></div>
        <form className="invite" onSubmit={invite}><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="athlete@example.com" required /><button className="primary">{t("inviteAthlete")}</button></form>
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      <section className="athlete-grid">
        {athletes.map((relationship) => (
          <article className="athlete" key={relationship.id}>
            <span>{relationship.athlete.first_name?.[0] || relationship.athlete.username[0]}</span>
            <h3>{relationship.athlete.first_name ? `${relationship.athlete.first_name} ${relationship.athlete.last_name}` : relationship.athlete.username}</h3>
            <p>{relationship.athlete.profile?.sport || t("sportMissing")}</p>
            <button className="secondary athlete-threshold-button" onClick={() => setSelectedAthlete(relationship)} type="button">{t("thresholdsAndZones")}</button>
          </article>
        ))}
      </section>
      {!athletes.length && <Empty text={t("noAthletes")} />}
      {selectedAthlete && <AthleteThresholdPanel onClose={() => setSelectedAthlete(null)} relationship={selectedAthlete} />}
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/account-help" element={<AccountHelpPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invitations/:token" element={<InvitationPage />} />
      <Route path="/" element={<Protected><Overview /></Protected>} />
      <Route path="/calendar" element={<Protected><CalendarPage /></Protected>} />
      <Route path="/plans" element={<Protected><TrainingPlansPage /></Protected>} />
      <Route path="/activities" element={<Protected><ActivitiesPage /></Protected>} />
      <Route path="/athletes" element={<Protected><AthletesPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
