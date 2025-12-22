from typing import Dict

from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/predict")
def predict(payload: Dict[str, float]) -> Dict[str, float | str]:
    avg_speed_kph = float(payload.get("avg_speed_kph", 0.0))

    if avg_speed_kph <= 10:
        level = "severe"
        score = 0.95
    elif avg_speed_kph <= 25:
        level = "heavy"
        score = 0.75
    elif avg_speed_kph <= 40:
        level = "moderate"
        score = 0.45
    else:
        level = "light"
        score = 0.15

    return {"congestion_score": score, "congestion_level": level}
