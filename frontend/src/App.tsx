import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, AdmissionClass, StudentHold } from "./api";

type View = "overview" | "applications";

function App() {
  const [classes, setClasses] = useState<AdmissionClass[]>([]);
  const [holds, setHolds] = useState<StudentHold[]>([]);
  const [studentId, setStudentId] = useState(
    () => window.localStorage.getItem("admission-student-id") ?? "",
  );
  const [activeView, setActiveView] = useState<View>("overview");
  const [className, setClassName] = useState("");
  const [totalSeats, setTotalSeats] = useState("30");
  const [loading, setLoading] = useState(true);
  const [savingClass, setSavingClass] = useState(false);
  const [busyHoldId, setBusyHoldId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshClasses = useCallback(async () => {
    setClasses(await api.getClasses());
  }, []);

  const refreshHolds = useCallback(async (id: string) => {
    if (id.trim()) {
      setHolds(await api.getHolds(id.trim()));
    } else {
      setHolds([]);
    }
  }, []);

  const refresh = useCallback(async (id = studentId) => {
    setError("");
    try {
      await Promise.all([refreshClasses(), refreshHolds(id)]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load admission data.");
    } finally {
      setLoading(false);
    }
  }, [refreshClasses, refreshHolds, studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (studentId.trim()) {
      window.localStorage.setItem("admission-student-id", studentId.trim());
      void refreshHolds(studentId.trim()).catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not load your holds.");
      });
    } else {
      window.localStorage.removeItem("admission-student-id");
      setHolds([]);
    }
  }, [studentId, refreshHolds]);

  const totals = useMemo(() => classes.reduce(
    (result, admissionClass) => ({
      classes: result.classes + 1,
      seats: result.seats + admissionClass.totalSeats,
      confirmed: result.confirmed + admissionClass.confirmedSeats,
    }),
    { classes: 0, seats: 0, confirmed: 0 },
  ), [classes]);

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingClass(true);
    setError("");
    setNotice("");
    try {
      await api.createClass(className.trim(), Number(totalSeats));
      setClassName("");
      setTotalSeats("30");
      setNotice("Class created and ready for applications.");
      await refreshClasses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the class.");
    } finally {
      setSavingClass(false);
    }
  }

  async function holdSeat(admissionClass: AdmissionClass) {
    if (!studentId.trim()) {
      setError("Enter a student ID before reserving a seat.");
      return;
    }
    setBusyHoldId(admissionClass.id);
    setError("");
    setNotice("");
    try {
      await api.holdSeat(admissionClass.id, studentId.trim());
      setNotice(`A seat in ${admissionClass.name} is held for 10 minutes.`);
      await refresh(studentId.trim());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reserve a seat.");
    } finally {
      setBusyHoldId(null);
    }
  }

  async function changeHold(hold: StudentHold, action: "confirm" | "cancel") {
    setBusyHoldId(hold.holdId);
    setError("");
    setNotice("");
    try {
      if (action === "confirm") {
        await api.confirmHold(hold.holdId, studentId.trim());
        setNotice("Your seat is confirmed.");
      } else {
        await api.cancelHold(hold.holdId, studentId.trim());
        setNotice("Your seat hold has been cancelled.");
      }
      await refresh(studentId.trim());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update this hold.");
    } finally {
      setBusyHoldId(null);
    }
  }

  const activeHolds = holds.filter(
    (hold) => hold.status === "HELD" || hold.status === "CONFIRMED",
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Northstar School home">
          <span className="brand-mark">N</span>
          <span><strong>northstar</strong><small>ADMISSIONS PORTAL</small></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={activeView === "overview" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("overview")}>
            <span className="nav-icon">▦</span> Overview
          </button>
          <button className={activeView === "applications" ? "nav-item active" : "nav-item"} onClick={() => setActiveView("applications")}>
            <span className="nav-icon">▤</span> My applications
            {activeHolds.length > 0 && <span className="nav-count">{activeHolds.length}</span>}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="online-dot" /> Admission portal is open
          <div className="school-chip"><span className="school-avatar">N</span><span><strong>Northstar School</strong><small>School administration</small></span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">Northstar School <span>/</span> {activeView === "overview" ? "Admissions" : "My applications"}</div>
          <div className="topbar-right">
            <span className="term-pill"><span /> 2026–27 ADMISSIONS</span>
            <div className="avatar">NS</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">MONDAY, NOVEMBER 9, 2026 <span className="eyebrow-line" /></div>
              <h1>{activeView === "overview" ? "Admissions overview" : "My applications"}</h1>
              <p className="subtitle">
                {activeView === "overview"
                  ? "Manage class capacity and reserve a seat for the upcoming school year."
                  : "Keep track of your seat reservations and admission confirmations."}
              </p>
            </div>
            <div className="student-control">
              <label htmlFor="student-id">STUDENT ID</label>
              <input
                id="student-id"
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                placeholder="Enter your student ID"
                maxLength={80}
              />
            </div>
          </section>

          {(error || notice) && (
            <div className={error ? "alert error-alert" : "alert success-alert"} role="status">
              <span>{error ? "!" : "✓"}</span>{error || notice}
              <button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss message">×</button>
            </div>
          )}

          {activeView === "overview" ? (
            <>
              <section className="stat-grid" aria-label="Admission statistics">
                <article className="stat-card">
                  <div className="stat-top"><span className="stat-icon blue">▦</span><span className="stat-caption">THIS INTAKE</span></div>
                  <strong>{totals.classes.toString().padStart(2, "0")}</strong><span className="stat-label">Classes available</span>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span className="stat-icon violet">♧</span><span className="stat-caption">TOTAL CAPACITY</span></div>
                  <strong>{totals.seats.toLocaleString()}</strong><span className="stat-label">Seats across all classes</span>
                </article>
                <article className="stat-card">
                  <div className="stat-top"><span className="stat-icon green">✓</span><span className="stat-caption">ENROLLMENT</span></div>
                  <strong>{totals.confirmed.toLocaleString()}</strong><span className="stat-label">Confirmed applications</span>
                </article>
                <article className="stat-card accent-stat">
                  <div className="stat-top"><span className="stat-icon amber">◷</span><span className="stat-caption">YOUR RESERVATIONS</span></div>
                  <strong>{activeHolds.length.toString().padStart(2, "0")}</strong><span className="stat-label">Active seat holds</span>
                </article>
              </section>

              <section className="content-grid">
                <div className="classes-panel">
                  <div className="section-heading">
                    <div><div className="section-kicker">OPEN FOR ENROLLMENT</div><h2>Class &amp; shift availability</h2></div>
                    <span className="live-tag"><span /> LIVE</span>
                  </div>
                  {loading ? <div className="empty-state">Loading classes…</div> : classes.length === 0 ? (
                    <div className="empty-state">No classes yet. Create a class to open enrollment.</div>
                  ) : (
                    <div className="class-list">
                      {classes.map((admissionClass, index) => {
                        const percent = admissionClass.totalSeats
                          ? Math.round((admissionClass.confirmedSeats + admissionClass.heldSeats) / admissionClass.totalSeats * 100)
                          : 0;
                        const alreadyApplied = holds.some((hold) =>
                          hold.classId === admissionClass.id &&
                          (hold.status === "HELD" || hold.status === "CONFIRMED"));
                        return (
                          <article className="class-card" key={admissionClass.id}>
                            <div className={`class-emblem emblem-${index % 4}`}><span>{admissionClass.name.match(/class\s*(\d+)/i)?.[1] ?? "C"}</span></div>
                            <div className="class-details">
                              <div className="class-title-row"><h3>{admissionClass.name}</h3><span className="open-tag">OPEN</span></div>
                              <p>{admissionClass.confirmedSeats} confirmed <span>·</span> {admissionClass.heldSeats} on hold</p>
                              <div className="seat-progress"><span style={{ width: `${percent}%` }} /></div>
                            </div>
                            <div className="seat-count"><strong>{admissionClass.availableSeats}</strong><span>SEATS LEFT</span></div>
                            <button
                              className="hold-button"
                              disabled={admissionClass.availableSeats <= 0 || alreadyApplied || busyHoldId === admissionClass.id}
                              onClick={() => void holdSeat(admissionClass)}
                            >
                              {busyHoldId === admissionClass.id ? "Reserving…" : alreadyApplied ? "Applied" : "Reserve seat"}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  <p className="note-line"><span>i</span> Seat reservations are held for 10 minutes. Confirm your seat before the hold expires.</p>
                </div>

                <aside className="admin-panel">
                  <div className="section-kicker">SCHOOL ADMIN</div>
                  <h2>Create a class</h2>
                  <p className="panel-copy">Add a class or shift and set the total number of available seats.</p>
                  <form onSubmit={(event) => void submitClass(event)}>
                    <label htmlFor="class-name">CLASS &amp; SHIFT NAME</label>
                    <input
                      id="class-name"
                      value={className}
                      onChange={(event) => setClassName(event.target.value)}
                      placeholder="e.g. Class 6 - Morning Shift"
                      minLength={1}
                      maxLength={120}
                      required
                    />
                    <label htmlFor="total-seats">TOTAL SEATS</label>
                    <div className="number-input"><button type="button" onClick={() => setTotalSeats(String(Math.max(1, Number(totalSeats) - 1)))} aria-label="Decrease seats">−</button><input id="total-seats" type="number" min="1" max="10000" value={totalSeats} onChange={(event) => setTotalSeats(event.target.value)} required /><button type="button" onClick={() => setTotalSeats(String(Math.min(10000, Number(totalSeats) + 1)))} aria-label="Increase seats">+</button></div>
                    <button className="create-button" type="submit" disabled={savingClass}>{savingClass ? "Creating…" : <><span>＋</span> Create class</>}</button>
                  </form>
                  <div className="admin-tip"><span>✦</span><p><strong>Tip</strong> You can add multiple shifts for the same class level, such as Morning and Day shifts.</p></div>
                </aside>
              </section>
            </>
          ) : (
            <section className="applications-panel">
              <div className="section-heading"><div><div className="section-kicker">SEAT RESERVATIONS</div><h2>Your applications</h2></div><button className="refresh-button" onClick={() => void refresh()}>↻ Refresh</button></div>
              {!studentId.trim() ? <div className="empty-state">Enter your student ID above to view your applications.</div> : holds.length === 0 ? <div className="empty-state">No applications found for this student ID.</div> : (
                <div className="application-list">
                  {holds.map((hold) => (
                    <article className="application-card" key={hold.holdId}>
                      <div className="class-emblem emblem-0"><span>{hold.className.match(/class\s*(\d+)/i)?.[1] ?? "C"}</span></div>
                      <div className="application-main"><h3>{hold.className}</h3><p>Application <span className="mono">{hold.holdId.slice(0, 10)}…</span></p></div>
                      <div className={`status-pill status-${hold.status.toLowerCase()}`}>{hold.status}</div>
                      <div className="application-actions">
                        {hold.status === "HELD" && <><span className="expires">Expires {new Date(hold.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><button className="confirm-button" disabled={busyHoldId === hold.holdId} onClick={() => void changeHold(hold, "confirm")}>Confirm seat</button><button className="cancel-button" disabled={busyHoldId === hold.holdId} onClick={() => void changeHold(hold, "cancel")}>Cancel</button></>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <p className="note-line"><span>i</span> Confirmation finalizes your seat. A held seat is released automatically if its timer expires.</p>
            </section>
          )}

          <footer className="footer"><span>© 2026 Northstar School</span><span>Need help? Contact <a href="mailto:admissions@northstar.school">admissions@northstar.school</a></span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
