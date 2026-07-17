import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage } from "./i18n";
import type { Relationship, TrainingPlan, WeeklyPlan, Workout } from "./types";

type Editor =
  | { kind: "plan" }
  | { kind: "week"; plan: TrainingPlan }
  | { kind: "workout"; week: WeeklyPlan }
  | { kind: "exercise"; workout: Workout }
  | { kind: "comment"; workout: Workout }
  | { kind: "log"; workout: Workout };

function compactForm(form: HTMLFormElement): Record<string, string | boolean> {
  const payload: Record<string, string | boolean> = {};
  new FormData(form).forEach((value, key) => {
    const normalized = String(value).trim();
    if (normalized) payload[key] = normalized;
  });
  return payload;
}

function localDateTime(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateOffset(days: number): string {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function displayName(relationship: Relationship): string {
  const athlete = relationship.athlete;
  return `${athlete.first_name} ${athlete.last_name}`.trim() || athlete.username;
}

function EditorPanel({
  editor,
  relationships,
  onClose,
  onSaved,
}: {
  editor: Editor;
  relationships: Relationship[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const titles = {
    plan: t("createPlan"),
    week: t("addWeek"),
    workout: t("addWorkout"),
    exercise: t("addExercise"),
    comment: t("addComment"),
    log: t("markComplete"),
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    const payload = compactForm(event.currentTarget);

    try {
      if (editor.kind === "plan") {
        await api.createPlan({ ...payload, is_active: true });
        await onSaved(t("planCreated"));
      } else if (editor.kind === "week") {
        await api.createWeek({ ...payload, training_plan: editor.plan.id });
        await onSaved(t("weekCreated"));
      } else if (editor.kind === "workout") {
        await api.createWorkout({
          ...payload,
          weekly_plan: editor.week.id,
          scheduled_at: new Date(String(payload.scheduled_at)).toISOString(),
        });
        await onSaved(t("workoutCreated"));
      } else if (editor.kind === "exercise") {
        await api.createExercise({ ...payload, workout: editor.workout.id });
        await onSaved(t("exerciseCreated"));
      } else if (editor.kind === "comment") {
        await api.createComment({ ...payload, workout: editor.workout.id });
        await onSaved(t("commentCreated"));
      } else {
        await api.logWorkout({
          ...payload,
          workout: editor.workout.id,
          completed_at: new Date(String(payload.completed_at)).toISOString(),
        });
        await onSaved(t("completionRecorded"));
      }
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
      setSubmitting(false);
    }
  }

  return (
    <div className="editor-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-labelledby="editor-title" aria-modal="true" className="editor-panel" role="dialog">
        <div className="editor-head">
          <div><span className="eyebrow">{t("trainingWorkspace")}</span><h2 id="editor-title">{titles[editor.kind]}</h2></div>
          <button aria-label={t("close")} className="icon-button" onClick={onClose} type="button">×</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <form className="editor-form" onSubmit={submit}>
          {editor.kind === "plan" && (
            <>
              <label>{t("selectAthlete")}<select name="athlete" required defaultValue=""><option value="" disabled>{t("selectAthlete")}</option>{relationships.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.athlete.id}>{displayName(item)}</option>)}</select></label>
              <label>{t("planTitle")}<input name="title" required /></label>
              <label className="wide">{t("description")}<textarea name="description" rows={3} /></label>
              <div className="form-grid">
                <label>{t("startDate")}<input name="start_date" type="date" defaultValue={dateOffset(0)} required /></label>
                <label>{t("endDate")}<input name="end_date" type="date" defaultValue={dateOffset(42)} required /></label>
              </div>
            </>
          )}

          {editor.kind === "week" && (
            <>
              <div className="editor-context"><strong>{editor.plan.title}</strong><small>{editor.plan.start_date} — {editor.plan.end_date}</small></div>
              <div className="form-grid">
                <label>{t("weekNumber")}<input name="week_number" type="number" min="1" required /></label>
                <label>{t("startDate")}<input name="start_date" type="date" defaultValue={editor.plan.start_date} required /></label>
              </div>
              <label>{t("weekNotes")}<textarea name="notes" rows={3} /></label>
            </>
          )}

          {editor.kind === "workout" && (
            <>
              <div className="editor-context"><strong>{t("week", { number: editor.week.week_number })}</strong><small>{editor.week.start_date}</small></div>
              <div className="form-grid">
                <label>{t("workoutTitle")}<input name="title" required /></label>
                <label>{t("sport")}<select name="sport" required><option value="running">{t("sportRunning")}</option><option value="cycling">{t("sportCycling")}</option><option value="swimming">{t("sportSwimming")}</option><option value="triathlon">{t("sportTriathlon")}</option></select></label>
                <label>{t("scheduledAt")}<input name="scheduled_at" type="datetime-local" defaultValue={localDateTime()} required /></label>
                <label>{t("intensity")}<input name="intensity" placeholder="Z2 / easy / tempo" /></label>
                <label>{t("durationMinutes")}<input name="planned_duration_minutes" type="number" min="1" /></label>
                <label>{t("distanceKm")}<input name="planned_distance_km" type="number" min="0" step="0.01" /></label>
              </div>
              <label>{t("workoutNotes")}<textarea name="notes" rows={3} /></label>
            </>
          )}

          {editor.kind === "exercise" && (
            <>
              <div className="editor-context"><strong>{editor.workout.title}</strong><small>{t("exerciseDetails")}</small></div>
              <div className="form-grid">
                <label>{t("exerciseName")}<input name="name" required /></label>
                <label>{t("exerciseOrder")}<input name="order" type="number" min="1" defaultValue="1" required /></label>
                <label>{t("durationSeconds")}<input name="duration_seconds" type="number" min="1" /></label>
                <label>{t("distanceMeters")}<input name="distance_meters" type="number" min="1" /></label>
                <label>{t("recoverySeconds")}<input name="recovery_seconds" type="number" min="0" /></label>
                <label>{t("targetType")}<select name="target_type"><option value="free">{t("targetFree")}</option><option value="heart_rate">{t("targetHeartRate")}</option><option value="pace">{t("targetPace")}</option><option value="power">{t("targetPower")}</option><option value="rpe">RPE</option></select></label>
              </div>
              <label>{t("exerciseDescription")}<textarea name="description" rows={3} /></label>
            </>
          )}

          {editor.kind === "comment" && (
            <>
              <div className="editor-context"><strong>{editor.workout.title}</strong><small>{t("coachCommentHelp")}</small></div>
              <label>{t("comment")}<textarea name="body" rows={5} required /></label>
            </>
          )}

          {editor.kind === "log" && (
            <>
              <div className="editor-context"><strong>{editor.workout.title}</strong><small>{t("completionHelp")}</small></div>
              <div className="form-grid">
                <label>{t("completedAt")}<input name="completed_at" type="datetime-local" defaultValue={localDateTime()} required /></label>
                <label>{t("actualDuration")}<input name="actual_duration_minutes" type="number" min="1" /></label>
                <label>{t("actualDistance")}<input name="actual_distance_km" type="number" min="0" step="0.01" /></label>
                <label>{t("perceivedEffort")}<input name="perceived_exertion" type="number" min="1" max="10" /></label>
              </div>
              <label>{t("completionNotes")}<textarea name="notes" rows={4} /></label>
            </>
          )}

          <div className="form-actions">
            <button className="secondary" onClick={onClose} type="button">{t("cancel")}</button>
            <button className="primary" disabled={submitting} type="submit">{submitting ? t("saving") : t("save")}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function TrainingPlansPage() {
  const { user } = useAuth();
  const { locale, t } = useLanguage();
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [expandedWorkout, setExpandedWorkout] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const planResponse = await api.plans();
    setPlans(planResponse.results);
    if (user?.role === "coach") {
      const athleteResponse = await api.athletes();
      setRelationships(athleteResponse.results);
    }
  }, [user?.role]);

  useEffect(() => {
    setLoading(true);
    reload().catch((caught) => setError((caught as Error).message)).finally(() => setLoading(false));
  }, [reload]);

  const athletesById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.athlete.id, displayName(relationship)])),
    [relationships],
  );

  async function saved(notice: string) {
    setEditor(null);
    setMessage(notice);
    setError("");
    await reload();
  }

  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const sportLabels: Record<string, string> = {
    running: t("sportRunning"),
    cycling: t("sportCycling"),
    swimming: t("sportSwimming"),
    triathlon: t("sportTriathlon"),
  };
  const statusLabels: Record<string, string> = {
    planned: t("statusPlanned"),
    completed: t("statusCompleted"),
    skipped: t("statusSkipped"),
  };

  return (
    <>
      <div className="section-title plan-toolbar">
        <div><span className="eyebrow">{t("training")}</span><h2>{t("plansAndSessions")}</h2><p>{user?.role === "coach" ? t("coachPlanHelp") : t("athletePlanHelp")}</p></div>
        {user?.role === "coach" && <button className="primary" disabled={!relationships.some((item) => item.is_active)} onClick={() => setEditor({ kind: "plan" })} type="button">+ {t("createPlan")}</button>}
      </div>

      {user?.role === "coach" && (
        <section className="plan-guide" aria-label={t("planGuide")}>
          <article><strong>1</strong><div><h3>{t("planStepOne")}</h3><p>{t("planStepOneText")}</p></div></article>
          <article><strong>2</strong><div><h3>{t("planStepTwo")}</h3><p>{t("planStepTwoText")}</p></div></article>
          <article><strong>3</strong><div><h3>{t("planStepThree")}</h3><p>{t("planStepThreeText")}</p></div></article>
        </section>
      )}

      {message && <div className="notice" role="status">{message}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      {loading && <div className="training-loading">{t("loading")}</div>}
      {!loading && user?.role === "coach" && !relationships.some((item) => item.is_active) && <div className="training-empty">{t("connectAthleteFirst")}</div>}

      {!loading && plans.map((plan) => (
        <section className="manage-plan" key={plan.id}>
          <div className="plan-head">
            <div>
              <span className="eyebrow">{user?.role === "coach" ? athletesById.get(plan.athlete) || t("athlete") : t("trainingPlan")}</span>
              <h3>{plan.title}</h3>
              <p>{plan.description || t("noDescription")}</p>
              <small>{plan.start_date} — {plan.end_date}</small>
            </div>
            <div className="plan-actions">
              <span className={`status ${plan.is_active ? "active" : ""}`}>{plan.is_active ? t("active") : t("archived")}</span>
              {user?.role === "coach" && <button className="secondary compact" onClick={() => setEditor({ kind: "week", plan })} type="button">+ {t("addWeek")}</button>}
            </div>
          </div>

          {!plan.weeks.length && <div className="plan-empty">{t("noWeeks")}</div>}
          {plan.weeks.map((week) => (
            <div className="week-block" key={week.id}>
              <div className="week-head">
                <div><h4>{t("week", { number: week.week_number })}</h4><small>{week.start_date}{week.notes ? ` · ${week.notes}` : ""}</small></div>
                {user?.role === "coach" && <button className="secondary compact" onClick={() => setEditor({ kind: "workout", week })} type="button">+ {t("addWorkout")}</button>}
              </div>

              {!week.workouts.length && <div className="plan-empty small">{t("noWeekWorkouts")}</div>}
              {week.workouts.map((workout) => {
                const expanded = expandedWorkout === workout.id;
                return (
                  <article className={`manage-workout ${expanded ? "expanded" : ""}`} key={workout.id}>
                    <button className="workout-summary" onClick={() => setExpandedWorkout(expanded ? null : workout.id)} type="button">
                      <time><strong>{new Date(workout.scheduled_at).toLocaleDateString(dateLocale, { day: "2-digit" })}</strong><small>{new Date(workout.scheduled_at).toLocaleDateString(dateLocale, { month: "short" })}</small></time>
                      <span className={`sport ${workout.sport}`} />
                      <span className="grow"><strong>{workout.title}</strong><small>{sportLabels[workout.sport] || workout.sport} · {workout.intensity || t("openIntensity")}</small></span>
                      <span><strong>{workout.planned_duration_minutes || "—"} {t("minutes")}</strong><small>{workout.planned_distance_km ? `${workout.planned_distance_km} km` : t("distanceOpen")}</small></span>
                      <span className={`status ${workout.status}`}>{statusLabels[workout.status] || workout.status}</span>
                      <span className="expand-mark">{expanded ? "−" : "+"}</span>
                    </button>

                    {expanded && (
                      <div className="workout-detail">
                        {workout.notes && <p className="workout-notes">{workout.notes}</p>}
                        <div className="detail-columns">
                          <section>
                            <div className="detail-title"><h5>{t("exercises")}</h5>{user?.role === "coach" && <button className="link-action" onClick={() => setEditor({ kind: "exercise", workout })} type="button">+ {t("addExercise")}</button>}</div>
                            {workout.exercises.length ? <ol className="exercise-list">{workout.exercises.map((exercise) => <li key={exercise.id}><strong>{exercise.name}</strong><span>{exercise.description || t("exerciseDetails")}</span><small>{exercise.duration_seconds ? `${exercise.duration_seconds} ${t("seconds")}` : ""}{exercise.distance_meters ? ` · ${exercise.distance_meters} m` : ""}{exercise.recovery_seconds ? ` · ${t("recovery")} ${exercise.recovery_seconds} ${t("seconds")}` : ""}</small></li>)}</ol> : <p className="muted">{t("noExercises")}</p>}
                          </section>
                          <section>
                            <div className="detail-title"><h5>{t("coachComments")}</h5>{user?.role === "coach" && <button className="link-action" onClick={() => setEditor({ kind: "comment", workout })} type="button">+ {t("addComment")}</button>}</div>
                            {workout.coach_comments.length ? <div className="comment-list">{workout.coach_comments.map((comment) => <blockquote key={comment.id}>{comment.body}<small>{comment.coach_name || t("coach")}</small></blockquote>)}</div> : <p className="muted">{t("noCoachComments")}</p>}
                          </section>
                        </div>

                        {workout.log ? (
                          <section className="completion-card">
                            <div><span className="eyebrow">{t("workoutResult")}</span><strong>{t("statusCompleted")}</strong></div>
                            <span>{workout.log.actual_duration_minutes || "—"} {t("minutes")}</span>
                            <span>{workout.log.actual_distance_km ? `${workout.log.actual_distance_km} km` : "—"}</span>
                            <span>RPE {workout.log.perceived_exertion || "—"}</span>
                            {workout.log.notes && <p>{workout.log.notes}</p>}
                          </section>
                        ) : user?.role === "athlete" ? (
                          <button className="primary complete-button" onClick={() => setEditor({ kind: "log", workout })} type="button">{t("markComplete")}</button>
                        ) : <p className="muted completion-pending">{t("awaitingCompletion")}</p>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ))}
        </section>
      ))}

      {!loading && !plans.length && (user?.role === "athlete" || relationships.some((item) => item.is_active)) && <div className="training-empty">{user?.role === "coach" ? t("createFirstPlan") : t("noPlans")}</div>}
      {editor && <EditorPanel editor={editor} relationships={relationships} onClose={() => setEditor(null)} onSaved={saved} />}
    </>
  );
}
