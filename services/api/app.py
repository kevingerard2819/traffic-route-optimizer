import os
import sqlite3
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()


def _env(name: str, default: str) -> str:
    v = os.getenv(name)
    return v if v is not None and v.strip() != "" else default


def _cors_origins() -> List[str]:
    configured = os.getenv("CORS_ALLOW_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]

    return [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS gps_latest (
          vehicle_id TEXT PRIMARY KEY,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          speed_kph REAL NOT NULL,
          ts TEXT NOT NULL
        );
        """
    )
    conn.commit()


def _get_conn() -> sqlite3.Connection:
    sqlite_path = _env("SQLITE_PATH", "/data/traffic.db")
    sqlite_dir = os.path.dirname(sqlite_path)
    if sqlite_dir:
        os.makedirs(sqlite_dir, exist_ok=True)

    conn = sqlite3.connect(sqlite_path, check_same_thread=False)
    _ensure_schema(conn)
    return conn


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/vehicles")
def list_vehicles(limit: int = 100) -> List[Dict[str, Any]]:
    conn = _get_conn()
    try:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT vehicle_id, lat, lon, speed_kph, ts
            FROM gps_latest
            ORDER BY ts DESC
            LIMIT ?;
            """,
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@app.get("/vehicles/{vehicle_id}")
def get_vehicle(vehicle_id: str) -> Dict[str, Any]:
    conn = _get_conn()
    try:
        conn.row_factory = sqlite3.Row
        row: Optional[sqlite3.Row] = conn.execute(
            """
            SELECT vehicle_id, lat, lon, speed_kph, ts
            FROM gps_latest
            WHERE vehicle_id = ?;
            """,
            (vehicle_id,),
        ).fetchone()

        if row is None:
            raise HTTPException(status_code=404, detail="vehicle not found")

        return dict(row)
    finally:
        conn.close()


@app.get("/congestion")
def get_congestion(limit: int = 100) -> Dict[str, Any]:
    conn = _get_conn()
    try:
        row = conn.execute(
            """
            SELECT AVG(speed_kph) AS avg_speed_kph, COUNT(1) AS n
            FROM (
              SELECT speed_kph
              FROM gps_latest
              ORDER BY ts DESC
              LIMIT ?
            );
            """,
            (limit,),
        ).fetchone()

        avg_speed_kph = float(row[0] or 0.0)
        n = int(row[1] or 0)
    finally:
        conn.close()

    ml_base_url = _env("ML_BASE_URL", "http://localhost:7000")
    with httpx.Client(timeout=2.0) as client:
        resp = client.post(f"{ml_base_url}/predict", json={"avg_speed_kph": avg_speed_kph})
        resp.raise_for_status()
        pred = resp.json()

    return {
        "n_vehicles": n,
        "avg_speed_kph": avg_speed_kph,
        "prediction": pred,
    }
