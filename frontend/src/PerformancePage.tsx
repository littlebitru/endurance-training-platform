import { useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage, type TranslationKey } from "./i18n";
import type {
  PerformanceInsights,
  PerformancePoint,
  Relationship,
  TrainingBalanceStatus,
} from "./types";

const balanceLabelKeys: Record<TrainingBalanceStatus, TranslationKey> = {
  very_fresh: "balanceVeryFresh",
  fresh: "balanceFresh",
  balanced: "balanceBalanced",
  building: "balanceBuilding",
  high_load: "balanceHighLoad",
};

const balanceAdviceKeys: Record<TrainingBalanceStatus, TranslationKey> = {
  very_fresh: "balanceVeryFreshAdvice",
  fresh: "balanceFreshAdvice",
  balanced: "balanceBalancedAdvice",
  building: "balanceBuildingAdvice",
  high_load: "balanceHighLoadAdvice",
};

const sportLabelKeys: Record<string, TranslationKey> = {
  running: "sportRunning",
  cycling: "sportCycling",
  swimming: "sportSwimming",
  triathlon: "sportTriathlon",
};

export function PerformancePage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const isCoach = user?.role === "coach";
  const userId = user?.id;
  const requestedAthleteId = Number(searchParams.get("athlete_id")) || undefined;
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [athleteId, setAthleteId] = useState<number | undefined>(isCoach ? undefined : user?.id);
  const [sport, setSport] = useState("");
  const [rangeDays, setRangeDays] = useState<84 | 183>(84);
  const [insights, setInsights] = useState<PerformanceInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    if (!isCoach) {
      setAthleteId(userId);
      return;
    }
    setLoading(true);
    api.athletes()
      .then((response) => {
        const active = response.results.filter((relationship) => relationship.is_active);
        setRelationships(active);
        const requested = active.find((relationship) => relationship.athlete.id === requestedAthleteId);
        setAthleteId((current) => requested?.athlete.id ?? current ?? active[0]?.athlete.id);
      })
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)))
      .finally(() => setLoading(false));
  }, [isCoach, requestedAthleteId, t, userId]);

  useEffect(() => {
    if (!userId || !athleteId) {
      setInsights(null);
      return;
    }
    const range = performanceRange(rangeDays);
    setLoading(true);
    setError("");
    api.performanceInsights(isCoach ? athleteId : undefined, range.dateFrom, range.dateTo, sport || undefined)
      .then(setInsights)
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)))
      .finally(() => setLoading(false));
  }, [athleteId, isCoach, rangeDays, sport, t, userId]);

  return (
    <div className="performance-page">
      <div className="section-title performance-title">
        <div>
          <span className="eyebrow">{t("performanceWorkspace")}</span>
          <h2>{t("performanceTitle")}</h2>
          <p>{isCoach ? t("coachPerformanceIntro") : t("athletePerformanceIntro")}</p>
        </div>
        <div className="performance-controls">
          {isCoach && (
            <label>
              <span>{t("selectAthleteForPerformance")}</span>
              <select
                aria-label={t("selectAthleteForPerformance")}
                onChange={(event) => setAthleteId(Number(event.target.value))}
                value={athleteId ?? ""}
              >
                {relationships.map((relationship) => (
                  <option key={relationship.id} value={relationship.athlete.id}>
                    {athleteName(relationship)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span>{t("sport")}</span>
            <select aria-label={t("sport")} onChange={(event) => setSport(event.target.value)} value={sport}>
              <option value="">{t("allSports")}</option>
              {Object.entries(sportLabelKeys).map(([value, key]) => (
                <option key={value} value={value}>{t(key)}</option>
              ))}
            </select>
          </label>
          <div className="performance-range" role="group" aria-label={t("performancePeriod")}>
            <button className={rangeDays === 84 ? "active" : ""} onClick={() => setRangeDays(84)} type="button">
              {t("lastTwelveWeeks")}
            </button>
            <button className={rangeDays === 183 ? "active" : ""} onClick={() => setRangeDays(183)} type="button">
              {t("lastSixMonths")}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="error" role="alert">{error}</div>}
      {loading && <div className="performance-loading"><span />{t("loading")}</div>}
      {!loading && isCoach && relationships.length === 0 && <div className="empty">{t("noAthletes")}</div>}

      {!loading && insights && (
        <>
          <PerformanceSummary insights={insights} />
          {!insights.data_quality.has_history && (
            <section className="performance-empty-state">
              <div>
                <span className="eyebrow">{t("dataCoverage")}</span>
                <h3>{t("noPerformanceHistory")}</h3>
                <p>{t("noPerformanceHistoryText")}</p>
              </div>
              <NavLink className="secondary" to="/activities">{t("importFirstActivity")} →</NavLink>
            </section>
          )}
          <PerformanceChart insights={insights} />
          <section className="performance-decision-grid">
            <article className={`performance-decision ${insights.summary.balance_status}`}>
              <span className="eyebrow">{t("decisionSupport")}</span>
              <div className="performance-balance-heading">
                <div>
                  <small>{t("trainingBalance")}</small>
                  <h3>{t(balanceLabelKeys[insights.summary.balance_status])}</h3>
                </div>
                <strong>{formatSigned(insights.summary.form)}</strong>
              </div>
              <p>{t(balanceAdviceKeys[insights.summary.balance_status])}</p>
              <div className="forecast-end">
                <span>{t("forecastAtEnd")}</span>
                <b>{t("fitness")} {formatNumber(insights.summary.forecast_fitness)}</b>
                <b>{t("form")} {formatSigned(insights.summary.forecast_form)}</b>
              </div>
            </article>
            <article className="performance-method">
              <span className="eyebrow">{t("performanceMethod")}</span>
              <p>{t("performanceMethodText")}</p>
              <small>{t("performanceDisclaimer")}</small>
            </article>
            <article className="performance-coverage">
              <span className="eyebrow">{t("dataCoverage")}</span>
              <div>
                <strong>{insights.data_quality.activities_count}</strong>
                <span>{t("activitiesAnalyzed")}</span>
              </div>
              <div>
                <strong>{insights.data_quality.planned_workouts_count}</strong>
                <span>{t("plannedWorkoutsAnalyzed")}</span>
              </div>
              <NavLink to="/activities">{t("openFullAnalysis")} →</NavLink>
            </article>
          </section>
        </>
      )}
    </div>
  );
}

function PerformanceSummary({ insights }: { insights: PerformanceInsights }) {
  const { t } = useLanguage();
  const metrics = [
    { label: t("fitness"), value: formatNumber(insights.summary.fitness), tone: "fitness" },
    { label: t("fatigue"), value: formatNumber(insights.summary.fatigue), tone: "fatigue" },
    { label: t("form"), value: formatSigned(insights.summary.form), tone: "form" },
    { label: t("sevenDayLoad"), value: formatNumber(insights.summary.seven_day_load), tone: "load" },
    {
      label: t("forecastChange"),
      value: formatSigned(insights.summary.forecast_fitness_change),
      tone: "forecast",
    },
  ];
  return (
    <section className="performance-summary">
      <div className="performance-summary-athlete">
        <span>{insights.athlete.name.slice(0, 1).toUpperCase()}</span>
        <div><small>{t("athlete")}</small><strong>{insights.athlete.name}</strong></div>
      </div>
      {metrics.map((metric) => (
        <article className={metric.tone} key={metric.label}>
          <small>{metric.label}</small>
          <strong>{metric.value}</strong>
        </article>
      ))}
    </section>
  );
}

function PerformanceChart({ insights }: { insights: PerformanceInsights }) {
  const { locale, t } = useLanguage();
  const points = insights.points;
  const todayIndex = Math.max(0, lastHistoricalPointIndex(points));
  const [selectedIndex, setSelectedIndex] = useState(todayIndex);
  const selected = points[selectedIndex] ?? points[todayIndex];
  const dimensions = useMemo(() => chartDimensions(points), [points]);
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";

  useEffect(() => setSelectedIndex(todayIndex), [insights.date_from, todayIndex]);

  if (!points.length || !selected) return null;
  const {
    width,
    height,
    left,
    top,
    innerHeight,
    x,
    y,
    zeroY,
    tickIndices,
    yTicks,
  } = dimensions;
  const projectedStart = points.findIndex((point) => point.projected);
  const projectionX = projectedStart >= 0 ? x(projectedStart) : width;
  const barWidth = Math.max(1.5, Math.min(7, (width - left - 24) / points.length * 0.58));

  return (
    <section className="performance-chart-card">
      <header>
        <div>
          <span className="eyebrow">{t("loadChart")}</span>
          <h3>{t("loadChartIntro")}</h3>
        </div>
        <div className="performance-legend">
          <span className="actual">{t("historicalActual")}</span>
          <span className="planned">{t("publishedPlan")}</span>
          <span className="fitness">{t("fitness")}</span>
          <span className="fatigue">{t("fatigue")}</span>
          <span className="form">{t("form")}</span>
        </div>
      </header>
      <div className="performance-readout" aria-live="polite">
        <div>
          <small>{t("selectedDay")}</small>
          <strong>{formatDate(selected.date, dateLocale, { day: "numeric", month: "long", year: "numeric" })}</strong>
        </div>
        <MetricReadout label={t("actualTrainingLoad")} value={formatNumber(selected.actual_load)} />
        <MetricReadout label={t("plannedTrainingLoad")} value={formatNumber(selected.planned_load)} />
        <MetricReadout label={t("fitness")} value={formatNumber(selected.fitness)} />
        <MetricReadout label={t("fatigue")} value={formatNumber(selected.fatigue)} />
        <MetricReadout label={t("form")} value={formatSigned(selected.form)} />
      </div>
      <div className="performance-svg-wrap">
        <svg
          aria-label={t("loadChart")}
          className="performance-chart"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {projectedStart >= 0 && (
            <rect
              className="performance-projection"
              height={innerHeight}
              width={Math.max(0, width - 24 - projectionX)}
              x={projectionX}
              y={top}
            />
          )}
          {yTicks.map((tick) => (
            <g className="performance-y-tick" key={tick}>
              <line x1={left} x2={width - 24} y1={y(tick)} y2={y(tick)} />
              <text x={left - 9} y={y(tick) + 4}>{Math.round(tick)}</text>
            </g>
          ))}
          <line className="performance-zero" x1={left} x2={width - 24} y1={zeroY} y2={zeroY} />
          {points.map((point, index) => (
            <g key={point.date}>
              {Number(point.actual_load) > 0 && (
                <rect
                  className="performance-load actual"
                  height={Math.max(1, zeroY - y(Number(point.actual_load)))}
                  width={barWidth}
                  x={x(index) - barWidth - 0.5}
                  y={y(Number(point.actual_load))}
                />
              )}
              {Number(point.planned_load) > 0 && (
                <rect
                  className="performance-load planned"
                  height={Math.max(1, zeroY - y(Number(point.planned_load)))}
                  width={barWidth}
                  x={x(index) + 0.5}
                  y={y(Number(point.planned_load))}
                />
              )}
            </g>
          ))}
          <path className="performance-line fitness" d={linePath(points, "fitness", x, y)} />
          <path className="performance-line fatigue" d={linePath(points, "fatigue", x, y)} />
          <path className="performance-line form" d={linePath(points, "form", x, y)} />
          {todayIndex >= 0 && (
            <line className="performance-today" x1={x(todayIndex)} x2={x(todayIndex)} y1={top} y2={top + innerHeight} />
          )}
          <line
            className="performance-selection"
            x1={x(selectedIndex)}
            x2={x(selectedIndex)}
            y1={top}
            y2={top + innerHeight}
          />
          {points.map((point, index) => (
            <circle
              aria-label={formatDate(point.date, dateLocale, { day: "numeric", month: "long" })}
              className="performance-hit"
              cx={x(index)}
              cy={top + innerHeight / 2}
              key={point.date}
              onClick={() => setSelectedIndex(index)}
              onFocus={() => setSelectedIndex(index)}
              onMouseEnter={() => setSelectedIndex(index)}
              r={Math.min(9, Math.max(4, (width - left - 24) / points.length / 2))}
              role="button"
              tabIndex={0}
            />
          ))}
          {tickIndices.map((index) => (
            <text className="performance-x-label" key={points[index].date} x={x(index)} y={height - 12}>
              {formatDate(points[index].date, dateLocale, { day: "numeric", month: "short" })}
            </text>
          ))}
        </svg>
      </div>
      <div className="performance-scrubber">
        <span>{formatDate(points[0].date, dateLocale, { day: "numeric", month: "short" })}</span>
        <input
          aria-label={t("selectedDay")}
          max={points.length - 1}
          min={0}
          onChange={(event) => setSelectedIndex(Number(event.target.value))}
          type="range"
          value={selectedIndex}
        />
        <span>{formatDate(points[points.length - 1].date, dateLocale, { day: "numeric", month: "short" })}</span>
      </div>
    </section>
  );
}

function MetricReadout({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

function chartDimensions(points: PerformancePoint[]) {
  const width = 1080;
  const height = 390;
  const left = 52;
  const right = 24;
  const top = 22;
  const bottom = 48;
  const innerWidth = width - left - right;
  const innerHeight = height - top - bottom;
  const values = points.flatMap((point) => [
    Number(point.actual_load),
    Number(point.planned_load),
    Number(point.fitness),
    Number(point.fatigue),
    Number(point.form),
  ]);
  const rawMax = Math.max(10, ...values);
  const rawMin = Math.min(-10, ...values);
  const maxValue = Math.ceil(rawMax / 10) * 10;
  const minValue = Math.floor(rawMin / 10) * 10;
  const valueRange = maxValue - minValue || 1;
  const x = (index: number) => left + (points.length === 1 ? 0 : index / (points.length - 1) * innerWidth);
  const y = (value: number) => top + (maxValue - value) / valueRange * innerHeight;
  const tickCount = Math.min(6, points.length);
  const tickIndices = Array.from(
    new Set(Array.from({ length: tickCount }, (_, index) => Math.round(index * (points.length - 1) / (tickCount - 1)))),
  );
  const yTicks = Array.from({ length: 5 }, (_, index) => minValue + valueRange * index / 4);
  return { width, height, left, top, innerHeight, x, y, zeroY: y(0), tickIndices, yTicks };
}

function linePath(
  points: PerformancePoint[],
  key: "fitness" | "fatigue" | "form",
  x: (index: number) => number,
  y: (value: number) => number,
) {
  return points.map((point, index) => `${index ? "L" : "M"} ${x(index).toFixed(2)} ${y(Number(point[key])).toFixed(2)}`).join(" ");
}

function lastHistoricalPointIndex(points: PerformancePoint[]) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (!points[index].projected) return index;
  }
  return 0;
}

function performanceRange(days: 84 | 183) {
  const today = new Date();
  const dateTo = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  dateTo.setDate(dateTo.getDate() + 28);
  const dateFrom = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  dateFrom.setDate(dateFrom.getDate() - (days - 29));
  return { dateFrom: localDateKey(dateFrom), dateTo: localDateKey(dateTo) };
}

function localDateKey(value: Date) {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
  ].join("-");
}

function athleteName(relationship: Relationship) {
  return `${relationship.athlete.first_name} ${relationship.athlete.last_name}`.trim()
    || relationship.athlete.username;
}

function formatNumber(value: string) {
  return String(Math.round(Number(value) * 10) / 10);
}

function formatSigned(value: string) {
  const number = Number(formatNumber(value));
  return `${number > 0 ? "+" : ""}${number}`;
}

function formatDate(
  value: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(locale, options);
}
