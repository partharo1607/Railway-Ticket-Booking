# Railwise — Railway Ticket Booking Demo

A full-stack railway journey demo built with React, TypeScript, FastAPI, and SQLite. When `RAILRADAR_API_KEY` is configured, train search uses RailRadar timetable data with live-status enrichment. RailRadar is an independent third-party service, not an official Indian Railways or IRCTC integration. Booking inventory, fares, waitlists, and checkout remain simulated; the app does not issue real tickets or collect payments.

## Demo features

- Search trains by any station in the RailRadar station directory and travel date (or sample schedules when no API key is configured).
- Compare scheduled departure, arrival, and journey duration. Search results do not imply live seat availability.
- View demo fares and seat counts only for sample trains.
- Create bookings with idempotency protection and serialized seat allocation.
- Join a waitlist when a class is full; promote the next traveler when a confirmed booking is cancelled.
- Look up bookings by email and cancel them.
- Simulated checkout only; no payment details are collected.

## Run locally

Start the API:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8010
```

In another terminal, start the web app:

```sh
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5174`.

## Deploy

The root `Dockerfile` builds the React frontend and serves it with FastAPI from one service. Deploy the repository root on Railway and configure `RAILRADAR_API_KEY` in the service variables to enable live station and timetable data. Without that variable, the app uses sample schedules. Demo bookings are stored in SQLite and can reset when the container is recreated.

## RailRadar API key

Add your key to `backend/.env`:

```env
RAILRADAR_API_KEY=your_key
```

The backend reads this file at startup and keeps the key out of browser code. Restart the backend after changing the key. The free API plan has a monthly request limit. Confirm reservation details through official railway channels.

## Sample stations

The station picker opens with 25 major stations and searches the full RailRadar directory as you type. The backend caches that directory for 24 hours. Live search uses the selected route. Local demo inventory and simulated checkout remain available only for sample trains.
