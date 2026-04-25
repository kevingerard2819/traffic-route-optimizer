# maps-ml

## Local run (Docker)

1. Install Docker Desktop.
2. From the repo root:

```bash
docker compose up --build
```

## Services

- Kafka: `localhost:9092`
- API: `http://localhost:8000`
- ML: `http://localhost:7000`
- Frontend: `http://localhost:8080`

## Try it

- Open `http://localhost:8080`
- `GET http://localhost:8000/health`
- `GET http://localhost:8000/vehicles`
- `GET http://localhost:8000/congestion`

## Data flow

- `simulator` publishes GPS events to Kafka topic `gps-events`.
- `ingestion` consumes events and maintains latest position per `vehicle_id` in SQLite.
- `api` serves REST endpoints from SQLite and calls `ml` for congestion prediction.
- `frontend` polls the API and renders the live fleet dashboard in the browser.
