import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "./api";
import heroImage from "./assets/endurance-hero-v1.webp";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage } from "./i18n";
import { TrainingPlansPage } from "./TrainingPlansPage";
import type { Analytics, Relationship, TrainingPlan, Workout } from "./types";

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
          <NavLink to="/plans">{t("trainingPlans")}</NavLink>
          {user?.role === "coach" && <NavLink to="/athletes">{t("athletes")}</NavLink>}
        </nav>
        <div className="account">
          <span>{user?.first_name?.[0] || user?.username[0]}</span>
          <div><strong>{user?.first_name || user?.username}</strong><small>{roleLabel}</small></div>
          <button onClick={logout} aria-label={t("signOut")}>↗</button>
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

function Overview() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [stats, setStats] = useState<Analytics | null>(null);
  useEffect(() => {
    api.plans().then((response) => setPlans(response.results));
    if (user?.role === "coach") api.analytics().then(setStats);
  }, [user]);
  const workouts = plans.flatMap((plan) => plan.weeks.flatMap((week) => week.workouts));
  const next = workouts
    .filter((workout) => new Date(workout.scheduled_at) >= new Date())
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at))
    .slice(0, 4);
  const coachName = user?.coach
    ? `${user.coach.first_name} ${user.coach.last_name}`.trim() || user.coach.username
    : "";
  return (
    <>
      <section className="hero-panel">
        <img className="hero-panel-image" src={heroImage} alt="" />
        <div>
          <span className="eyebrow">{t("currentCycle")}</span>
          <h2>{plans[0]?.title ?? t("cycleReady")}</h2>
          <p>{plans[0]?.description || t("cycleDescription")}</p>
        </div>
        <div className="ring"><strong>{stats?.completion_rate ?? workouts.filter((workout) => workout.status === "completed").length}</strong><small>{stats ? t("percentComplete") : t("completed")}</small></div>
      </section>
      <section className="stat-grid">
        <Stat label={t("activePlans")} value={plans.filter((plan) => plan.is_active).length} />
        <Stat label={t("plannedSessions")} value={stats?.total_workouts ?? workouts.length} />
        <Stat label={t("distanceCompleted")} value={`${stats?.actual_distance_km ?? "0.00"} km`} />
        <Stat label={t("averageEffort")} value={stats?.average_perceived_exertion ?? "—"} />
      </section>
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
        <div><span className="eyebrow">{t("comingUp")}</span><h2>{t("nextSessions")}</h2></div>
        <NavLink to="/plans">{t("viewAll")}</NavLink>
      </div>
      <section className="session-list">
        {next.length ? next.map((workout) => <WorkoutRow key={workout.id} workout={workout} />) : <Empty text={t("noUpcoming")} />}
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <article className="stat"><small>{label}</small><strong>{value}</strong></article>;
}

function WorkoutRow({ workout }: { workout: Workout }) {
  const { locale, t } = useLanguage();
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const sportLabels: Record<string, string> = {
    running: t("sportRunning"), cycling: t("sportCycling"), swimming: t("sportSwimming"), triathlon: t("sportTriathlon"),
  };
  const statusLabels: Record<string, string> = {
    planned: t("statusPlanned"), completed: t("statusCompleted"), skipped: t("statusSkipped"),
  };
  return (
    <article className="workout-row">
      <time><strong>{new Date(workout.scheduled_at).toLocaleDateString(dateLocale, { day: "2-digit" })}</strong><small>{new Date(workout.scheduled_at).toLocaleDateString(dateLocale, { month: "short" })}</small></time>
      <div className={`sport ${workout.sport}`} />
      <div className="grow"><strong>{workout.title}</strong><small>{sportLabels[workout.sport] || workout.sport} · {workout.intensity || t("openIntensity")}</small></div>
      <div><strong>{workout.planned_duration_minutes ?? "—"} {t("minutes")}</strong><small>{workout.planned_distance_km ? `${workout.planned_distance_km} km` : t("distanceOpen")}</small></div>
      <span className={`status ${workout.status}`}>{statusLabels[workout.status] || workout.status}</span>
    </article>
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
          </article>
        ))}
      </section>
      {!athletes.length && <Empty text={t("noAthletes")} />}
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
      <Route path="/plans" element={<Protected><TrainingPlansPage /></Protected>} />
      <Route path="/athletes" element={<Protected><AthletesPage /></Protected>} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
