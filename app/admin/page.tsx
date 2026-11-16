"use client";

import { FormEvent, useState } from "react";
import { FiCalendar, FiChevronDown, FiChevronRight, FiDownload, FiLock, FiTrash2, FiUserMinus } from "react-icons/fi";
import { postAttendance, type Attendee } from "@/lib/attendance-api";

/*
 * Tech Social: organizer page (/admin)
 * Written by Himal Shrestha
 *
 * Password-protected page for organizers only. It shows EVERY event and
 * everyone who came (emails included), lets organizers remove someone from an
 * event or delete them entirely, and downloads the lists as spreadsheets
 * (CSV files). Needs the ADMIN_PASSWORD from the .env file.
 */

// ==================================================================
// DATA SHAPES
// What the organizer data looks like.
// ==================================================================
type AdminAttendee = Attendee & { email: string; checked_in_at: string };
type AdminEvent = { date: string; attendees: AdminAttendee[] };
// Which button the organizer pressed, while we wait for them to confirm it.
type PendingAction = { action: "remove" | "delete"; userId: string; date: string; name: string };

// ==================================================================
// HELPERS
// Date formatting and the spreadsheet (CSV) download.
// ==================================================================
// "2026-11-16" -> "Monday, November 16, 2026"
function prettyDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// CSV = a plain-text spreadsheet: one line per row, commas between columns.
// Every value gets wrapped in quotes so commas inside names don't break columns.
// The extra ' in front of values starting with = + - @ stops Excel from
// treating someone's typed text as a formula (a known spreadsheet trick).
function toCsv(events: AdminEvent[]): string {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = ["Event date", "Checked in at", "First name", "Last name", "Email", "Profession", "LinkedIn", "Website", "18+", "Sex", "Location"];
  const rows = events.flatMap(({ date, attendees }) =>
    attendees.map((person) => [
      date,
      new Date(person.checked_in_at).toLocaleTimeString(),
      person.first_name ?? person.name,
      person.last_name ?? "",
      person.email,
      person.profession,
      person.linkedin,
      person.website,
      person.over_18 === null ? "" : person.over_18 ? "Yes" : "No",
      person.sex,
      person.location,
    ]),
  );
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

// Makes the browser download a file without needing a server for it.
function downloadCsv(events: AdminEvent[], fileName: string) {
  const blob = new Blob([toCsv(events)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ==================================================================
// THE PAGE
// Sign-in screen first, then the list of all events.
// ==================================================================
export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [open, setOpen] = useState<string | null>(null); // which event is expanded
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null); // waiting on "Yes, remove"
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState(""); // little message after a remove/delete

  // Runs when the organizer presses "Sign in": send the password, get every event back.
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await postAttendance<{ events: AdminEvent[] }>("/api/admin/events", { password });
      setEvents(result.events);
      setOpen(result.events[0]?.date ?? null); // auto-open the newest event
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  // Runs after the organizer confirms. Asks the server to do it, then updates
  // the list on screen right away so we don't have to reload everything.
  async function confirmAction() {
    if (!pending) return;
    setWorking(true);
    setNotice("");
    try {
      if (pending.action === "remove") {
        await postAttendance("/api/admin/remove-checkin", { password, userId: pending.userId, date: pending.date });
        // Take them out of just that one event.
        setEvents((current) => current && current
          .map((item) => item.date === pending.date
            ? { ...item, attendees: item.attendees.filter((person) => person.id !== pending.userId) }
            : item)
          .filter((item) => item.attendees.length > 0)); // hide events that are now empty
        setNotice(`Removed ${pending.name} from ${prettyDate(pending.date)}.`);
      } else {
        await postAttendance("/api/admin/delete-person", { password, userId: pending.userId });
        // Take them out of EVERY event.
        setEvents((current) => current && current
          .map((item) => ({ ...item, attendees: item.attendees.filter((person) => person.id !== pending.userId) }))
          .filter((item) => item.attendees.length > 0));
        setNotice(`Deleted ${pending.name} and all their check-ins.`);
      }
      setPending(null);
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  }

  // Not signed in yet: show the password box.
  if (!events) {
    return (
      <main style={styles.page}>
        <section style={{ ...styles.card, maxWidth: 420 }}>
          <div style={styles.logo}><FiLock size={24} /></div>
          <h1 style={styles.title}>Organizer access</h1>
          <p style={styles.intro}>See every event and everyone who checked in.</p>
          <form onSubmit={handleLogin} style={{ display: "grid", gap: 12 }}>
            <input type="password" aria-label="Organizer password" placeholder="Organizer password" required
              value={password} onChange={(event) => setPassword(event.target.value)} style={styles.input} />
            {error && <p role="alert" style={styles.error}>{error}</p>}
            <button type="submit" disabled={loading} style={styles.primary}>{loading ? "Checking…" : "Sign in"}</button>
          </form>
        </section>
      </main>
    );
  }

  const totalCheckIns = events.reduce((sum, { attendees }) => sum + attendees.length, 0);

  // Signed in: show every event.
  return (
    <main style={styles.page}>
      <section style={{ ...styles.card, maxWidth: 1200 }}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={{ ...styles.title, textAlign: "left" }}>All events</h1>
            <p style={{ ...styles.intro, textAlign: "left", margin: 0 }}>
              {events.length} {events.length === 1 ? "event" : "events"} · {totalCheckIns} check-ins
            </p>
          </div>
          {events.length > 0 && (
            <button type="button" onClick={() => downloadCsv(events, "tech-social-all-events.csv")} style={styles.secondary}>
              <FiDownload size={15} /> Download all
            </button>
          )}
        </div>

        {notice && <p role="status" style={styles.notice}>{notice}</p>}
        {events.length === 0 && <p style={styles.intro}>No check-ins yet.</p>}

        {events.map((item) => {
          const isOpen = open === item.date;
          return (
            <section key={item.date} style={styles.event}>
              {/* Clicking the header opens/closes that event's list */}
              <button type="button" onClick={() => setOpen(isOpen ? null : item.date)} style={styles.eventHeader}>
                {isOpen ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
                <FiCalendar size={16} style={{ color: "#C65A3A" }} />
                <span style={styles.eventDate}>{prettyDate(item.date)}</span>
                <span style={styles.badge}>{item.attendees.length}</span>
              </button>

              {isOpen && (
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>{/* Two columns have no title (photo + buttons), so the position number is used as the key. */}
                        {["", "Name", "Email", "Profession", "Details", "Links", "Checked in", ""].map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {item.attendees.map((person) => (
                        <tr key={person.id}>
                          <td style={styles.td}>
                            {person.photo_url
                              ? <img src={person.photo_url} alt="" style={styles.avatar} />
                              : <span style={{ ...styles.avatar, ...styles.initials }}>{person.name.charAt(0)}</span>}
                          </td>
                          <td style={{ ...styles.td, fontWeight: 600, color: "#191B26" }}>{person.name}</td>
                          <td style={styles.td}>{person.email}</td>
                          <td style={styles.td}>{person.profession ?? "—"}</td>
                          <td style={styles.td}>
                            {[person.over_18 === null ? null : person.over_18 ? "18+" : "Under 18", person.sex, person.location]
                              .filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td style={styles.td}>
                            <a href={person.linkedin} target="_blank" rel="noreferrer" style={styles.link}>LinkedIn</a>
                            {person.website && <> · <a href={person.website} target="_blank" rel="noreferrer" style={styles.link}>Website</a></>}
                          </td>
                          <td style={styles.td}>{new Date(person.checked_in_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
                          <td style={{ ...styles.td, whiteSpace: "normal", minWidth: 190 }}>
                            {/* If this row's button was just pressed, ask "are you sure?" right here.
                                Otherwise show the two normal buttons. */}
                            {pending && pending.userId === person.id && pending.date === item.date ? (
                              <span style={styles.confirm}>
                                {pending.action === "remove" ? "Remove from this event?" : "Delete everywhere? Can’t undo."}
                                <button type="button" disabled={working} onClick={confirmAction} style={styles.danger}>
                                  {working ? "…" : "Yes"}
                                </button>
                                <button type="button" disabled={working} onClick={() => setPending(null)} style={styles.small}>Cancel</button>
                              </span>
                            ) : (
                              <span style={styles.actions}>
                                <button type="button" title="Remove from this event only"
                                  onClick={() => setPending({ action: "remove", userId: person.id, date: item.date, name: person.name })}
                                  style={styles.small}>
                                  <FiUserMinus size={13} /> Remove
                                </button>
                                <button type="button" title="Delete this person and all their check-ins"
                                  onClick={() => setPending({ action: "delete", userId: person.id, date: item.date, name: person.name })}
                                  style={{ ...styles.small, color: "#A33E2D" }}>
                                  <FiTrash2 size={13} /> Delete
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {isOpen && (
                <button type="button" onClick={() => downloadCsv([item], `tech-social-${item.date}.csv`)} style={{ ...styles.secondary, marginTop: 12 }}>
                  <FiDownload size={15} /> Download this event
                </button>
              )}
            </section>
          );
        })}
      </section>
    </main>
  );
}

// ==================================================================
// STYLES
// Colors, sizes and spacing for this page.
// ==================================================================
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "var(--font-geist-sans), sans-serif" },
  card: { width: "100%", background: "#fff", padding: 32, borderRadius: 20, border: "1px solid #F0EAE7", boxShadow: "0 12px 40px rgba(80,45,30,.06)", boxSizing: "border-box", marginTop: 40 },
  logo: { width: 52, height: 52, borderRadius: 15, background: "#FBEDE7", color: "#C65A3A", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" },
  title: { fontSize: 26, fontWeight: 700, color: "#191B26", margin: "0 0 8px", letterSpacing: -1, textAlign: "center" },
  intro: { fontSize: 14, lineHeight: 1.55, color: "#686875", margin: "0 0 22px", textAlign: "center" },
  input: { width: "100%", height: 48, padding: "0 14px", border: "1px solid #E8E5E7", borderRadius: 10, font: "inherit", boxSizing: "border-box" },
  primary: { height: 50, border: 0, borderRadius: 12, background: "#C65A3A", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  secondary: { display: "inline-flex", alignItems: "center", gap: 7, height: 40, padding: "0 14px", border: "1px solid #E8E5E7", borderRadius: 10, background: "#fff", color: "#34343E", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  error: { color: "#A33E2D", fontSize: 13, margin: 0 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 20 },
  event: { borderTop: "1px solid #F0EAE7", padding: "14px 0" },
  eventHeader: { display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, background: "transparent", padding: "4px 0", cursor: "pointer", color: "#34343E", font: "inherit" },
  eventDate: { fontWeight: 600, fontSize: 15, color: "#191B26" },
  badge: { marginLeft: "auto", background: "#FBEDE7", color: "#C65A3A", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700 },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 },
  th: { textAlign: "left", color: "#92919A", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, padding: "8px 10px", borderBottom: "1px solid #F0EAE7" },
  td: { padding: "10px", borderBottom: "1px solid #F7F2EF", color: "#4A4A55", verticalAlign: "middle", whiteSpace: "nowrap" },
  avatar: { width: 34, height: 34, borderRadius: "50%", objectFit: "cover", display: "block" },
  initials: { background: "#FBEDE7", color: "#C65A3A", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  link: { color: "#C65A3A", textDecoration: "none" },
  actions: { display: "inline-flex", gap: 6 },
  confirm: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", color: "#A33E2D", fontWeight: 600 },
  small: { display: "inline-flex", alignItems: "center", gap: 4, height: 30, padding: "0 10px", border: "1px solid #E8E5E7", borderRadius: 8, background: "#fff", color: "#34343E", fontSize: 12, cursor: "pointer" },
  danger: { height: 30, padding: "0 12px", border: 0, borderRadius: 8, background: "#A33E2D", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  notice: { background: "#FFF6F2", border: "1px solid #F5DDD3", color: "#7A3A26", borderRadius: 10, padding: "10px 14px", fontSize: 13, margin: "0 0 12px" },
};
