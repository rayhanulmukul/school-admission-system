import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, AdmissionClass, StudentHold } from "./api";

type View = "admissions" | "admin";

const profileStorageKey = "banani-admission-profile";

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
  const savedProfile = useMemo(() => {
    try {
      return JSON.parse(window.localStorage.getItem(profileStorageKey) ?? "{}") as {
        name?: string;
        studentId?: string;
      };
    } catch {
      return {};
    }
  }, []);
  const [classes, setClasses] = useState<AdmissionClass[]>([]);
  const [holds, setHolds] = useState<StudentHold[]>([]);
  const [studentName, setStudentName] = useState(savedProfile.name ?? "");
  const [studentId, setStudentId] = useState(
    savedProfile.studentId ?? window.localStorage.getItem("admission-student-id") ?? "",
  );
  const [activeView, setActiveView] = useState<View>("admissions");
  const [profileOpen, setProfileOpen] = useState(false);
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

  const hasActiveHold = holds.some((hold) => hold.status === "HELD");
  useEffect(() => {
    if (!hasActiveHold) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveHold]);

  useEffect(() => {
    const profile = { name: studentName, studentId: studentId.trim() };
    window.localStorage.setItem(profileStorageKey, JSON.stringify(profile));
    if (profile.studentId) {
      window.localStorage.setItem("admission-student-id", profile.studentId);
      void refreshHolds(profile.studentId).catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not load applications.");
      });
    } else {
      window.localStorage.removeItem("admission-student-id");
      setHolds([]);
    }
  }, [studentName, studentId, refreshHolds]);

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
    if (!studentId.trim()) {
      setError("Enter your birth registration number before reserving a seat.");
      setProfileOpen(true);
      window.setTimeout(() => document.getElementById("student-id")?.focus(), 0);
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

  function navigateToApplications() {
    setActiveView("admissions");
    window.setTimeout(
      () => document.getElementById("my-applications")?.scrollIntoView({ behavior: "smooth" }),
      0,
    );
  }

  return (
    <div className="portal-shell">
      <header className="topbar">
        <a className="topbar-brand" href="/" aria-label="Banani Bidyaniketan School & College home">
          <img src="/school-crest.svg" alt="" />
          <span>BANANI BIDYANIKETAN SCHOOL &amp; COLLEGE</span>
        </a>
        <div className="header-profile">
          <button
            className="profile-trigger"
            type="button"
            aria-expanded={profileOpen}
            aria-controls="profile-menu"
            onClick={() => setProfileOpen(!profileOpen)}
          >
            <span className="profile-avatar">{initials(studentName)}</span>
            <span className="profile-trigger-copy">
              <strong>{studentName.trim() || "Student profile"}</strong>
              <span>{studentId.trim() || "Add registration number"}</span>
            </span>
            <span className="profile-chevron" aria-hidden="true">⌄</span>
          </button>
          {profileOpen && (
            <section className="profile-menu" id="profile-menu" aria-label="Student profile">
              <div className="profile-menu-heading">
                <strong>Student profile</strong>
                <button type="button" onClick={() => setProfileOpen(false)} aria-label="Close profile">×</button>
              </div>
              <label className="profile-name-field" htmlFor="student-name">
                <span className="field-caption">STUDENT NAME</span>
                <input
                  id="student-name"
                  value={studentName}
                  onChange={(event) => setStudentName(event.target.value)}
                  placeholder="Your full name"
                  maxLength={100}
                  autoComplete="name"
                />
              </label>
              <label className="student-id-field" htmlFor="student-id">
                <span className="field-caption">BIRTH REGISTRATION NUMBER</span>
                <input
                  id="student-id"
                  value={studentId}
                  onChange={(event) => setStudentId(event.target.value)}
                  placeholder="Enter your 17-digit number"
                  maxLength={80}
                  inputMode="numeric"
                  autoComplete="off"
                />
              </label>
              <button className="profile-save-button" type="button" onClick={() => setProfileOpen(false)}>Done</button>
            </section>
          )}
        </div>
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
          <button className="side-link" title="My Applications" onClick={navigateToApplications}>
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

        <section className="sidebar-year" aria-label="Academic year">
          <span className="year-icon">▦</span>
          <span>Academic Year<strong>2027</strong></span>
          <span className="year-rule" />
          <span>School Admissions</span>
        </section>
      </aside>

      <main className="main-content">
        <div className="page-content">
          <div className="breadcrumb">
            <span>⌂</span> Admissions <span>/</span>
            <strong>{activeView === "admin" ? "Class Management" : "Explore Classes"}</strong>
            <span className="admissions-open"><span /> Admissions Open</span>
          </div>

          {(error || notice) && (
            <div className={error ? "notice-banner error-notice" : "notice-banner success-notice"} role="status">
              <span>{error || notice}</span>
              <button onClick={() => { setError(""); setNotice(""); }} aria-label="Dismiss message">×</button>
            </div>
          )}

          {activeView === "admissions" ? (
            <>
              <section className="summary-grid" aria-label="Seat availability summary">
                <article className="summary-card">
                  <span className="summary-icon green-icon">♧</span>
                  <span className="summary-copy">Total Seats<strong>{counts.totalSeats.toLocaleString()}</strong></span>
                </article>
                <article className="summary-card">
                  <span className="summary-icon blue-icon">▣</span>
                  <span className="summary-copy">Available Seats<strong className="green-text">{counts.availableSeats.toLocaleString()}</strong></span>
                </article>
                <article className="summary-card">
                  <span className="summary-icon amber-icon">♙</span>
                  <span className="summary-copy">Seats on Hold<strong className="amber-text">{counts.heldSeats.toLocaleString()}</strong></span>
                </article>
                <article className="summary-card">
                  <span className="summary-icon green-icon">✓</span>
                  <span className="summary-copy">Confirmed Admissions<strong className="green-text">{counts.confirmedSeats.toLocaleString()}</strong></span>
                </article>
              </section>

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

                {selectedClass && (
                  <section className="selected-class-panel" aria-label="Selected class seat details">
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
                  </section>
                )}

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
                      const studentHold = holds.find((hold) =>
                        hold.classId === admissionClass.id &&
                        (hold.status === "HELD" || hold.status === "CONFIRMED"));

                      return (
                        <article
                          id={`class-${admissionClass.id}`}
                          className={`class-card${studentHold ? " has-application" : ""}${selectedClass?.id === admissionClass.id ? " is-selected" : ""}`}
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
                          {studentHold?.status === "HELD" ? (
                            <div className="inline-checkout">
                              <div className="checkout-title"><span className="checkout-lock">▣</span><span><strong>Seat reserved for you</strong><span>Time left to complete payment: <strong className="hold-timer">{formatRemaining(studentHold.expiresAt, now)}</strong></span></span></div>
                              <div className="checkout-total"><span>{admissionClass.admissionFee > 0 ? "Demo admission fee" : "Admission fee"}</span><strong>{admissionClass.admissionFee > 0 ? formatCurrency(admissionClass.admissionFee) : "Free"}</strong></div>
                              <p className="demo-disclaimer">Demo checkout only. No real payment is collected.</p>
                              <button className="apply-button" disabled={busyHoldId === studentHold.holdId} onClick={() => void payDemo(studentHold)}>
                                {busyHoldId === studentHold.holdId
                                  ? "Confirming…"
                                  : admissionClass.admissionFee > 0
                                    ? `Pay ${formatCurrency(admissionClass.admissionFee)} & confirm`
                                    : "Confirm free admission"} <span>→</span>
                              </button>
                              <button className="cancel-reservation" disabled={busyHoldId === studentHold.holdId} onClick={() => void cancelHold(studentHold)}>Cancel reservation</button>
                            </div>
                          ) : studentHold?.status === "CONFIRMED" ? (
                            <div className="confirmed-panel"><span>✓</span><span><strong>Admission confirmed</strong><small>Demo checkout complete · No payment was collected</small></span></div>
                          ) : (
                            <button
                              className="apply-button"
                              disabled={admissionClass.availableSeats <= 0 || busyHoldId === admissionClass.id}
                              onClick={() => void holdSeat(admissionClass)}
                            >
                              {busyHoldId === admissionClass.id ? "Reserving…" : "Apply for this class"} <span>↗</span>
                            </button>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="admission-steps" aria-label="Admission steps">
                <div className="step-item"><span className="step-number">1</span><span><strong>Choose your class</strong><small>Browse available classes and shifts.</small></span></div>
                <span className="step-chevron">›</span>
                <div className="step-item"><span className="step-number">2</span><span><strong>Reserve your seat</strong><small>Apply and hold a seat in your selected class.</small></span></div>
                <span className="step-chevron">›</span>
                <div className="step-item"><span className="step-number">3</span><span><strong>Confirm admission</strong><small>Review your application and confirm.</small></span></div>
              </section>

              <section className="applications-section" id="my-applications">
                <div className="section-title-row"><div><p className="eyebrow">YOUR ADMISSION JOURNEY</p><h2>My applications</h2></div><button className="refresh-button" onClick={() => void refresh()}>↻ Refresh</button></div>
                {!studentId.trim() ? (
                  <p className="applications-empty">Add your registration number from the profile menu to see your applications.</p>
                ) : holds.length === 0 ? (
                  <p className="applications-empty">Your class reservations will appear here.</p>
                ) : (
                  <div className="application-list">
                    {holds.map((hold) => (
                      <article className="application-row" key={hold.holdId}>
                        <span className="application-mark">▤</span>
                        <span className="application-info"><strong>{hold.className}</strong><small>Application {hold.holdId.slice(0, 10)}…</small></span>
                        <span className={`application-status status-${hold.status.toLowerCase()}`}>{hold.status.toLowerCase()}</span>
                        {hold.status === "HELD" && <button className="text-button" onClick={() => document.getElementById(`class-${hold.classId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>Continue checkout ↓</button>}
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
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

          <footer className="page-footer"><img src="/school-crest.svg" alt="" /> Banani Bidyaniketan School &amp; College <span>Academic Year 2027</span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
