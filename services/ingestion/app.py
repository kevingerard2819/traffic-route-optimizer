import json
import os
import sqlite3
import time
from typing import Any, Dict

from kafka import KafkaConsumer


def _env(name: str, default: str) -> str:
    v = os.getenv(name)
    return v if v is not None and v.strip() != "" else default


def _connect(sqlite_path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(sqlite_path), exist_ok=True)
    conn = sqlite3.connect(sqlite_path, check_same_thread=False)
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
    return conn


def _upsert(conn: sqlite3.Connection, e: Dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO gps_latest(vehicle_id, lat, lon, speed_kph, ts)
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(vehicle_id) DO UPDATE SET
          lat=excluded.lat,
          lon=excluded.lon,
          speed_kph=excluded.speed_kph,
          ts=excluded.ts;
        """,
        (
            e["vehicle_id"],
            float(e["lat"]),
            float(e["lon"]),
            float(e["speed_kph"]),
            str(e["ts"]),
        ),
    )


def main() -> None:
    bootstrap = _env("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    topic = _env("GPS_TOPIC", "gps-events")
    sqlite_path = _env("SQLITE_PATH", "/data/traffic.db")

    conn = _connect(sqlite_path)

    consumer = KafkaConsumer(
        topic,
        bootstrap_servers=bootstrap,
        group_id="mapsml-ingestion",
        enable_auto_commit=True,
        auto_offset_reset="earliest",
        value_deserializer=lambda b: json.loads(b.decode("utf-8")),
    )

    while True:
        any_msg = False
        for msg in consumer:
            any_msg = True
            _upsert(conn, msg.value)
            conn.commit()

        if not any_msg:
            time.sleep(0.25)


if __name__ == "__main__":
    main()
