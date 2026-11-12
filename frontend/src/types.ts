export type Station = {
  code: string;
  name: string;
};

export type FareClass = {
  code: string;
  name: string;
  fare: number;
  available: number;
};

export type Train = {
  id: string;
  number: string;
  name: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  duration: string;
  travel_date: string;
  classes: FareClass[];
  live_status?: string | null;
  delay_minutes?: number | null;
};

export type Booking = {
  reference: string;
  email: string;
  passenger_name: string;
  train_id: string;
  origin: string;
  destination: string;
  travel_date: string;
  class_code: string;
  fare: number;
  status: "CONFIRMED" | "WAITLISTED" | "CANCELLED";
  payment_status: string;
  created_at: string;
};
