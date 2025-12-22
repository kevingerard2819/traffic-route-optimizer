import json
import os
import random
import time
from datetime import datetime, timezone

from kafka import KafkaProducer


def _env(name: str, default: str) -> str:
    v = os.getenv(name)
    return v if v is not None and v.strip() != "" else default


def main() -> None:
    bootstrap = _env("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    topic = _env("GPS_TOPIC", "gps-events")
    interval_s = float(_env("PUBLISH_INTERVAL_SECONDS", "1"))

    producer = KafkaProducer(
        bootstrap_servers=bootstrap,
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )

    vehicle_ids = [f"veh-{i:03d}" for i in range(1, 11)]

    base_lat = 37.7749
    base_lon = -122.4194

    while True:
        vehicle_id = random.choice(vehicle_ids)
        lat = base_lat + random.uniform(-0.02, 0.02)
        lon = base_lon + random.uniform(-0.02, 0.02)
        speed_kph = max(0.0, random.gauss(35, 12))

        event = {
            "vehicle_id": vehicle_id,
            "lat": lat,
            "lon": lon,
            "speed_kph": speed_kph,
            "ts": datetime.now(timezone.utc).isoformat(),
        }

        producer.send(topic, event)
        producer.flush(timeout=10)
        time.sleep(interval_s)


if __name__ == "__main__":
    main()
