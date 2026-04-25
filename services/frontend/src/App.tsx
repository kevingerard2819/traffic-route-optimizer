import { startTransition, useDeferredValue, useEffect, useState } from "react";

type Vehicle = {
  vehicle_id: string;
  lat: number;
  lon: number;
  speed_kph: number;
  ts: string;
};

type CongestionPrediction = {
  congestion_score: number;
  congestion_level: "light" | "moderate" | "heavy" | "severe";
};

type CongestionSnapshot = {
  n_vehicles: number;
  avg_speed_kph: number;
  prediction: CongestionPrediction;
};

type FetchState = "loading" | "ready" | "error";

const POLL_INTERVAL_MS = 4_000;

function resolveApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const { protocol, hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:8000";
  }

  return `${protocol}//${hostname}:8000`;
}

const API_BASE_URL = resolveApiBaseUrl();

function formatSpeed(value: number): string {
  return `${value.toFixed(1)} km/h`;
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) {
    return "Waiting for a fresh read";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function formatCoordinate(value: number): string {
  return value.toFixed(4);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mapVehiclesToStage(vehicles: Vehicle[]) {
  if (vehicles.length === 0) {
    return [];
  }

  const lats = vehicles.map((vehicle) => vehicle.lat);
  const lons = vehicles.map((vehicle) => vehicle.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latSpan = Math.max(maxLat - minLat, 0.01);
  const lonSpan = Math.max(maxLon - minLon, 0.01);

  return vehicles.map((vehicle) => {
    const x = clamp(((vehicle.lon - minLon) / lonSpan) * 100, 6, 94);
    const y = clamp(100 - ((vehicle.lat - minLat) / latSpan) * 100, 8, 92);
    const signal = clamp(vehicle.speed_kph / 55, 0.28, 1);

    return { vehicle, x, y, signal };
  });
}

export default function App() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [congestion, setCongestion] = useState<CongestionSnapshot | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const loadSnapshot = async () => {
      try {
        const [vehiclesResponse, congestionResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/vehicles`),
          fetch(`${API_BASE_URL}/congestion`),
        ]);

        if (!vehiclesResponse.ok) {
          throw new Error(`Vehicle feed returned ${vehiclesResponse.status}`);
        }

        if (!congestionResponse.ok) {
          throw new Error(`Congestion feed returned ${congestionResponse.status}`);
        }

        const nextVehicles = (await vehiclesResponse.json()) as Vehicle[];
        const nextCongestion = (await congestionResponse.json()) as CongestionSnapshot;

        if (disposed) {
          return;
        }

        startTransition(() => {
          setVehicles(nextVehicles);
          setCongestion(nextCongestion);
          setFetchState("ready");
          setErrorMessage(null);
          setLastUpdated(new Date().toISOString());
          setSelectedVehicleId((current) => {
            if (current && nextVehicles.some((vehicle) => vehicle.vehicle_id === current)) {
              return current;
            }

            return nextVehicles[0]?.vehicle_id ?? null;
          });
        });
      } catch (error) {
        if (disposed) {
          return;
        }

        setFetchState("error");
        setErrorMessage(error instanceof Error ? error.message : "Unknown dashboard error");
      }
    };

    void loadSnapshot();
    const interval = window.setInterval(() => {
      void loadSnapshot();
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, []);

  const deferredVehicles = useDeferredValue(vehicles);

  const selectedVehicle =
    deferredVehicles.find((vehicle) => vehicle.vehicle_id === selectedVehicleId) ??
    deferredVehicles[0] ??
    null;

  const mapPoints = mapVehiclesToStage(deferredVehicles);

  const topSpeed =
    deferredVehicles.length === 0
      ? 0
      : Math.max(...deferredVehicles.map((vehicle) => vehicle.speed_kph));

  const slowFleet = deferredVehicles.filter((vehicle) => vehicle.speed_kph <= 25).length;

  const congestionLevel = congestion?.prediction.congestion_level ?? "light";
  const congestionScore = congestion?.prediction.congestion_score ?? 0;

  return (
    <div className="app-shell">
      <div className="ambient ambient-warm" />
      <div className="ambient ambient-cool" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="live-dot" />
            Fleet telemetry online
          </p>
          <h1>Street-level congestion in one glance.</h1>
          <p className="hero-description">
            Follow the live simulator feed, inspect the latest vehicle positions, and watch the
            congestion model react as the network shifts.
          </p>
        </div>

        <div className="hero-stats">
          <article className="stat-card">
            <span className="stat-label">Active vehicles</span>
            <strong className="stat-value">{congestion?.n_vehicles ?? deferredVehicles.length}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Average speed</span>
            <strong className="stat-value">
              {congestion ? formatSpeed(congestion.avg_speed_kph) : "--"}
            </strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Slow-moving fleet</span>
            <strong className="stat-value">{slowFleet}</strong>
          </article>
          <article className="stat-card">
            <span className="stat-label">Peak speed</span>
            <strong className="stat-value">{formatSpeed(topSpeed)}</strong>
          </article>
        </div>

        <div className="hero-meta">
          <span>API target: {API_BASE_URL}</span>
          <span>Updated {formatTime(lastUpdated)}</span>
        </div>
      </header>

      {fetchState === "error" ? (
        <div className="status-banner status-banner-error">
          <strong>Dashboard feed interrupted.</strong>
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <main className="dashboard">
        <section className="panel panel-map">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">City pulse</p>
              <h2>Vehicle spread across the live grid</h2>
            </div>
            <span className="panel-badge">{deferredVehicles.length} tracked points</span>
          </div>

          <div className="map-stage">
            <div className="map-grid" />
            <div className="map-overlay map-overlay-top">
              <span>San Francisco simulation window</span>
              <span>{fetchState === "loading" ? "Syncing..." : "Streaming"}</span>
            </div>

            {mapPoints.map(({ vehicle, x, y, signal }) => (
              <button
                key={vehicle.vehicle_id}
                className={`map-point ${
                  selectedVehicle?.vehicle_id === vehicle.vehicle_id ? "map-point-active" : ""
                }`}
                onClick={() => setSelectedVehicleId(vehicle.vehicle_id)}
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  opacity: signal,
                }}
                type="button"
              >
                <span>{vehicle.vehicle_id.replace("veh-", "V")}</span>
              </button>
            ))}

            <div className="map-overlay map-overlay-bottom">
              {selectedVehicle ? (
                <article className="vehicle-focus">
                  <div className="vehicle-focus-header">
                    <p>Selected track</p>
                    <strong>{selectedVehicle.vehicle_id}</strong>
                  </div>
                  <dl className="vehicle-focus-grid">
                    <div>
                      <dt>Speed</dt>
                      <dd>{formatSpeed(selectedVehicle.speed_kph)}</dd>
                    </div>
                    <div>
                      <dt>Latitude</dt>
                      <dd>{formatCoordinate(selectedVehicle.lat)}</dd>
                    </div>
                    <div>
                      <dt>Longitude</dt>
                      <dd>{formatCoordinate(selectedVehicle.lon)}</dd>
                    </div>
                    <div>
                      <dt>Freshness</dt>
                      <dd>{formatTime(selectedVehicle.ts)}</dd>
                    </div>
                  </dl>
                </article>
              ) : (
                <div className="empty-state">
                  <strong>No vehicles yet</strong>
                  <span>The dashboard will fill in as soon as the simulator and ingestion start writing data.</span>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="panel panel-insight">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Network condition</p>
              <h2>Congestion model snapshot</h2>
            </div>
            <span className={`severity-pill severity-${congestionLevel}`}>{congestionLevel}</span>
          </div>

          <div className="score-ring">
            <div className="score-ring-core">
              <span>Score</span>
              <strong>{Math.round(congestionScore * 100)}</strong>
            </div>
          </div>

          <div className="score-bar">
            <div className={`score-bar-fill severity-${congestionLevel}`} style={{ width: `${Math.round(congestionScore * 100)}%` }} />
          </div>

          <p className="insight-copy">
            {congestionLevel === "severe" &&
              "The model sees a strong slowdown signature. Expect crowding and longer traversal times."}
            {congestionLevel === "heavy" &&
              "Traffic is thickening. Speeds are falling and the network is beginning to bunch up."}
            {congestionLevel === "moderate" &&
              "Flow is mixed. Some vehicles are slowing, but the network still has room to recover."}
            {congestionLevel === "light" &&
              "Movement is open and steady. Vehicles are keeping pace without sustained drag."}
          </p>

          <div className="mini-metrics">
            <article>
              <span>Samples considered</span>
              <strong>{congestion?.n_vehicles ?? 0}</strong>
            </article>
            <article>
              <span>Model endpoint</span>
              <strong>/predict</strong>
            </article>
          </div>
        </section>

        <section className="panel panel-feed">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Live roster</p>
              <h2>Latest vehicle updates</h2>
            </div>
            <span className="panel-badge">Polls every {POLL_INTERVAL_MS / 1000}s</span>
          </div>

          <div className="vehicle-list">
            {deferredVehicles.map((vehicle) => (
              <button
                key={vehicle.vehicle_id}
                className={`vehicle-card ${
                  selectedVehicle?.vehicle_id === vehicle.vehicle_id ? "vehicle-card-active" : ""
                }`}
                onClick={() => setSelectedVehicleId(vehicle.vehicle_id)}
                type="button"
              >
                <div className="vehicle-card-header">
                  <strong>{vehicle.vehicle_id}</strong>
                  <span>{formatTime(vehicle.ts)}</span>
                </div>
                <div className="vehicle-card-body">
                  <span>{formatSpeed(vehicle.speed_kph)}</span>
                  <span>
                    {formatCoordinate(vehicle.lat)}, {formatCoordinate(vehicle.lon)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel panel-runtime">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Runtime map</p>
              <h2>How the frontend fits the stack</h2>
            </div>
          </div>

          <div className="runtime-flow">
            <article>
              <span>01</span>
              <strong>Simulator</strong>
              <p>Publishes GPS events into Kafka once per second.</p>
            </article>
            <article>
              <span>02</span>
              <strong>Ingestion</strong>
              <p>Collapses the stream into the latest state for each vehicle in SQLite.</p>
            </article>
            <article>
              <span>03</span>
              <strong>API + ML</strong>
              <p>Serves the fleet view and model-backed congestion summary to the browser.</p>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
