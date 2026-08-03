import { useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useAuth } from "./auth";
import { localizeApiError, useLanguage, type TranslationKey } from "./i18n";
import type {
  DeviceConnection,
  DeviceProvider,
  DeviceProviderCapability,
  Relationship,
  WorkoutDelivery,
} from "./types";

const providers: DeviceProvider[] = ["garmin", "strava", "suunto", "coros"];

const providerCopy: Record<DeviceProvider, { description: TranslationKey; name: TranslationKey }> = {
  garmin: { description: "garminProviderDescription", name: "garminConnect" },
  strava: { description: "stravaProviderDescription", name: "stravaConnect" },
  suunto: { description: "suuntoProviderDescription", name: "suuntoConnect" },
  coros: { description: "corosProviderDescription", name: "corosConnect" },
};

const deliveryStatusKeys = {
  queued: "deliveryStatusQueued",
  processing: "deliveryStatusProcessing",
  delivered: "deliveryStatusDelivered",
  failed: "deliveryStatusFailed",
  canceled: "deliveryStatusCanceled",
} as const;

function fallbackCapability(provider: DeviceProvider): DeviceProviderCapability {
  return {
    provider,
    partner_status: "application_required",
    authorization_available: false,
    direct_delivery_available: false,
    manual_fit_available: provider === "garmin",
    activity_import_available: false,
    automatic_activity_sync_available: false,
  };
}

function connectionKey(athleteId: number, provider: DeviceProvider) {
  return `${athleteId}:${provider}`;
}

function connectionState(connection: DeviceConnection | undefined) {
  if (connection?.is_usable) return "connected";
  return connection?.status === "connected" ? "expired" : connection?.status ?? "not_connected";
}

export function DeviceCenterPage() {
  const { user } = useAuth();
  const { locale, t } = useLanguage();
  const [searchParams] = useSearchParams();
  const [capabilities, setCapabilities] = useState<DeviceProviderCapability[]>([]);
  const [connections, setConnections] = useState<DeviceConnection[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [deliveries, setDeliveries] = useState<WorkoutDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingProvider, setWorkingProvider] = useState<DeviceProvider | null>(null);
  const [error, setError] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
  const isCoach = user?.role === "coach";

  async function loadConnections() {
    const page = await api.deviceConnections();
    setConnections(page.results);
  }

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    setError("");
    const requests: Promise<unknown>[] = [
      api.deviceProviders().then(setCapabilities),
      loadConnections(),
      api.workoutDeliveries().then((page) => setDeliveries(page.results)),
    ];
    if (user.role === "coach") {
      requests.push(api.athletes().then((page) => setRelationships(page.results.filter((item) => item.is_active))));
    }
    Promise.all(requests)
      .catch((caught) => setError(localizeApiError((caught as Error).message, t)))
      .finally(() => setLoading(false));
  }, [t, user]);

  const capabilityByProvider = useMemo(
    () => new Map(capabilities.map((capability) => [capability.provider, capability])),
    [capabilities],
  );
  const connectionByAthleteProvider = useMemo(
    () => new Map(connections.map((connection) => [connectionKey(connection.athlete.id, connection.provider), connection])),
    [connections],
  );
  const usableConnections = connections.filter((connection) => connection.is_usable);
  const connectedAthletes = new Set(usableConnections.map((connection) => connection.athlete.id)).size;
  const deliveredCount = deliveries.filter((delivery) => delivery.status === "delivered").length;
  const garminCapability = capabilityByProvider.get("garmin") ?? fallbackCapability("garmin");
  const stravaCapability = capabilityByProvider.get("strava") ?? fallbackCapability("strava");

  async function connectProvider(provider: "garmin" | "strava") {
    if (workingProvider) return;
    setWorkingProvider(provider);
    setError("");
    try {
      const authorization = provider === "garmin"
        ? await api.startGarminAuthorization()
        : await api.startStravaAuthorization();
      window.location.assign(authorization.authorization_url);
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
      setWorkingProvider(null);
    }
  }

  async function disconnectProvider(connection: DeviceConnection) {
    if (workingProvider) return;
    setWorkingProvider(connection.provider);
    setError("");
    try {
      const updated = await api.disconnectDevice(connection.id);
      setConnections((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setWorkingProvider(null);
    }
  }

  async function synchronizeActivities(connection: DeviceConnection) {
    if (workingProvider) return;
    setWorkingProvider(connection.provider);
    setError("");
    setSyncNotice("");
    try {
      const result = await api.syncDevice(connection.id);
      setSyncNotice(t("activitySyncComplete", {
        imported: result.imported,
        skipped: result.skipped,
        updated: result.updated,
      }));
      await loadConnections();
    } catch (caught) {
      setError(localizeApiError((caught as Error).message, t));
    } finally {
      setWorkingProvider(null);
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
        <div className={`device-readiness ${garminCapability.direct_delivery_available || stravaCapability.activity_import_available ? "ready" : "preparing"}`}>
          <span>{garminCapability.direct_delivery_available ? "LIVE" : stravaCapability.activity_import_available ? "SYNC" : "FIT"}</span>
          <div>
            <strong>{garminCapability.direct_delivery_available ? t("automaticDeliveryReady") : stravaCapability.activity_import_available ? t("completedActivityImport") : t("manualFitReady")}</strong>
            <small>{garminCapability.direct_delivery_available ? t("automaticDeliveryReadyText") : stravaCapability.activity_import_available ? t("stravaProviderDescription") : t("manualFitReadyText")}</small>
          </div>
        </div>
      </section>

      {searchParams.get("garmin") === "connected" && <div className="device-notice success" role="status">{t("garminConnectedNotice")}</div>}
      {searchParams.get("garmin") === "error" && <div className="device-notice error" role="alert">{t("garminConnectionError")}</div>}
      {searchParams.get("strava") === "connected" && <div className="device-notice success" role="status">{t("stravaConnectedNotice")}</div>}
      {searchParams.get("strava") === "error" && <div className="device-notice error" role="alert">{t("stravaConnectionError")}</div>}
      {syncNotice && <div className="device-notice success" role="status">{syncNotice}</div>}
      {error && <div className="error" role="alert">{error}</div>}

      <section className="device-summary-grid">
        <article>
          <small>{isCoach ? t("athletesUnderCoaching") : t("connectedIntegrations")}</small>
          <strong>{isCoach ? relationships.length : usableConnections.length}</strong>
          <span>{isCoach ? t("deviceRosterScope") : t("deviceConsentOwned")}</span>
        </article>
        <article>
          <small>{t("providerConnections")}</small>
          <strong>{isCoach ? connectedAthletes : usableConnections.length ? t("yes") : t("no")}</strong>
          <span>{t("garminConnectionStatusHelp")}</span>
        </article>
        <article>
          <small>{t("automaticDeliveries")}</small>
          <strong>{deliveredCount}</strong>
          <span>{garminCapability.direct_delivery_available ? t("deliveryHistoryReady") : t("startsAfterApproval")}</span>
        </article>
      </section>

      {loading ? <div className="training-loading">{t("loading")}</div> : isCoach ? (
        <CoachDeviceRoster
          connectionByAthleteProvider={connectionByAthleteProvider}
          dateLocale={dateLocale}
          relationships={relationships}
        />
      ) : (
        <section className="provider-grid">
          {providers.map((provider) => (
            <AthleteProviderConnection
              capability={capabilityByProvider.get(provider) ?? fallbackCapability(provider)}
              connection={user ? connectionByAthleteProvider.get(connectionKey(user.id, provider)) : undefined}
              dateLocale={dateLocale}
              key={provider}
              onConnect={provider === "garmin" || provider === "strava" ? () => void connectProvider(provider) : undefined}
              onDisconnect={(connection) => void disconnectProvider(connection)}
              onSync={(connection) => void synchronizeActivities(connection)}
              working={workingProvider === provider}
            />
          ))}
        </section>
      )}

      {deliveries.length > 0 && <DeliveryHistory dateLocale={dateLocale} deliveries={deliveries.slice(0, 8)} />}

      <section className="device-workflow">
        <div className="section-title"><div><span className="eyebrow">{t("deviceWorkflowEyebrow")}</span><h2>{t("deviceWorkflowTitle")}</h2></div></div>
        <div className="device-workflow-steps">
          <article className="complete"><span>1</span><div><strong>{t("deviceWorkflowBuild")}</strong><p>{t("deviceWorkflowBuildText")}</p></div></article>
          <article className={garminCapability.authorization_available || stravaCapability.authorization_available ? "active" : "pending"}><span>2</span><div><strong>{t("deviceWorkflowConsent")}</strong><p>{t("deviceWorkflowConsentText")}</p></div></article>
          <article className={garminCapability.direct_delivery_available || stravaCapability.activity_import_available ? "active" : "pending"}><span>3</span><div><strong>{t("deviceWorkflowDeliver")}</strong><p>{t("deviceWorkflowDeliverText")}</p></div></article>
        </div>
      </section>
    </main>
  );
}

function DeliveryHistory({ dateLocale, deliveries }: { dateLocale: string; deliveries: WorkoutDelivery[] }) {
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

export function AthleteProviderConnection({
  capability,
  connection,
  dateLocale,
  onConnect,
  onDisconnect,
  onSync,
  working,
}: {
  capability: DeviceProviderCapability;
  connection?: DeviceConnection;
  dateLocale: string;
  onConnect?: () => void;
  onDisconnect: (connection: DeviceConnection) => void;
  onSync: (connection: DeviceConnection) => void;
  working: boolean;
}) {
  const { t } = useLanguage();
  const state = connectionState(connection);
  const provider = capability.provider;
  const isGarmin = provider === "garmin";
  const isStrava = provider === "strava";
  const canAuthorize = capability.authorization_available && onConnect;
  const syncDate = connection?.last_synced_at
    ? t("lastSynchronized", { date: new Date(connection.last_synced_at).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short" }) })
    : t("notSynchronizedYet");

  return (
    <article className={`provider-card provider-${provider}`}>
      <div className="provider-identity">
        <span className={`provider-wordmark ${provider}`}>{provider.toUpperCase()}</span>
        <div><h3>{t(providerCopy[provider].name)}</h3><p>{t(providerCopy[provider].description)}</p></div>
      </div>
      <div className={`provider-state ${state}`}>
        <i />
        <div>
          <strong>{connection?.is_usable ? t("deviceConnected") : canAuthorize ? t("deviceNotConnected") : t("partnerAccessPending")}</strong>
          <small>{connection?.is_usable ? (isStrava ? syncDate : connection.consented_at ? t("connectedOn", { date: new Date(connection.consented_at).toLocaleDateString(dateLocale) }) : t("deviceConnected")) : canAuthorize ? (isGarmin ? t("connectGarminHelp") : t("stravaProviderDescription")) : t("partnerApiRequiredText")}</small>
        </div>
      </div>
      <div className="provider-capabilities">
        {isGarmin ? <>
          <span className="available">✓ {t("personalizedFitFiles")}</span>
          <span className={capability.authorization_available ? "available" : "pending"}>{capability.authorization_available ? "✓" : "○"} {t("secureGarminConsent")}</span>
          <span className={capability.direct_delivery_available ? "available" : "pending"}>{capability.direct_delivery_available ? "✓" : "○"} {t("automaticWatchDelivery")}</span>
        </> : isStrava ? <>
          <span className={capability.activity_import_available ? "available" : "pending"}>{capability.activity_import_available ? "✓" : "○"} {t("completedActivityImport")}</span>
          <span className={capability.activity_import_available ? "available" : "pending"}>{capability.activity_import_available ? "✓" : "○"} {t("automaticActivityMatching")}</span>
          <span className={capability.automatic_activity_sync_available ? "available" : "pending"}>{capability.automatic_activity_sync_available ? "✓" : "○"} {t("backgroundActivitySync")}</span>
        </> : <span className="pending">○ {t("partnerApiRequired")}</span>}
      </div>
      <div className="provider-actions">
        {connection?.is_usable ? <>
          {isStrava && <button className="primary" disabled={working} onClick={() => onSync(connection)} type="button">{working ? t("working") : t("synchronizeActivities")}</button>}
          <button className="secondary" disabled={working} onClick={() => onDisconnect(connection)} type="button">{working ? t("working") : isGarmin ? t("disconnectGarmin") : t("disconnectStrava")}</button>
        </> : (isGarmin || isStrava) && <button className="primary" disabled={!canAuthorize || working} onClick={onConnect} type="button">{working ? t("working") : isGarmin ? t("connectGarmin") : t("connectStrava")}</button>}
        {isGarmin && <NavLink className="secondary" to="/calendar">{t("openCalendarFit")}</NavLink>}
      </div>
      <p className="device-privacy-note">{connection?.is_usable ? t("devicePrivacyNote") : !canAuthorize ? t("partnerApiRequiredText") : t("deviceConsentOwned")}</p>
    </article>
  );
}

export function CoachDeviceRoster({
  connectionByAthleteProvider,
  dateLocale,
  relationships,
}: {
  connectionByAthleteProvider: Map<string, DeviceConnection>;
  dateLocale: string;
  relationships: Relationship[];
}) {
  const { t } = useLanguage();
  return (
    <section className="device-roster-card">
      <div className="device-roster-heading"><div><span className="eyebrow">{t("athleteDeviceReadiness")}</span><h3>{t("athleteDeviceRoster")}</h3><p>{t("athleteDeviceRosterHelp")}</p></div><span className="consent-badge">{t("athleteOwnedConsent")}</span></div>
      <div className="device-roster-table">
        {relationships.length ? relationships.map((relationship) => {
          const athleteConnections = providers
            .map((provider) => connectionByAthleteProvider.get(connectionKey(relationship.athlete.id, provider)))
            .filter((connection): connection is DeviceConnection => Boolean(connection?.is_usable));
          const latestConsent = athleteConnections.map((connection) => connection.consented_at).filter(Boolean).sort().at(-1);
          const name = `${relationship.athlete.first_name} ${relationship.athlete.last_name}`.trim() || relationship.athlete.username;
          return (
            <article key={relationship.athlete.id}>
              <span className="device-athlete-avatar">{name[0]}</span>
              <div><strong>{name}</strong><small>@{relationship.athlete.username}</small></div>
              <div className={`roster-connection ${athleteConnections.length ? "connected" : "not-connected"}`}>
                <i />
                <span>
                  <strong>{athleteConnections.length ? t("deviceConnected") : t("deviceNotConnected")}</strong>
                  <small>{latestConsent ? t("connectedOn", { date: new Date(latestConsent).toLocaleDateString(dateLocale) }) : t("athleteMustConnectProvider")}</small>
                  {athleteConnections.length > 0 && <span className="provider-badges">{athleteConnections.map((connection) => <b className={connection.provider} key={connection.provider}>{connection.provider.toUpperCase()}</b>)}</span>}
                </span>
              </div>
              <NavLink className="secondary" to={`/calendar?athlete_id=${relationship.athlete.id}`}>{t("openCalendar")}</NavLink>
            </article>
          );
        }) : <div className="plan-library-empty">{t("noAthletesForDevices")}</div>}
      </div>
    </section>
  );
}
