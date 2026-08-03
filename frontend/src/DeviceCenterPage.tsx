import { useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage } from "./i18n";
import type { DeviceConnection, DeviceProviderCapability, Relationship, WorkoutDelivery } from "./types";

const emptyCapability: DeviceProviderCapability = {
  provider: "garmin",
  partner_status: "application_required",
  authorization_available: false,
  direct_delivery_available: false,
  manual_fit_available: true,
};

const deliveryStatusKeys = {
  queued: "deliveryStatusQueued",
  processing: "deliveryStatusProcessing",
  delivered: "deliveryStatusDelivered",
  failed: "deliveryStatusFailed",
  canceled: "deliveryStatusCanceled",
} as const;

function connectionState(connection: DeviceConnection | undefined) {
  if (connection?.is_usable) return "connected";
  return connection?.status === "connected" ? "expired" : connection?.status ?? "not_connected";
}

export function DeviceCenterPage() {
  const { user } = useAuth();
  const { locale, t } = useLanguage();
  const [searchParams] = useSearchParams();
  const [capability, setCapability] = useState<DeviceProviderCapability>(emptyCapability);
  const [connections, setConnections] = useState<DeviceConnection[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [deliveries, setDeliveries] = useState<WorkoutDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const isCoach = user?.role === "coach";

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError("");
    const requests: Promise<unknown>[] = [
      api.deviceProviders().then((providers) => setCapability(providers[0] ?? emptyCapability)),
      api.deviceConnections().then((page) => setConnections(page.results)),
      api.workoutDeliveries().then((page) => setDeliveries(page.results)),
    ];
    if (user.role === "coach") {
      requests.push(api.athletes().then((page) => setRelationships(page.results.filter((item) => item.is_active))));
    }
    Promise.all(requests)
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)))
      .finally(() => setLoading(false));
  }, [t, user]);

  const connectionByAthlete = useMemo(
    () => new Map(connections.map((connection) => [connection.athlete.id, connection])),
    [connections],
  );
  const ownConnection = user ? connectionByAthlete.get(user.id) : undefined;
  const connectedCount = connections.filter((connection) => connection.is_usable).length;
  const deliveredCount = deliveries.filter((delivery) => delivery.status === "delivered").length;
  const callbackResult = searchParams.get("garmin");

  async function connectGarmin() {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      const authorization = await api.startGarminAuthorization();
      window.location.assign(authorization.authorization_url);
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
      setWorking(false);
    }
  }

  async function disconnectGarmin() {
    if (!ownConnection || working) return;
    setWorking(true);
    setError("");
    try {
      const updated = await api.disconnectDevice(ownConnection.id);
      setConnections((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="device-center-page">
      <section className="device-center-hero">
        <div>
          <span className="eyebrow">{t("deviceCenterEyebrow")}</span>
          <h2>{isCoach ? t("deviceCenterCoachTitle") : t("deviceCenterAthleteTitle")}</h2>
          <p>{isCoach ? t("deviceCenterCoachIntro") : t("deviceCenterAthleteIntro")}</p>
        </div>
        <div className={`device-readiness ${capability.direct_delivery_available ? "ready" : "preparing"}`}>
          <span>{capability.direct_delivery_available ? "LIVE" : "FIT"}</span>
          <div><strong>{capability.direct_delivery_available ? t("automaticDeliveryReady") : t("manualFitReady")}</strong><small>{capability.direct_delivery_available ? t("automaticDeliveryReadyText") : t("manualFitReadyText")}</small></div>
        </div>
      </section>

      {callbackResult === "connected" && <div className="device-notice success" role="status">{t("garminConnectedNotice")}</div>}
      {callbackResult === "error" && <div className="device-notice error" role="alert">{t("garminConnectionError")}</div>}
      {error && <div className="error" role="alert">{error}</div>}

      <section className="device-summary-grid">
        <article><small>{isCoach ? t("athletesUnderCoaching") : t("connectedDevices")}</small><strong>{isCoach ? relationships.length : ownConnection?.is_usable ? 1 : 0}</strong><span>{isCoach ? t("deviceRosterScope") : t("deviceConsentOwned")}</span></article>
        <article><small>{t("garminConnectedAthletes")}</small><strong>{isCoach ? connectedCount : ownConnection?.is_usable ? t("yes") : t("no")}</strong><span>{t("garminConnectionStatusHelp")}</span></article>
        <article><small>{t("automaticDeliveries")}</small><strong>{deliveredCount}</strong><span>{capability.direct_delivery_available ? t("deliveryHistoryReady") : t("startsAfterApproval")}</span></article>
      </section>

      {loading ? <div className="training-loading">{t("loading")}</div> : isCoach ? (
        <CoachDeviceRoster
          connectionByAthlete={connectionByAthlete}
          dateLocale={dateLocale}
          relationships={relationships}
        />
      ) : (
        <AthleteGarminConnection
          capability={capability}
          connection={ownConnection}
          dateLocale={dateLocale}
          onConnect={() => void connectGarmin()}
          onDisconnect={() => void disconnectGarmin()}
          working={working}
        />
      )}

      {deliveries.length > 0 && <DeliveryHistory dateLocale={dateLocale} deliveries={deliveries.slice(0, 8)} />}

      <section className="device-workflow">
        <div className="section-title"><div><span className="eyebrow">{t("deviceWorkflowEyebrow")}</span><h2>{t("deviceWorkflowTitle")}</h2></div></div>
        <div className="device-workflow-steps">
          <article className="complete"><span>1</span><div><strong>{t("deviceWorkflowBuild")}</strong><p>{t("deviceWorkflowBuildText")}</p></div></article>
          <article className={capability.authorization_available ? "active" : "pending"}><span>2</span><div><strong>{t("deviceWorkflowConsent")}</strong><p>{t("deviceWorkflowConsentText")}</p></div></article>
          <article className={capability.direct_delivery_available ? "active" : "pending"}><span>3</span><div><strong>{t("deviceWorkflowDeliver")}</strong><p>{t("deviceWorkflowDeliverText")}</p></div></article>
        </div>
      </section>
    </main>
  );
}

function DeliveryHistory({
  dateLocale,
  deliveries,
}: {
  dateLocale: string;
  deliveries: WorkoutDelivery[];
}) {
  const { t } = useLanguage();
  return (
    <section className="delivery-history-card">
      <div className="section-title"><div><span className="eyebrow">{t("deliveryHistoryEyebrow")}</span><h2>{t("deliveryHistoryTitle")}</h2></div></div>
      <div className="delivery-history-list">
        {deliveries.map((delivery) => (
          <article key={delivery.id}>
            <span className={`delivery-state-mark ${delivery.status}`}>{delivery.status === "delivered" ? "✓" : delivery.status === "failed" ? "!" : "→"}</span>
            <div><strong>{delivery.workout_title}</strong><small>{delivery.athlete.name} · {new Date(delivery.scheduled_at).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short" })}</small></div>
            <span className={`status ${delivery.status}`}>{t(deliveryStatusKeys[delivery.status])}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export function AthleteGarminConnection({
  capability,
  connection,
  dateLocale,
  onConnect,
  onDisconnect,
  working,
}: {
  capability: DeviceProviderCapability;
  connection?: DeviceConnection;
  dateLocale: string;
  onConnect: () => void;
  onDisconnect: () => void;
  working: boolean;
}) {
  const { t } = useLanguage();
  const state = connectionState(connection);
  return (
    <section className="provider-card">
      <div className="provider-identity"><span className="garmin-wordmark">GARMIN</span><div><h3>{t("garminConnect")}</h3><p>{t("garminProviderDescription")}</p></div></div>
      <div className={`provider-state ${state}`}><i /><div><strong>{connection?.is_usable ? t("deviceConnected") : capability.authorization_available ? t("deviceNotConnected") : t("partnerAccessPending")}</strong><small>{connection?.consented_at ? t("connectedOn", { date: new Date(connection.consented_at).toLocaleDateString(dateLocale) }) : capability.authorization_available ? t("connectGarminHelp") : t("partnerAccessPendingText")}</small></div></div>
      <div className="provider-capabilities">
        <span className="available">✓ {t("personalizedFitFiles")}</span>
        <span className={capability.authorization_available ? "available" : "pending"}>{capability.authorization_available ? "✓" : "○"} {t("secureGarminConsent")}</span>
        <span className={capability.direct_delivery_available ? "available" : "pending"}>{capability.direct_delivery_available ? "✓" : "○"} {t("automaticWatchDelivery")}</span>
      </div>
      <div className="provider-actions">
        {connection?.is_usable ? <button className="secondary" disabled={working} onClick={onDisconnect} type="button">{working ? t("working") : t("disconnectGarmin")}</button> : <button className="primary" disabled={!capability.authorization_available || working} onClick={onConnect} type="button">{working ? t("working") : t("connectGarmin")}</button>}
        <NavLink className="secondary" to="/calendar">{t("openCalendarFit")}</NavLink>
      </div>
      <p className="device-privacy-note">{t("devicePrivacyNote")}</p>
    </section>
  );
}

export function CoachDeviceRoster({
  connectionByAthlete,
  dateLocale,
  relationships,
}: {
  connectionByAthlete: Map<number, DeviceConnection>;
  dateLocale: string;
  relationships: Relationship[];
}) {
  const { t } = useLanguage();
  return (
    <section className="device-roster-card">
      <div className="device-roster-heading"><div><span className="eyebrow">{t("athleteDeviceReadiness")}</span><h3>{t("athleteDeviceRoster")}</h3><p>{t("athleteDeviceRosterHelp")}</p></div><span className="consent-badge">{t("athleteOwnedConsent")}</span></div>
      <div className="device-roster-table">
        {relationships.length ? relationships.map((relationship) => {
          const connection = connectionByAthlete.get(relationship.athlete.id);
          const name = `${relationship.athlete.first_name} ${relationship.athlete.last_name}`.trim() || relationship.athlete.username;
          return (
            <article key={relationship.athlete.id}>
              <span className="device-athlete-avatar">{name[0]}</span>
              <div><strong>{name}</strong><small>@{relationship.athlete.username}</small></div>
              <div className={`roster-connection ${connection?.is_usable ? "connected" : "not-connected"}`}><i /><span><strong>{connection?.is_usable ? t("deviceConnected") : t("deviceNotConnected")}</strong><small>{connection?.consented_at ? t("connectedOn", { date: new Date(connection.consented_at).toLocaleDateString(dateLocale) }) : t("athleteMustConnect")}</small></span></div>
              <NavLink className="secondary" to={`/calendar?athlete_id=${relationship.athlete.id}`}>{t("openCalendar")}</NavLink>
            </article>
          );
        }) : <div className="plan-library-empty">{t("noAthletesForDevices")}</div>}
      </div>
    </section>
  );
}
