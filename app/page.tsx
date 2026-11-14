"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { FiArrowRight, FiMail, FiUsers } from "react-icons/fi";
import { postAttendance, type AttendanceResult } from "@/lib/attendance-api";

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AttendanceResult | null>(null);

  async function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const attendance = await postAttendance<AttendanceResult>("/api/attendance/lookup", { email });
      setResult(attendance);
    } catch (requestError) {
      if (requestError instanceof Error && requestError.message === "That email is not registered.") {
        router.push(`/register?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      } else if (requestError instanceof Error && requestError.message.includes("fetch")) {
        setError("there seems to be an error");
      } else {
        setError(requestError instanceof Error ? requestError.message : "Could not check in.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.logo}><FiUsers size={26} /></div>
        <h1 style={styles.title}>{result ? `Welcome, ${result.profile.name.split(" ")[0]}!` : "Welcome!"}</h1>
        <p style={styles.intro}>
          {result
            ? "You’re checked in. See who else is attending on the days you’ve visited."
            : "Connect with people attending the event. Enter your email to get started."}
        </p>

        {!result ? (
          <form onSubmit={handleContinue}>
            <div style={styles.inputWrap}>
              <FiMail size={20} style={styles.mailIcon} />
              <input
                aria-label="Email address"
                type="email"
                autoComplete="email"
                placeholder="Enter your email address"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                required
                style={{ ...styles.input, borderColor: focused ? "#C65A3A" : "#E8E5E7" }}
              />
            </div>
            {error && <p role="alert" style={styles.error}>{error}</p>}
            <button type="submit" disabled={loading} style={styles.button}>
              {loading ? "Checking in…" : "Continue"}<FiArrowRight size={18} />
            </button>
          </form>
        ) : (
          <div style={styles.visits}>
            {result.visits.map(({ date, attendees }) => (
              <section key={date} style={styles.visit}>
                <h2 style={styles.date}>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: "long", month: "long", day: "numeric", year: "numeric",
                })}</h2>
                <p style={styles.attendeeCount}>{attendees.length} {attendees.length === 1 ? "person" : "people"} attending</p>
                <ul style={styles.attendeeList}>
                  {attendees.map((attendee) => (
                    <li key={attendee.id} style={styles.attendee}>
                      <span style={styles.attendeeName}>{attendee.name}</span>
                      {attendee.profession && <span style={styles.profession}>{attendee.profession}</span>}
                      <a href={attendee.linkedin} target="_blank" rel="noreferrer" style={styles.link}>LinkedIn</a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <button type="button" onClick={() => setResult(null)} style={styles.secondaryButton}>Use another email</button>
          </div>
        )}

        {!result && <p style={styles.footer}>Your email helps us find your attendee profile.</p>}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "var(--font-geist-sans), sans-serif" },
  card: { width: "100%", maxWidth: 480, background: "#fff", padding: "40px 32px", borderRadius: 20, border: "1px solid #F0EAE7", boxShadow: "0 12px 40px rgba(80,45,30,.06)", boxSizing: "border-box" },
  logo: { width: 52, height: 52, borderRadius: 15, background: "#FBEDE7", color: "#C65A3A", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" },
  title: { fontSize: 30, fontWeight: 700, color: "#191B26", margin: "0 0 12px", letterSpacing: -1, textAlign: "center" },
  intro: { fontSize: 15, lineHeight: 1.6, color: "#686875", margin: "0 0 28px", textAlign: "center" },
  inputWrap: { position: "relative", marginBottom: 16 },
  mailIcon: { position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "#92919A" },
  input: { width: "100%", height: 56, padding: "0 18px 0 52px", background: "#fff", border: "1.5px solid #E8E5E7", borderRadius: 12, fontSize: 15, color: "#191B26", outline: "none", boxSizing: "border-box" },
  button: { width: "100%", height: 54, border: 0, borderRadius: 12, background: "#C65A3A", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 },
  error: { color: "#A33E2D", fontSize: 14, margin: "0 0 14px", textAlign: "left" },
  footer: { margin: "24px 0 0", fontSize: 12, color: "#92919A", textAlign: "center" },
  visits: { textAlign: "left" },
  visit: { borderTop: "1px solid #F0EAE7", paddingTop: 20, marginTop: 20 },
  date: { color: "#191B26", fontSize: 17, margin: "0 0 5px" },
  attendeeCount: { fontSize: 13, color: "#686875", margin: "0 0 12px" },
  attendeeList: { display: "grid", gap: 10, listStyle: "none", padding: 0, margin: 0 },
  attendee: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", background: "#FFFCFA", borderRadius: 10 },
  attendeeName: { color: "#191B26", fontWeight: 600 },
  profession: { color: "#686875", fontSize: 13 },
  link: { color: "#C65A3A", fontSize: 13, marginLeft: "auto" },
  secondaryButton: { border: "1px solid #E8E5E7", background: "white", color: "#686875", borderRadius: 10, padding: "10px 14px", marginTop: 22, cursor: "pointer" },
};
