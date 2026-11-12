from __future__ import annotations

import os
import sqlite3
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
from fastapi.staticfiles import StaticFiles


BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")
RAILRADAR_API_KEY = os.getenv("RAILRADAR_API_KEY", "").strip()
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", BACKEND_ROOT / ".data" / "railwise.sqlite3"))

STATIONS = [
    {"code": "NDLS", "name": "New Delhi"},
    {"code": "MMCT", "name": "Mumbai Central"},
    {"code": "HWH", "name": "Howrah"},
    {"code": "PNBE", "name": "Patna Junction"},
    {"code": "PUNE", "name": "Pune Junction"},
]
STATION_DIRECTORY: list[dict[str, str]] = []
STATION_DIRECTORY_FETCHED_AT = 0.0
STATION_DIRECTORY_TTL = 60 * 60 * 24

TRAIN_SCHEDULES: dict[tuple[str, str], list[dict[str, Any]]] = {
    ("NDLS", "MMCT"): [
        {
            "id": "RW-1001", "number": "RW 1001", "name": "Western Star Demo",
            "departure": "16:10", "arrival": "09:05", "duration": "16h 55m",
            "classes": [{"code": "SL", "name": "Sleeper", "fare": 690, "capacity": 24}, {"code": "3A", "name": "AC 3 Tier", "fare": 1780, "capacity": 12}, {"code": "2A", "name": "AC 2 Tier", "fare": 2590, "capacity": 6}],
        },
        {
            "id": "RW-1002", "number": "RW 1002", "name": "Capital Coast Demo",
            "departure": "18:35", "arrival": "12:20", "duration": "17h 45m",
            "classes": [{"code": "SL", "name": "Sleeper", "fare": 620, "capacity": 24}, {"code": "3A", "name": "AC 3 Tier", "fare": 1640, "capacity": 12}, {"code": "2A", "name": "AC 2 Tier", "fare": 2410, "capacity": 6}],
        },
        {
            "id": "RW-1003", "number": "RW 1003", "name": "Nightline Demo Express",
            "departure": "21:15", "arrival": "14:40", "duration": "17h 25m",
            "classes": [{"code": "SL", "name": "Sleeper", "fare": 650, "capacity": 24}, {"code": "3A", "name": "AC 3 Tier", "fare": 1710, "capacity": 12}, {"code": "2A", "name": "AC 2 Tier", "fare": 2480, "capacity": 6}],
        },
    ],
    ("NDLS", "HWH"): [
        {
            "id": "RW-2001", "number": "RW 2001", "name": "Eastern Passage Demo",
            "departure": "17:00", "arrival": "10:10", "duration": "17h 10m",
            "classes": [{"code": "SL", "name": "Sleeper", "fare": 570, "capacity": 24}, {"code": "3A", "name": "AC 3 Tier", "fare": 1490, "capacity": 12}, {"code": "2A", "name": "AC 2 Tier", "fare": 2210, "capacity": 6}],
        },
        {
            "id": "RW-2002", "number": "RW 2002", "name": "Riverland Demo Express",
            "departure": "20:40", "arrival": "14:05", "duration": "17h 25m",
            "classes": [{"code": "SL", "name": "Sleeper", "fare": 590, "capacity": 24}, {"code": "3A", "name": "AC 3 Tier", "fare": 1530, "capacity": 12}, {"code": "2A", "name": "AC 2 Tier", "fare": 2290, "capacity": 6}],
        },
    ],
    ("NDLS", "PNBE"): [
        {
            "id": "RW-3001", "number": "RW 3001", "name": "Ganga Valley Demo",
            "departure": "19:20", "arrival": "08:45", "duration": "13h 25m",
            "classes": [{"code": "SL", "name": "Sleeper", "fare": 430, "capacity": 24}, {"code": "3A", "name": "AC 3 Tier", "fare": 1120, "capacity": 12}, {"code": "2A", "name": "AC 2 Tier", "fare": 1690, "capacity": 6}],
        },
    ],
    ("MMCT", "PUNE"): [
        {
            "id": "RW-4001", "number": "RW 4001", "name": "Deccan Bloom Demo",
            "departure": "07:30", "arrival": "11:05", "duration": "3h 35m",
            "classes": [{"code": "CC", "name": "Chair Car", "fare": 390, "capacity": 24}, {"code": "2S", "name": "Second Sitting", "fare": 145, "capacity": 30}],
        },
        {
            "id": "RW-4002", "number": "RW 4002", "name": "Western Ghats Demo",
            "departure": "14:10", "arrival": "18:25", "duration": "4h 15m",
            "classes": [{"code": "CC", "name": "Chair Car", "fare": 420, "capacity": 24}, {"code": "2S", "name": "Second Sitting", "fare": 160, "capacity": 30}],
        },
    ],
}


def connect_db() -> sqlite3.Connection:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_PATH, timeout=30, isolation_level=None)
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def database_connection():
    connection = connect_db()
    try:
        yield connection
    finally:
        connection.close()


def initialize_database() -> None:
    with database_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS bookings (
                reference TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL,
                passenger_name TEXT NOT NULL,
                train_id TEXT NOT NULL,
                origin TEXT NOT NULL,
                destination TEXT NOT NULL,
                travel_date TEXT NOT NULL,
                class_code TEXT NOT NULL,
                fare INTEGER NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'WAITLISTED', 'CANCELLED')),
                payment_status TEXT NOT NULL DEFAULT 'SIMULATED',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_bookings_inventory
                ON bookings (train_id, travel_date, class_code, status);
            CREATE INDEX IF NOT EXISTS idx_bookings_email
                ON bookings (email, created_at DESC);
            """
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="Railwise Demo API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5174", "http://localhost:5174"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)


class BookingRequest(BaseModel):
    train_id: str
    origin: str
    destination: str
    travel_date: date
    class_code: str
    passenger_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    idempotency_key: str = Field(min_length=8, max_length=100)
    join_waitlist: bool = False

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or "." not in value.rsplit("@", 1)[-1]:
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("passenger_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return " ".join(value.split())


class CancelRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


def find_train(train_id: str) -> tuple[tuple[str, str], dict[str, Any]] | None:
    for route, trains in TRAIN_SCHEDULES.items():
        for train in trains:
            if train["id"] == train_id:
                return route, train
    return None


def serialize_booking(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "reference": row["reference"],
        "email": row["email"],
        "passenger_name": row["passenger_name"],
        "train_id": row["train_id"],
        "origin": row["origin"],
        "destination": row["destination"],
        "travel_date": row["travel_date"],
        "class_code": row["class_code"],
        "fare": row["fare"],
        "status": row["status"],
        "payment_status": row["payment_status"],
        "created_at": row["created_at"],
    }


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "railwise-demo-api"}


@app.get("/api/stations")
async def list_stations() -> list[dict[str, str]]:
    global STATION_DIRECTORY, STATION_DIRECTORY_FETCHED_AT
    if RAILRADAR_API_KEY and (not STATION_DIRECTORY or time.time() - STATION_DIRECTORY_FETCHED_AT > STATION_DIRECTORY_TTL):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(
                    "https://api.railradar.in/v1/lookup/stations",
                    headers={"Authorization": f"Bearer {RAILRADAR_API_KEY}"},
                )
            payload = response.json()
            if response.is_error or not payload.get("success"):
                raise ValueError("Station directory request failed")
            STATION_DIRECTORY = [
                {"code": code, "name": name}
                for code, name in payload.get("data", {}).items()
                if isinstance(code, str) and isinstance(name, str)
            ]
            STATION_DIRECTORY.sort(key=lambda station: station["name"].casefold())
            STATION_DIRECTORY_FETCHED_AT = time.time()
        except (httpx.HTTPError, ValueError) as exc:
            if not STATION_DIRECTORY:
                raise HTTPException(status_code=502, detail="Could not load the live station directory. Please refresh and try again.") from exc
    if STATION_DIRECTORY:
        return STATION_DIRECTORY
    return STATIONS


@app.get("/api/trains")
async def search_trains(
    travel_date: date,
    origin: str = Query(min_length=3, max_length=4),
    destination: str = Query(min_length=3, max_length=4),
) -> dict[str, Any]:
    origin = origin.strip().upper()
    destination = destination.strip().upper()
    if origin == destination:
        raise HTTPException(status_code=400, detail="Choose two different stations.")
    if travel_date < date.today():
        raise HTTPException(status_code=400, detail="Travel date cannot be in the past.")
    if RAILRADAR_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(
                    f"https://api.railradar.in/v1/trains/between/{origin}/{destination}",
                    params={"date": travel_date.isoformat(), "live": "true"},
                    headers={"Authorization": f"Bearer {RAILRADAR_API_KEY}"},
                )
            payload = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(status_code=502, detail="Live train search is temporarily unavailable. Please try again.") from exc
        if response.is_error or not payload.get("success"):
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            message = error.get("message", "Live train search could not be completed.")
            status = 503 if response.status_code >= 500 else 502
            raise HTTPException(status_code=status, detail=message)

        data = payload.get("data", {})
        results = []
        for item in data.get("trains", []):
            train = item.get("train", {})
            from_stop = item.get("from", {})
            to_stop = item.get("to", {})
            duration_minutes = item.get("duration")
            duration = f"{duration_minutes // 60}h {duration_minutes % 60}m" if isinstance(duration_minutes, int) else "—"
            live = item.get("live") or {}
            results.append({
                "id": f"RR-{train.get('number', '')}",
                "number": train.get("number", ""),
                "name": train.get("name", "Indian Railways train"),
                "origin": origin,
                "destination": destination,
                "departure": from_stop.get("departure") or from_stop.get("arrival") or "—",
                "arrival": to_stop.get("arrival") or to_stop.get("departure") or "—",
                "duration": duration,
                "travel_date": travel_date.isoformat(),
                "classes": [],
                "live_status": live.get("status"),
                "delay_minutes": live.get("delayMinutes"),
            })
        return {
            "trains": results,
            "is_demo_data": False,
            "data_provider": "RailRadar",
            "source_timestamp": payload.get("meta", {}).get("timestamp"),
        }

    trains = TRAIN_SCHEDULES.get((origin, destination), [])
    results = []
    with database_connection() as connection:
        for train in trains:
            classes = []
            for item in train["classes"]:
                booked = connection.execute(
                    """SELECT COUNT(*) AS count FROM bookings
                       WHERE train_id = ? AND travel_date = ? AND class_code = ? AND status = 'CONFIRMED'""",
                    (train["id"], travel_date.isoformat(), item["code"]),
                ).fetchone()["count"]
                classes.append({
                    "code": item["code"],
                    "name": item["name"],
                    "fare": item["fare"],
                    "available": max(0, item["capacity"] - booked),
                })
            results.append({
                "id": train["id"],
                "number": train["number"],
                "name": train["name"],
                "origin": origin,
                "destination": destination,
                "departure": train["departure"],
                "arrival": train["arrival"],
                "duration": train["duration"],
                "travel_date": travel_date.isoformat(),
                "classes": classes,
            })
    return {"trains": results, "is_demo_data": True}


@app.post("/api/bookings")
async def create_booking(request: BookingRequest) -> dict[str, Any]:
    if request.travel_date < date.today():
        raise HTTPException(status_code=400, detail="Travel date cannot be in the past.")
    match = find_train(request.train_id)
    if not match:
        raise HTTPException(status_code=404, detail="This demo train could not be found.")
    route, train = match
    if route != (request.origin.upper(), request.destination.upper()):
        raise HTTPException(status_code=400, detail="The selected train does not match this route.")
    fare_class = next((item for item in train["classes"] if item["code"] == request.class_code), None)
    if not fare_class:
        raise HTTPException(status_code=400, detail="Choose a class offered on this train.")

    connection = connect_db()
    try:
        connection.execute("BEGIN IMMEDIATE")
        previous = connection.execute(
            "SELECT * FROM bookings WHERE idempotency_key = ?",
            (request.idempotency_key,),
        ).fetchone()
        if previous:
            connection.commit()
            return serialize_booking(previous)

        confirmed = connection.execute(
            """SELECT COUNT(*) AS count FROM bookings
               WHERE train_id = ? AND travel_date = ? AND class_code = ? AND status = 'CONFIRMED'""",
            (request.train_id, request.travel_date.isoformat(), request.class_code),
        ).fetchone()["count"]
        status = "CONFIRMED" if confirmed < fare_class["capacity"] else "WAITLISTED"
        if status == "WAITLISTED" and not request.join_waitlist:
            connection.rollback()
            raise HTTPException(status_code=409, detail="That class is full. Join the waitlist instead.")

        reference = f"RW-{uuid4().hex[:8].upper()}"
        created_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        connection.execute(
            """INSERT INTO bookings (
                reference, idempotency_key, email, passenger_name, train_id,
                origin, destination, travel_date, class_code, fare, status,
                payment_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SIMULATED', ?)""",
            (
                reference, request.idempotency_key, request.email,
                request.passenger_name, request.train_id, route[0], route[1],
                request.travel_date.isoformat(), request.class_code,
                fare_class["fare"], status, created_at,
            ),
        )
        row = connection.execute("SELECT * FROM bookings WHERE reference = ?", (reference,)).fetchone()
        connection.commit()
        return serialize_booking(row)
    except HTTPException:
        raise
    except sqlite3.IntegrityError as exc:
        connection.rollback()
        raise HTTPException(status_code=409, detail="This booking request was already processed.") from exc
    finally:
        connection.close()


@app.get("/api/bookings")
async def list_bookings(email: str = Query(min_length=5, max_length=254)) -> dict[str, Any]:
    normalized = email.strip().lower()
    with database_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM bookings WHERE email = ? ORDER BY created_at DESC LIMIT 30",
            (normalized,),
        ).fetchall()
    return {"bookings": [serialize_booking(row) for row in rows]}


@app.post("/api/bookings/{reference}/cancel")
async def cancel_booking(reference: str, request: CancelRequest) -> dict[str, Any]:
    connection = connect_db()
    promoted_reference = None
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM bookings WHERE reference = ? AND email = ?",
            (reference.upper(), request.email),
        ).fetchone()
        if not row:
            connection.rollback()
            raise HTTPException(status_code=404, detail="No booking matched that reference and email.")
        if row["status"] == "CANCELLED":
            connection.rollback()
            raise HTTPException(status_code=409, detail="This booking is already cancelled.")

        connection.execute(
            "UPDATE bookings SET status = 'CANCELLED' WHERE reference = ?",
            (row["reference"],),
        )
        if row["status"] == "CONFIRMED":
            next_waitlisted = connection.execute(
                """SELECT reference FROM bookings
                   WHERE train_id = ? AND travel_date = ? AND class_code = ? AND status = 'WAITLISTED'
                   ORDER BY created_at, reference LIMIT 1""",
                (row["train_id"], row["travel_date"], row["class_code"]),
            ).fetchone()
            if next_waitlisted:
                promoted_reference = next_waitlisted["reference"]
                connection.execute(
                    "UPDATE bookings SET status = 'CONFIRMED' WHERE reference = ?",
                    (promoted_reference,),
                )
        connection.commit()
    except HTTPException:
        raise
    finally:
        connection.close()
    return {"cancelled_reference": reference.upper(), "promoted_reference": promoted_reference}


FRONTEND_DIRECTORY = Path(os.getenv("FRONTEND_DIST", BACKEND_ROOT / "frontend-dist"))
if FRONTEND_DIRECTORY.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIRECTORY, html=True), name="frontend")
