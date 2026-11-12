import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { Booking, FareClass, Station, Train } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

function dateAfter(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

function money(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function prettyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.");
  return data as T;
}

function StationPicker({
  label,
  stations,
  value,
  onChange,
}: {
  label: string;
  stations: Station[];
  value: string;
  onChange: (code: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = stations.find((station) => station.code === value);
  const popularCodes = ["NDLS", "NZM", "DLI", "MMCT", "CSMT", "LTT", "BDTS", "PUNE", "SBC", "MAS", "HYB", "SC", "PNBE", "LKO", "CNB", "AGC", "JP", "ADI", "BPL", "BBS", "GHY", "TVC", "ERS", "VSKP", "NGP"];

  useEffect(() => {
    if (selected) setQuery(`${selected.name} · ${selected.code}`);
  }, [selected?.code, selected?.name]);

  const suggestions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const isShowingSelection = selected && query === `${selected.name} · ${selected.code}`;
    if (!normalized || isShowingSelection) {
      return popularCodes.map((code) => stations.find((station) => station.code === code)).filter((station): station is Station => Boolean(station));
    }
    return stations
      .filter((station) => station.name.toLowerCase().includes(normalized) || station.code.toLowerCase().includes(normalized))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(normalized) || a.code.toLowerCase().startsWith(normalized);
        const bStarts = b.name.toLowerCase().startsWith(normalized) || b.code.toLowerCase().startsWith(normalized);
        return Number(bStarts) - Number(aStarts) || a.name.localeCompare(b.name);
      })
      .slice(0, 12);
  }, [query, selected, stations]);

  return (
    <div className="field station-field station-picker">
      <span>{label}</span>
      <div className="station-input-wrap">
        <input
          role="combobox"
          aria-label={label === "FROM" ? "Origin station" : "Destination station"}
          aria-autocomplete="list"
          aria-expanded={open}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && open && suggestions.length) {
              event.preventDefault();
              const station = suggestions[0];
              setQuery(`${station.name} · ${station.code}`);
              onChange(station.code);
              setOpen(false);
            }
          }}
          placeholder="Type a station name or code"
          autoComplete="off"
        />
        <button type="button" className="station-toggle" aria-label={`Show ${label.toLowerCase()} station options`} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((wasOpen) => !wasOpen)}>⌄</button>
      </div>
      {open && (
        <div className="station-suggestions" role="listbox" aria-label={`${label} station options`}>
          {suggestions.length ? suggestions.map((station) => (
            <button
              type="button"
              role="option"
              aria-selected={station.code === value}
              className="station-option"
              key={station.code}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setQuery(`${station.name} · ${station.code}`);
                onChange(station.code);
                setOpen(false);
              }}
            >
              <span>{station.name}</span><small>{station.code}</small>
            </button>
          )) : <p className="station-empty">No station found. Try another name or code.</p>}
          {!query.trim() && <p className="station-hint">Major stations · type to search the full directory</p>}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [stations, setStations] = useState<Station[]>([
    { code: "NDLS", name: "New Delhi" },
    { code: "MMCT", name: "Mumbai Central" },
    { code: "HWH", name: "Howrah" },
    { code: "PNBE", name: "Patna Junction" },
    { code: "PUNE", name: "Pune Junction" },
  ]);
  const [origin, setOrigin] = useState("NDLS");
  const [destination, setDestination] = useState("MMCT");
  const [travelDate, setTravelDate] = useState(dateAfter(14));
  const [trains, setTrains] = useState<Train[]>([]);
  const [isDemoData, setIsDemoData] = useState(true);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [pageError, setPageError] = useState("");
  const [selected, setSelected] = useState<{ train: Train; fareClass: FareClass } | null>(null);
  const [passengerName, setPassengerName] = useState("");
  const [email, setEmail] = useState("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const [success, setSuccess] = useState<Booking | null>(null);
  const [activeTab, setActiveTab] = useState<"search" | "trips">("search");
  const [lookupEmail, setLookupEmail] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/stations`)
      .then((response) => readJson<Station[]>(response))
      .then(setStations)
      .catch(() => setPageError("The API is not responding. Start the backend on port 8000 and refresh."));
  }, []);

  const stationNames = useMemo(() => new Map(stations.map((station) => [station.code, station.name])), [stations]);
  async function search(event?: FormEvent) {
    event?.preventDefault();
    setPageError("");
    setNotice("");
    setSearching(true);
    setHasSearched(true);
    setSelected(null);
    setSuccess(null);
    try {
      const params = new URLSearchParams({ origin, destination, travel_date: travelDate });
      const data = await readJson<{ trains: Train[]; is_demo_data: boolean }>(await fetch(`${API_BASE}/api/trains?${params}`));
      setTrains(data.trains);
      setIsDemoData(data.is_demo_data);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not search trains.");
      setTrains([]);
    } finally {
      setSearching(false);
    }
  }

  async function book(event: FormEvent, joinWaitlist = false) {
    event.preventDefault();
    if (!selected) return;
    setBookingBusy(true);
    setPageError("");
    const idempotencyKey = crypto.randomUUID();
    try {
      const booking = await readJson<Booking>(await fetch(`${API_BASE}/api/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          train_id: selected.train.id,
          origin,
          destination,
          travel_date: travelDate,
          class_code: selected.fareClass.code,
          passenger_name: passengerName,
          email,
          idempotency_key: idempotencyKey,
          join_waitlist: joinWaitlist,
        }),
      }));
      setSuccess(booking);
      setSelected(null);
      setPassengerName("");
      setEmail("");
      await search();
      setSuccess(booking);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Booking could not be completed.");
    } finally {
      setBookingBusy(false);
    }
  }

  async function loadBookings(forEmail: string) {
    setLookupBusy(true);
    setPageError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ email: forEmail.trim() });
      const data = await readJson<{ bookings: Booking[] }>(await fetch(`${API_BASE}/api/bookings?${params}`));
      setBookings(data.bookings);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not find bookings.");
      setBookings([]);
    } finally {
      setLookupBusy(false);
    }
  }

  async function findBookings(event?: FormEvent) {
    event?.preventDefault();
    await loadBookings(lookupEmail);
  }

  async function cancel(booking: Booking) {
    setPageError("");
    setNotice("");
    try {
      const result = await readJson<{ cancelled_reference: string; promoted_reference: string | null }>(await fetch(`${API_BASE}/api/bookings/${booking.reference}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lookupEmail.trim() }),
      }));
      setNotice(result.promoted_reference
        ? `Booking cancelled. Waitlisted passenger ${result.promoted_reference} moved to confirmed.`
        : `Booking ${result.cancelled_reference} cancelled.`);
      await findBookings();
      if (hasSearched) await search();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Cancellation failed.");
    }
  }

  function openBooking(train: Train, fareClass: FareClass) {
    setSelected({ train, fareClass });
    setPageError("");
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Railwise home">
          <span className="brand-icon">R</span>
          <span>railwise<span className="brand-dot">.</span></span>
        </a>
        <nav className="nav-actions" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <button className="nav-bookings" onClick={() => { setActiveTab("trips"); setPageError(""); }}>
            My bookings <span className="arrow">↗</span>
          </button>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-dot" /> A CLEARER WAY TO GET THERE</p>
            <h1>Good journeys<br /><em>start here.</em></h1>
            <p className="hero-subtitle">Find a route, choose your seat class, and keep every trip detail in one place.</p>
            <div className="hero-footnote"><span>✦</span> Simple booking. Thoughtful details.</div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="sun" />
            <div className="track track-one" />
            <div className="track track-two" />
            <div className="hill hill-back" />
            <div className="hill hill-front" />
            <div className="train-illustration"><span /><span /><span /><i /></div>
            <div className="art-label">NEXT STOP: SOMEWHERE GOOD</div>
          </div>
        </section>

        <section className="booking-panel" aria-label="Railway ticket booking">
          <div className="panel-tabs">
            <button className={activeTab === "search" ? "tab active" : "tab"} onClick={() => { setActiveTab("search"); setPageError(""); }}>Find trains</button>
            <button className={activeTab === "trips" ? "tab active" : "tab"} onClick={() => { setActiveTab("trips"); setPageError(""); }}>My bookings</button>
            <span className="demo-tag"><span /> DEMO MODE</span>
          </div>

          {activeTab === "search" ? (
            <>
              <form className="search-form" onSubmit={search}>
                <StationPicker label="FROM" stations={stations} value={origin} onChange={setOrigin} />
                <button className="swap-button" type="button" title="Swap stations" onClick={() => { setOrigin(destination); setDestination(origin); }}>⇄</button>
                <StationPicker label="TO" stations={stations} value={destination} onChange={setDestination} />
                <label className="field date-field">
                  <span>TRAVEL DATE</span>
                  <input type="date" min={dateAfter(0)} value={travelDate} onChange={(event) => setTravelDate(event.target.value)} required />
                </label>
                <button className="search-button" type="submit" disabled={searching || !origin || !destination}>
                  {searching ? "Searching…" : "Search trains"}<span>→</span>
                </button>
              </form>
              <div className="form-note"><span>✳</span> Choose from 25 major stations or type any station name/code to search the full directory. Timetables use RailRadar; booking, seat inventory, and payment remain demo-only.</div>
            </>
          ) : (
            <form className="lookup-form" onSubmit={findBookings}>
              <label className="field lookup-field">
                <span>BOOKING EMAIL</span>
                <input type="email" value={lookupEmail} onChange={(event) => setLookupEmail(event.target.value)} placeholder="you@example.com" required />
              </label>
              <button className="search-button" disabled={lookupBusy}>{lookupBusy ? "Looking…" : "Find my trips"}<span>→</span></button>
              <p className="form-note lookup-note">Use the email entered when you made the demo booking.</p>
            </form>
          )}
        </section>

        {(pageError || notice) && <div className={pageError ? "message error-message" : "message success-message"} role="status">{pageError || notice}</div>}

        {success && (
          <section className="success-card" aria-live="polite">
            <div className="success-check">✓</div>
            <div><p className="eyebrow">{success.status === "CONFIRMED" ? "DEMO BOOKING CONFIRMED" : "ADDED TO WAITLIST"}</p><h2>Your trip is on the list.</h2><p>Reference <strong>{success.reference}</strong> · {success.passenger_name} · {prettyDate(success.travel_date)}</p></div>
            <button className="text-button" onClick={() => { setActiveTab("trips"); setLookupEmail(success.email); void loadBookings(success.email); }}>View booking →</button>
          </section>
        )}

        {activeTab === "search" && hasSearched && (
          <section className="results-section" aria-live="polite">
            <div className="results-heading">
              <div><p className="eyebrow">YOUR ROUTE, AT A GLANCE</p><h2>{stationNames.get(origin) || origin} <span>→</span> {stationNames.get(destination) || destination}</h2><p className="results-date">{prettyDate(travelDate)} <span>·</span> {trains.length} {isDemoData ? "sample " : "live timetable "}{trains.length === 1 ? "train" : "trains"}</p></div>
              <span className="sample-badge">{isDemoData ? "SAMPLE SCHEDULE" : "LIVE TIMETABLE"}</span>
            </div>
            {!trains.length ? <div className="empty-state"><div className="empty-icon">⌁</div><h3>No trains found for this route</h3><p>Try a different station pair or travel date.</p></div> : (
              <div className="train-list">
                {trains.map((train) => (
                  <article className="train-card" key={train.id}>
                    <div className="train-topline"><div><span className="train-number">{train.number}</span><h3>{train.name}</h3></div><span className="duration">{train.duration}<small>journey</small></span></div>
                    <div className="route-line">
                      <div><strong>{train.departure}</strong><span>{stationNames.get(train.origin) || train.origin}</span></div>
                      <div className="route-track"><span /> <i>··································</i><span /></div>
                      <div className="route-destination"><strong>{train.arrival}</strong><span>{stationNames.get(train.destination) || train.destination}</span></div>
                    </div>
                    {!isDemoData && <p className="form-note">Live timetable from RailRadar{train.live_status ? ` · ${train.live_status}` : ""}{typeof train.delay_minutes === "number" ? ` · ${train.delay_minutes} min delay` : ""}. Verify details with official railway sources.</p>}
                    <div className="class-list">
                      {train.classes.map((fareClass) => (
                        <div className="class-row" key={fareClass.code}>
                          <div className="class-label"><strong>{fareClass.code}</strong><span>{fareClass.name}</span></div>
                          <div className={fareClass.available > 5 ? "availability" : fareClass.available > 0 ? "availability limited" : "availability full"}>
                            <span className="availability-dot" />{fareClass.available > 0 ? `${fareClass.available} demo seats` : "Waitlist"}
                          </div>
                          <strong className="fare">{money(fareClass.fare)}</strong>
                          <button className="class-button" onClick={() => openBooking(train, fareClass)}>{fareClass.available > 0 ? "Select" : "Join list"}<span>→</span></button>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "trips" && bookings.length > 0 && (
          <section className="results-section">
            <div className="results-heading"><div><p className="eyebrow">YOUR TRIP THREAD</p><h2>Bookings for {lookupEmail}</h2><p className="results-date">{bookings.length} recent {bookings.length === 1 ? "booking" : "bookings"}</p></div></div>
            <div className="booking-list">
              {bookings.map((booking) => (
                <article className="saved-booking" key={booking.reference}>
                  <div><span className="train-number">{booking.reference}</span><h3>{stationNames.get(booking.origin) || booking.origin} → {stationNames.get(booking.destination) || booking.destination}</h3><p>{prettyDate(booking.travel_date)} · {booking.class_code} · {booking.passenger_name}</p><small>Demo payment: no money was collected</small></div>
                  <div className="saved-booking-actions"><span className={`status status-${booking.status.toLowerCase()}`}>{booking.status}</span>{booking.status !== "CANCELLED" && <button className="cancel-button" onClick={() => cancel(booking)}>Cancel</button>}</div>
                </article>
              ))}
            </div>
          </section>
        )}
        {activeTab === "trips" && bookings.length === 0 && lookupEmail && !lookupBusy && (
          <div className="empty-state compact-empty"><div className="empty-icon">⌁</div><h3>No bookings found yet</h3><p>Search for a train and make a demo booking to see it here.</p></div>
        )}

        <section className="trust-strip" id="how-it-works">
          <div><span className="trust-icon">◈</span><p><strong>One simple search</strong><small>Compare live timetables for selected routes.</small></p></div>
          <div><span className="trust-icon">⌑</span><p><strong>Clear trip status</strong><small>Follow confirmed and waitlisted bookings.</small></p></div>
          <div><span className="trust-icon">↗</span><p><strong>Built for the journey</strong><small>Manage bookings from one place.</small></p></div>
        </section>
      </main>

      <footer className="footer"><a className="brand" href="#top"><span className="brand-icon">R</span><span>railwise<span className="brand-dot">.</span></span></a><p>RailRadar timetables · Demo bookings · No real payments</p><span>BUILT FOR A BETTER WAY THERE</span></footer>

      {selected && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className="booking-modal" role="dialog" aria-modal="true" aria-labelledby="booking-title">
            <button className="modal-close" aria-label="Close booking" onClick={() => setSelected(null)}>×</button>
            <p className="eyebrow">DEMO CHECKOUT</p>
            <h2 id="booking-title">Almost on your way.</h2>
            <p className="modal-route">{selected.train.name} · {selected.fareClass.name} · {prettyDate(travelDate)}</p>
            <div className="fare-summary"><span>Sample fare</span><strong>{money(selected.fareClass.fare)}</strong></div>
            <form onSubmit={(event) => book(event, selected.fareClass.available === 0)}>
              <label className="field"><span>PASSENGER NAME</span><input value={passengerName} onChange={(event) => setPassengerName(event.target.value)} placeholder="Full name" minLength={2} required /></label>
              <label className="field"><span>EMAIL FOR BOOKING LOOKUP</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>
              <div className="payment-note"><span>✓</span><p><strong>Demo payment only</strong><small>No card details are asked for and no money is collected.</small></p></div>
              <button className="search-button modal-submit" disabled={bookingBusy}>{bookingBusy ? "Saving…" : selected.fareClass.available === 0 ? "Join the waitlist" : "Confirm demo booking"}<span>→</span></button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
