import cors from "cors";
import express from "express";
import { supabase } from "./supabase.js";

const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const allowedOrigin = process.env.API_CORS_ORIGIN ?? "http://localhost:3000";

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: "16kb" }));

type Profile = {
  id: string;
  name: string;
  email: string;
  linkedin: string;
  website: string | null;
  profession: string | null;
};
type Attendee = Omit<Profile, "email">;

const profileFields = "id,name,email,linkedin,website,profession";

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function requiredText(value: unknown): string | null {
  return optionalText(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function attendanceSummary(profile: Profile) {
  const { data: ownVisits, error: visitsError } = await supabase
    .from("attendance")
    .select("date")
    .eq("user_id", profile.id)
    .order("date", { ascending: false });

  if (visitsError) throw visitsError;

  const dates = [...new Set((ownVisits ?? []).map(({ date }) => date))];
  if (dates.length === 0) return { profile, visits: [] };

  const { data: eventAttendance, error: eventError } = await supabase
    .from("attendance")
    .select("date,user_id")
    .in("date", dates)
    .order("date", { ascending: false });

  if (eventError) throw eventError;

  const attendeeIds = [...new Set((eventAttendance ?? []).map(({ user_id }) => user_id))];
  const { data: profiles, error: profilesError } = await supabase
    .from("users")
    .select(profileFields)
    .in("id", attendeeIds);

  if (profilesError) throw profilesError;

  const profilesById = new Map((profiles ?? []).map((attendee) => [attendee.id, {
    id: attendee.id,
    name: attendee.name,
    linkedin: attendee.linkedin,
    website: attendee.website,
    profession: attendee.profession,
  }]));
  const visits = dates.map((date) => ({
    date,
    attendees: (eventAttendance ?? [])
      .filter((row) => row.date === date)
      .map((row) => profilesById.get(row.user_id))
      .filter((attendee): attendee is Attendee => attendee !== undefined),
  }));

  return { profile, visits };
}

app.get("/health", (_request, response) => response.json({ status: "ok" }));

app.post("/api/attendance/lookup", async (request, response) => {
  const email = normalizedEmail(request.body?.email);
  if (!email) return response.status(400).json({ error: "Enter a valid email address." });

  const { data: profile, error } = await supabase
    .from("users")
    .select(profileFields)
    .eq("email", email)
    .maybeSingle();

  if (error) return response.status(500).json({ error: "Could not look up your profile." });
  if (!profile) {
    return response.status(404).json({ registrationRequired: true, error: "That email is not registered." });
  }

  const { error: attendanceError } = await supabase.rpc("record_attendance", {
    attendee_id: profile.id,
    attendance_date: new Date().toISOString().slice(0, 10),
  });

  if (attendanceError) {
    return response.status(500).json({ error: "Could not record your attendance." });
  }

  try {
    return response.json(await attendanceSummary(profile));
  } catch {
    return response.status(500).json({ error: "Could not load the attendee list." });
  }
});

app.post("/api/attendance/register", async (request, response) => {
  const email = normalizedEmail(request.body?.email);
  const name = requiredText(request.body?.name);
  const linkedin = requiredText(request.body?.linkedin);
  const website = optionalText(request.body?.website);

  if (!email || !name || !linkedin || !isHttpUrl(linkedin) || (website && !isHttpUrl(website))) {
    return response.status(400).json({
      error: "Name, a valid email, and LinkedIn URL are required. Website must also be a valid URL when provided.",
    });
  }

  const { data: userId, error: registrationError } = await supabase.rpc("register_and_attend", {
    attendee_name: name,
    attendee_email: email,
    attendee_linkedin: linkedin,
    attendee_website: website,
    attendee_profession: optionalText(request.body?.profession),
    attendance_date: new Date().toISOString().slice(0, 10),
  });

  if (registrationError) {
    if (registrationError.code === "23505") {
      return response.status(409).json({ error: "That email is already registered. Return and enter it to check in." });
    }
    return response.status(500).json({ error: "Could not complete registration." });
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select(profileFields)
    .eq("id", userId)
    .single();

  if (profileError || !profile) {
    return response.status(500).json({ error: "Registration succeeded, but your attendee list could not be loaded." });
  }

  try {
    return response.status(201).json(await attendanceSummary(profile));
  } catch {
    return response.status(500).json({ error: "Registration succeeded, but the attendee list could not be loaded." });
  }
});

app.listen(port, () => {
  console.log(`Attendance API listening on http://localhost:${port}`);
});
