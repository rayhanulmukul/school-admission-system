import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, AdmissionClass, StudentHold } from "./api";

type View = "classes" | "applications";

function App() {
  const [classes, setClasses] = useState<AdmissionClass[]>([]);
  const [holds, setHolds] = useState<StudentHold[]>([]);
  const [studentId, setStudentId] = useState(
    () => window.localStorage.getItem("admission-student-id") ?? "",
  );
  const [activeView, setActiveView] = useState<View>("classes");
  const [className, setClassName] = useState("");
  const [totalSeats, setTotalSeats] = useState("30");
  const [showClassForm, setShowClassForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingClass, setSavingClass] = useState(false);
  const [busyHoldId, setBusyHoldId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshClasses = useCallback(async () => {
    setClasses(await api.getClasses());
  }, []);

  const refreshHolds = useCallback(async (id: string) => {
    setHolds(id.trim() ? await api.getHolds(id.trim()) : []);
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
    const id = studentId.trim();
    if (id) {
      window.localStorage.setItem("admission-student-id", id);
      void refreshHolds(id).catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not load your applications.");
      });
    } else {
      window.localStorage.removeItem("admission-student-id");
      setHolds([]);
    }
  }, [studentId, refreshHolds]);

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingClass(true);
    setError("");
    setNotice("");
    try {
      await api.createClass(className.trim(), Number(totalSeats));
      setClassName("");
      setTotalSeats("30");
      setShowClassForm(false);
      setNotice("Class added.");
      await refreshClasses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the class.");
    } finally {
      setSavingClass(false);
    }
  }

  async function holdSeat(admissionClass: AdmissionClass) {
    if (!studentId.trim()) {
      setError("Enter a student ID to reserve a seat.");
      document.getElementById("student-id")?.focus();
      return;
    }
    setBusyHoldId(admissionClass.id);
    setError("");
    setNotice("");
    try {
      const hold = await api.holdSeat(admissionClass.id, studentId.trim());
      setNotice(`Seat reserved until ${new Date(hold.expiresAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}.`);
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
        setNotice("Seat confirmed.");
      } else {
        await api.cancelHold(hold.holdId, studentId.trim());
        setNotice("Reservation cancelled.");
      }
      await refresh(studentId.trim());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update this reservation.");
    } finally {
      setBusyHoldId(null);
    }
  }

  const activeHolds = holds.filter(
    (hold) => hold.status === "HELD" || hold.status === "CONFIRMED",
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Northstar School admissions">
          <span className="brand-mark">N</span>
          <span className="brand-name">Northstar <span>Admissions</span></span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={activeView === "classes" ? "nav-link active" : "nav-link"}
            onClick={() => setActiveView("classes")}
          >
            Classes
          </button>
          <button
            className={activeView === "applications" ? "nav-link active" : "nav-link"}
            onClick={() => setActiveView("applications")}
          >
            My applications
            {activeHolds.length > 0 && <span className="nav-count">{activeHolds.length}</span>}
          </button>
        </nav>
        <span className="school-label">School admission</span>
      </header>

      <main className="page-content">
        <section className="page-heading">
          <div>
            <p className="eyebrow">NORTHSTAR SCHOOL</p>
            <h1>{activeView === "classes" ? "Find your class" : "My applications"}</h1>
            <p className="page-description">
              {activeView === "classes"
                ? "Choose a class to check availability and reserve a seat."
                : "Review and manage your seat reservations."}
            </p>
          </div>
          <label className="student-field" htmlFor="student-id">
            <span>Student ID</span>
            <input
              id="student-id"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="Enter your student ID"
              maxLength={80}
              autoComplete="off"
            />
          </label>
        </section>

        {(error || notice) && (
          <div className={error ? "alert error-alert" : "alert success-alert"} role="status">
            <span>{error || notice}</span>
            <button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss message">
              ×
            </button>
          </div>
        )}

        {activeView === "classes" ? (
          <section className="catalog">
            <div className="catalog-heading">
              <div>
                <h2>Available classes</h2>
                <span>{classes.length} {classes.length === 1 ? "class" : "classes"}</span>
              </div>
              <button
                className="secondary-button"
                onClick={() => {
                  setShowClassForm(!showClassForm);
                  setError("");
                  setNotice("");
                }}
              >
                {showClassForm ? "Close" : "+ Add class"}
              </button>
            </div>

            {showClassForm && (
              <form className="create-class-form" onSubmit={(event) => void submitClass(event)}>
                <label>
                  Class and shift
                  <input
                    value={className}
                    onChange={(event) => setClassName(event.target.value)}
                    placeholder="e.g. Class 6 - Morning Shift"
                    maxLength={120}
                    required
                  />
                </label>
                <label className="seat-input">
                  Total seats
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={totalSeats}
                    onChange={(event) => setTotalSeats(event.target.value)}
                    required
                  />
                </label>
                <button className="primary-button" type="submit" disabled={savingClass}>
                  {savingClass ? "Adding…" : "Add class"}
                </button>
              </form>
            )}

            {loading ? (
              <div className="empty-state">Loading classes…</div>
            ) : classes.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">—</span>
                <h3>No classes available</h3>
                <p>New classes will appear here when enrollment opens.</p>
              </div>
            ) : (
              <div className="class-grid">
                {classes.map((admissionClass, index) => {
                  const occupied = admissionClass.confirmedSeats + admissionClass.heldSeats;
                  const percent = admissionClass.totalSeats
                    ? Math.round((occupied / admissionClass.totalSeats) * 100)
                    : 0;
                  const alreadyApplied = holds.some((hold) =>
                    hold.classId === admissionClass.id &&
                    (hold.status === "HELD" || hold.status === "CONFIRMED"));

                  return (
                    <article className="class-card" key={admissionClass.id}>
                      <div className="class-card-top">
                        <span className={`class-emblem emblem-${index % 4}`}>
                          {admissionClass.name.match(/class\s*(\d+)/i)?.[1] ?? "C"}
                        </span>
                        <span className={admissionClass.availableSeats > 0 ? "availability open" : "availability full"}>
                          <span />{admissionClass.availableSeats > 0 ? "Open" : "Full"}
                        </span>
                      </div>
                      <h3>{admissionClass.name}</h3>
                      <div className="seat-summary">
                        <strong>{admissionClass.availableSeats}</strong>
                        <span>of {admissionClass.totalSeats} seats available</span>
                      </div>
                      <div
                        className="seat-progress"
                        role="progressbar"
                        aria-label="Class seats reserved"
                        aria-valuenow={percent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <span style={{ width: `${percent}%` }} />
                      </div>
                      <button
                        className="primary-button reserve-button"
                        disabled={admissionClass.availableSeats <= 0 || alreadyApplied || busyHoldId === admissionClass.id}
                        onClick={() => void holdSeat(admissionClass)}
                      >
                        {busyHoldId === admissionClass.id
                          ? "Reserving…"
                          : alreadyApplied
                            ? "Already applied"
                            : "Reserve a seat"}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : (
          <section className="catalog applications">
            <div className="catalog-heading">
              <div>
                <h2>Your reservations</h2>
                <span>{holds.length} {holds.length === 1 ? "application" : "applications"}</span>
              </div>
              <button className="secondary-button" onClick={() => void refresh()}>
                Refresh
              </button>
            </div>
            {!studentId.trim() ? (
              <div className="empty-state">
                <h3>Enter your student ID</h3>
                <p>Your applications are linked to your student ID.</p>
              </div>
            ) : holds.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">—</span>
                <h3>No applications yet</h3>
                <p>Reserved seats will appear here.</p>
              </div>
            ) : (
              <div className="application-list">
                {holds.map((hold) => (
                  <article className="application-card" key={hold.holdId}>
                    <div className="application-main">
                      <h3>{hold.className}</h3>
                      <span className="application-id">{hold.holdId}</span>
                    </div>
                    <span className={`status-pill status-${hold.status.toLowerCase()}`}>
                      {hold.status.toLowerCase()}
                    </span>
                    {hold.status === "HELD" && (
                      <div className="application-actions">
                        <span className="expires">
                          Until {new Date(hold.expiresAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <button
                          className="primary-button"
                          disabled={busyHoldId === hold.holdId}
                          onClick={() => void changeHold(hold, "confirm")}
                        >
                          Confirm seat
                        </button>
                        <button
                          className="cancel-button"
                          disabled={busyHoldId === hold.holdId}
                          onClick={() => void changeHold(hold, "cancel")}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        <footer className="footer">Northstar School</footer>
      </main>
    </div>
  );
}

export default App;
