import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, AdmissionClass, StudentHold } from "./api";

type View = "admissions" | "applications" | "admin";

const legacyPersonalKeys = ["banani-admission-profile", "admission-student-id"];

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 0,
  }).format(amount);
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S";
}

function formatRemaining(expiresAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function shiftFor(className: string) {
  if (/morning/i.test(className)) return "Morning Shift";
  if (/\bday\b/i.test(className)) return "Day Shift";
  if (/evening/i.test(className)) return "Evening Shift";
  return "Other";
}

function App() {
  const [classes, setClasses] = useState<AdmissionClass[]>([]);
  const [holds, setHolds] = useState<StudentHold[]>([]);
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [activeView, setActiveView] = useState<View>("admissions");
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [className, setClassName] = useState("");
  const [totalSeats, setTotalSeats] = useState("60");
  const [admissionFee, setAdmissionFee] = useState("0");
  const [search, setSearch] = useState("");
  const [shiftFilter, setShiftFilter] = useState("All Shifts");
  const [showClassForm, setShowClassForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingClass, setSavingClass] = useState(false);
  const [busyHoldId, setBusyHoldId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [lookupHolds, setLookupHolds] = useState<StudentHold[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState("");

  const refreshClasses = useCallback(async () => {
    setClasses(await api.getClasses());
  }, []);

  const refreshHolds = useCallback(async (id: string) => {
    setHolds(id.trim() ? await api.getHolds(id.trim()) : []);
  }, []);

  function renderApplicationRow(hold: StudentHold) {
    const statusLabel: Record<StudentHold["status"], string> = {
      HELD: "Reserved",
      CONFIRMED: "Admitted",
      EXPIRED: "Expired",
      CANCELLED: "Cancelled",
    };
    return (
      <article className="application-row" key={hold.holdId}>
        <span className="application-mark">▤</span>
        <span className="application-info">
          <strong>{hold.className}</strong>
          {hold.status === "HELD" && <small>Time left <span className="hold-timer">{formatRemaining(hold.expiresAt, now)}</span></small>}
        </span>
        <span className={`application-status status-${hold.status.toLowerCase()}`}>{statusLabel[hold.status]}</span>
      </article>
    );
  }

  async function checkApplicationStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = lookupId.trim();
    if (!id) return;
    setLookupBusy(true);
    setLookupError("");
    try {
      setLookupHolds(await api.getHolds(id));
    } catch (requestError) {
      setLookupHolds(null);
      setLookupError(requestError instanceof Error ? requestError.message : "Could not check status.");
    } finally {
      setLookupBusy(false);
    }
  }

  const refresh = useCallback(async () => {
    setError("");
    try {
      await refreshClasses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load admission data.");
    } finally {
      setLoading(false);
    }
  }, [refreshClasses]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    legacyPersonalKeys.forEach((key) => window.localStorage.removeItem(key));
  }, []);

  const hasActiveHold = holds.some((hold) => hold.status === "HELD")
    || (lookupHolds ?? []).some((hold) => hold.status === "HELD");
  useEffect(() => {
    if (!hasActiveHold) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveHold]);

  const counts = useMemo(() => classes.reduce(
    (total, admissionClass) => ({
      totalSeats: total.totalSeats + admissionClass.totalSeats,
      availableSeats: total.availableSeats + admissionClass.availableSeats,
      heldSeats: total.heldSeats + admissionClass.heldSeats,
      confirmedSeats: total.confirmedSeats + admissionClass.confirmedSeats,
    }),
    { totalSeats: 0, availableSeats: 0, heldSeats: 0, confirmedSeats: 0 },
  ), [classes]);

  const filteredClasses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return classes.filter((admissionClass) => {
      const matchesName = !query || admissionClass.name.toLowerCase().includes(query);
      const matchesShift = shiftFilter === "All Shifts" || shiftFor(admissionClass.name) === shiftFilter;
      return matchesName && matchesShift;
    });
  }, [classes, search, shiftFilter]);

  const selectedClass = classes.find((admissionClass) => admissionClass.id === selectedClassId)
    ?? (filteredClasses.length === 1 ? filteredClasses[0] : null);
  const selectedHold = selectedClass
    ? holds.find((hold) => hold.classId === selectedClass.id && (hold.status === "HELD" || hold.status === "CONFIRMED"))
    : undefined;

  useEffect(() => {
    if (selectedClassId) {
      document.getElementById("selected-class-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedClassId]);

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingClass(true);
    setError("");
    setNotice("");
    try {
      await api.createClass(className.trim(), Number(totalSeats), Number(admissionFee));
      setClassName("");
      setTotalSeats("60");
      setAdmissionFee("0");
      setShowClassForm(false);
      setNotice("Class added to the admissions list.");
      await refreshClasses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the class.");
    } finally {
      setSavingClass(false);
    }
  }

  async function holdSeat(admissionClass: AdmissionClass) {
    if (!studentName.trim() || !studentId.trim()) {
      setError("Enter your name and birth registration number to apply.");
      return;
    }
    setBusyHoldId(admissionClass.id);
    setError("");
    setNotice("");
    try {
      await api.holdSeat(admissionClass.id, studentId.trim());
      await Promise.all([refreshClasses(), refreshHolds(studentId.trim())]);
      setNotice(`Your seat in ${admissionClass.name} is reserved. Complete checkout before the hold expires.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reserve a seat.");
    } finally {
      setBusyHoldId(null);
    }
  }

  async function cancelHold(hold: StudentHold) {
    setBusyHoldId(hold.holdId);
    setError("");
    setNotice("");
    try {
      await api.cancelHold(hold.holdId, studentId.trim());
      await Promise.all([refreshClasses(), refreshHolds(studentId.trim())]);
      setNotice("Your seat reservation was cancelled.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not cancel this reservation.");
    } finally {
      setBusyHoldId(null);
    }
  }

  async function payDemo(hold: StudentHold) {
    setBusyHoldId(hold.holdId);
    setError("");
    setNotice("");
    try {
      await api.confirmHold(hold.holdId, studentId.trim());
      await Promise.all([refreshClasses(), refreshHolds(studentId.trim())]);
      setNotice("Admission confirmed. Demo checkout only; no money was charged.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not complete the demo checkout.");
    } finally {
      setBusyHoldId(null);
    }
  }

  return (
    <div className="portal-shell">
      <header className="topbar">
        <a className="topbar-brand" href="/" aria-label="Banani Bidyaniketan School & College home">
          <img src="/school-crest.svg" alt="" />
          <span>BANANI BIDYANIKETAN SCHOOL &amp; COLLEGE</span>
        </a>
        <p className="topbar-year">ADMISSION 2026-2027</p>
      </header>

      <aside className="sidebar">
        <p className="sidebar-label">STUDENT MENU</p>
        <nav className="sidebar-nav" aria-label="Portal navigation">
          <button
            className={activeView === "admissions" ? "side-link selected" : "side-link"}
            title="Explore Classes"
            onClick={() => {
              setActiveView("admissions");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="side-icon">⌂</span> Explore Classes
          </button>
          <button
            className={activeView === "applications" ? "side-link selected" : "side-link"}
            title="My Applications"
            onClick={() => {
              setActiveView("applications");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="side-icon">▤</span> My Applications
            {holds.some((hold) => hold.status === "HELD") && <span className="side-count">!</span>}
          </button>
        </nav>

        <p className="sidebar-label admin-nav-label">ADMINISTRATION</p>
        <nav className="sidebar-nav" aria-label="Administration navigation">
          <button
            className={activeView === "admin" ? "side-link selected" : "side-link"}
            title="Class Management"
            onClick={() => {
              setActiveView("admin");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="side-icon">▱</span> Class Management
          </button>
        </nav>

      </aside>

      <main className="main-content">
        <div className="page-content">
          {(error || notice) && (
            <div className={error ? "notice-banner error-notice" : "notice-banner success-notice"} role="status">
              <span>{error || notice}</span>
              <button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss message">×</button>
            </div>
          )}

          {activeView === "admissions" ? (
            <>
              <section className="class-section">
                <div className="class-section-heading">
                  <h2>Find your class</h2>
                  <div className="class-filters">
                    <label className="search-field">
                      <span>⌕</span>
                      <input
                        aria-label="Search classes"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search by class (e.g., Class 6, Class 7...)"
                      />
                    </label>
                    <label className="shift-select"><span>▦</span>
                      <select aria-label="Filter by shift" value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)}>
                        <option>All Shifts</option>
                        <option>Morning Shift</option>
                        <option>Day Shift</option>
                        <option>Evening Shift</option>
                        <option>Other</option>
                      </select>
                    </label>
                  </div>
                </div>

                {loading ? (
                  <div className="empty-class-state">Loading available classes…</div>
                ) : filteredClasses.length === 0 ? (
                  <div className="empty-class-state">
                    {classes.length === 0 ? "Admissions are opening soon. Please check back shortly." : "No classes match your search."}
                  </div>
                ) : (
                  <div className="class-grid">
                    {filteredClasses.map((admissionClass, index) => {
                      const occupied = admissionClass.confirmedSeats + admissionClass.heldSeats;
                      const occupiedPercent = admissionClass.totalSeats
                        ? Math.round((occupied / admissionClass.totalSeats) * 100)
                        : 0;
                      return (
                        <article
                          id={`class-${admissionClass.id}`}
                          className={`class-card${selectedClass?.id === admissionClass.id ? " is-selected" : ""}`}
                          key={admissionClass.id}
                          onClick={() => setSelectedClassId(admissionClass.id)}
                        >
                          <div className="class-card-heading">
                            <span className={`class-icon class-icon-${index % 5}`} aria-hidden="true">
                              <svg viewBox="0 0 24 24" fill="none">
                                <path d="M3.5 5.2c3.2-.8 6-.4 8.5 1.1v13c-2.5-1.5-5.3-1.9-8.5-1.1v-13Zm17 0c-3.2-.8-6-.4-8.5 1.1v13c2.5-1.5 5.3-1.9 8.5-1.1v-13Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
                              </svg>
                            </span>
                            <span className={admissionClass.availableSeats > 0 ? "availability-tag" : "availability-tag full"}>
                              {admissionClass.availableSeats > 0 ? "Seats Available" : "Class Full"}
                            </span>
                          </div>
                          <h3>{admissionClass.name.replace(/\s*-\s*(Morning|Day|Evening)\s+Shift/i, "")}</h3>
                          <span className="shift-tag">{shiftFor(admissionClass.name)}</span>
                          <div className="seat-numbers"><strong>{admissionClass.availableSeats}</strong><span> / {admissionClass.totalSeats} seats</span></div>
                          <div className="occupancy-row">
                            <div className="occupancy-track"><span style={{ width: `${occupiedPercent}%` }} /></div>
                            <span>{occupiedPercent}% occupied</span>
                          </div>
                          <div className="seat-breakdown">
                            <span><i className="status-check">✓</i> Confirmed: {admissionClass.confirmedSeats}</span>
                            <span className="breakdown-divider" />
                            <span><i className="status-hold">♙</i> Held: {admissionClass.heldSeats}</span>
                          </div>
                          <div className="fee-row">
                            <span>Admission fee</span>
                            <strong>{admissionClass.admissionFee > 0 ? formatCurrency(admissionClass.admissionFee) : "No fee"}</strong>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}

              </section>

              {selectedClass && (
              <section className="applications-section" id="apply-section">
                {selectedClass && (
                  <section id="selected-class-panel" className="selected-class-panel" aria-label="Selected class seat details">
                    <div className="selected-class-title">
                      <div>
                        <p className="eyebrow">SELECTED CLASS</p>
                        <h3>{selectedClass.name}</h3>
                      </div>
                      <span className={selectedClass.availableSeats > 0 ? "availability-tag" : "availability-tag full"}>
                        {selectedClass.availableSeats > 0 ? "Seats Available" : "Class Full"}
                      </span>
                    </div>
                    <div className="selected-class-stats">
                      <span><small>Total seats</small><strong>{selectedClass.totalSeats}</strong></span>
                      <span><small>Available seats</small><strong className="green-text">{selectedClass.availableSeats}</strong></span>
                      <span><small>Confirmed</small><strong>{selectedClass.confirmedSeats}</strong></span>
                      <span><small>On hold</small><strong className="amber-text">{selectedClass.heldSeats}</strong></span>
                      <span><small>Admission fee</small><strong>{selectedClass.admissionFee > 0 ? formatCurrency(selectedClass.admissionFee) : "No fee"}</strong></span>
                    </div>
                    {selectedHold?.status === "HELD" ? (
                      <div className="reserve-panel">
                        <div className="hold-status">
                          <span>Seat reserved for <strong>{studentName.trim()}</strong></span>
                          <span>Time left: <strong className="hold-timer">{formatRemaining(selectedHold.expiresAt, now)}</strong></span>
                        </div>
                        <div className="hold-actions">
                          <button className="apply-button" disabled={busyHoldId === selectedHold.holdId} onClick={() => void payDemo(selectedHold)}>
                            {busyHoldId === selectedHold.holdId
                              ? "Processing…"
                              : selectedClass.admissionFee > 0
                                ? `Pay ${formatCurrency(selectedClass.admissionFee)} & complete`
                                : "Complete admission"} <span>→</span>
                          </button>
                          <button className="cancel-reservation" disabled={busyHoldId === selectedHold.holdId} onClick={() => void cancelHold(selectedHold)}>Cancel</button>
                        </div>
                        <p className="demo-disclaimer">Demo payment only. No real money is charged.</p>
                      </div>
                    ) : selectedHold?.status === "CONFIRMED" ? (
                      <div className="confirmed-panel"><span>✓</span><span><strong>Admission complete</strong><small>Payment received · {selectedClass.name}</small></span></div>
                    ) : (
                      <form className="reserve-form" onSubmit={(event) => { event.preventDefault(); void holdSeat(selectedClass); }}>
                        <label>Student name
                          <input value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="Full name" maxLength={100} autoComplete="name" required />
                        </label>
                        <label>Birth registration number
                          <input value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="17-digit number" maxLength={80} inputMode="numeric" autoComplete="off" required />
                        </label>
                        <button className="apply-button" type="submit" disabled={selectedClass.availableSeats <= 0 || busyHoldId === selectedClass.id}>
                          {busyHoldId === selectedClass.id ? "Submitting…" : "Submit & apply"} <span>→</span>
                        </button>
                      </form>
                    )}
                  </section>
                )}

              </section>
              )}
            </>
          ) : activeView === "applications" ? (
            <section className="applications-section" id="my-applications">
              <div className="section-title-row">
                <div><p className="eyebrow">ADMISSION STATUS</p><h2>My applications</h2></div>
              </div>
              <form className="status-lookup-form" onSubmit={(event) => void checkApplicationStatus(event)}>
                <input value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="Birth registration number" maxLength={80} inputMode="numeric" autoComplete="off" aria-label="Birth registration number" />
                <button className="apply-button" type="submit" disabled={lookupBusy || !lookupId.trim()}>{lookupBusy ? "Checking…" : "Check"}</button>
              </form>
              {lookupError && <p className="form-error">{lookupError}</p>}
              {lookupHolds && (lookupHolds.length === 0 ? (
                <p className="applications-empty">No application found for this registration number.</p>
              ) : (
                <>
                  {lookupHolds.find((hold) => hold.status === "CONFIRMED") && (
                    <div className="confirmed-panel">
                      <span>✓</span>
                      <span><strong>Admitted to {lookupHolds.find((hold) => hold.status === "CONFIRMED")?.className}</strong></span>
                    </div>
                  )}
                  <div className="application-list">
                    {lookupHolds.map((hold) => renderApplicationRow(hold))}
                  </div>
                </>
              ))}
            </section>
          ) : (
            <section className="admin-section">
              <div className="admin-heading">
                <div><p className="eyebrow">ADMISSIONS SETUP</p><h2>Class management</h2><p>Create a class with a seat capacity and admission fee.</p></div>
                <button className="apply-button admin-add-button" onClick={() => setShowClassForm(!showClassForm)}>{showClassForm ? "Close form" : "+ Create class"}</button>
              </div>
              {showClassForm && (
                <form className="admin-form" onSubmit={(event) => void submitClass(event)}>
                  <label>Class and shift<input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="e.g. Class 6 - Morning Shift" maxLength={120} required /></label>
                  <label>Total seats<input type="number" min="1" max="10000" value={totalSeats} onChange={(event) => setTotalSeats(event.target.value)} required /></label>
                  <label>Admission fee (BDT)<input type="number" min="0" max="9999999999" step="1" value={admissionFee} onChange={(event) => setAdmissionFee(event.target.value)} required /></label>
                  <button className="apply-button" type="submit" disabled={savingClass}>{savingClass ? "Creating…" : "Save class"} →</button>
                </form>
              )}
              <div className="admin-class-list">
                <div className="admin-list-heading"><span>Class</span><span>Seats</span><span>Confirmed</span><span>On hold</span><span>Admission fee</span></div>
                {loading ? <p className="applications-empty">Loading classes…</p> : classes.length === 0 ? <p className="applications-empty">No classes have been created yet.</p> : classes.map((admissionClass) => (
                  <div className="admin-list-row" key={admissionClass.id}>
                    <strong>{admissionClass.name}</strong>
                    <span>{admissionClass.totalSeats}</span>
                    <span>{admissionClass.confirmedSeats}</span>
                    <span>{admissionClass.heldSeats}</span>
                    <span>{admissionClass.admissionFee > 0 ? formatCurrency(admissionClass.admissionFee) : "No fee"}</span>
                  </div>
                ))}
              </div>
              <p className="admin-demo-note">Demo portal: the assignment does not include admin sign-in or role authorization.</p>
            </section>
          )}

          <footer className="page-footer"><img src="/school-crest.svg" alt="" /> Banani Bidyaniketan School &amp; College <span>Admission 2026-2027</span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
