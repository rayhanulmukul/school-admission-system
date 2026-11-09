import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, AdmissionClass, AdmittedStudent, StudentHold } from "./api";

type View = "admissions" | "apply" | "applications" | "admin" | "admitted";

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

function displayClassName(className: string) {
  return className.replace(/\s*-\s*(Morning|Day|Evening) Shift$/i, "");
}

function App() {
  const [classes, setClasses] = useState<AdmissionClass[]>([]);
  const [holds, setHolds] = useState<StudentHold[]>([]);
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [activeView, setActiveView] = useState<View>("admissions");
  const applyReturnScrollY = useRef(0);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [className, setClassName] = useState("");
  const [classShift, setClassShift] = useState("Morning");
  const [totalSeats, setTotalSeats] = useState("60");
  const [admissionFee, setAdmissionFee] = useState("0");
  const [search, setSearch] = useState("");
  const [shiftFilter, setShiftFilter] = useState("All Shifts");
  const [showClassForm, setShowClassForm] = useState(false);
  const [admittedClass, setAdmittedClass] = useState<AdmissionClass | null>(null);
  const [admittedStudents, setAdmittedStudents] = useState<AdmittedStudent[]>([]);
  const [loadingAdmitted, setLoadingAdmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingClass, setSavingClass] = useState(false);
  const [deletingClassId, setDeletingClassId] = useState<string | null>(null);
  const [removingHoldId, setRemovingHoldId] = useState<string | null>(null);
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

  async function submitClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingClass(true);
    setError("");
    setNotice("");
    try {
      await api.createClass(`${className.trim()} - ${classShift} Shift`, Number(totalSeats), Number(admissionFee));
      setClassName("");
      setClassShift("Morning");
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

  async function openAdmitted(admissionClass: AdmissionClass) {
    setAdmittedClass(admissionClass);
    setAdmittedStudents([]);
    setActiveView("admitted");
    setLoadingAdmitted(true);
    setError("");
    try {
      setAdmittedStudents(await api.getClassAdmissions(admissionClass.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load admitted students.");
    } finally {
      setLoadingAdmitted(false);
    }
  }

  async function deleteClass(admissionClass: AdmissionClass) {
    if (!window.confirm(`Delete ${displayClassName(admissionClass.name)}? This cannot be undone.`)) {
      return;
    }
    setDeletingClassId(admissionClass.id);
    setError("");
    setNotice("");
    try {
      await api.deleteClass(admissionClass.id);
      await refreshClasses();
      setNotice("Class deleted.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not delete the class.");
    } finally {
      setDeletingClassId(null);
    }
  }

  async function removeAdmittedStudent(student: AdmittedStudent) {
    if (!admittedClass) {
      return;
    }
    if (!window.confirm(`Remove ${student.studentName || student.studentId} from ${displayClassName(admittedClass.name)}? Their seat will be released.`)) {
      return;
    }
    setRemovingHoldId(student.holdId);
    setError("");
    setNotice("");
    try {
      await api.removeAdmittedStudent(admittedClass.id, student.holdId);
      setAdmittedStudents((current) => current.filter((item) => item.holdId !== student.holdId));
      setNotice("Student removed from the admitted list and the seat was released.");
      await refreshClasses();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not remove this student.");
    } finally {
      setRemovingHoldId(null);
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
      await api.holdSeat(admissionClass.id, studentId.trim(), studentName.trim());
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
            className={activeView === "admissions" || activeView === "apply" ? "side-link selected" : "side-link"}
            title="Apply for Admission"
            onClick={() => {
              setActiveView("admissions");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="side-icon">⌂</span> Apply for Admission
          </button>
          <button
            className={activeView === "applications" ? "side-link selected" : "side-link"}
            title="Check Admission"
            onClick={() => {
              setActiveView("applications");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            <span className="side-icon">▤</span> Check Admission
            {holds.some((hold) => hold.status === "HELD") && <span className="side-count">!</span>}
          </button>
        </nav>

        <p className="sidebar-label admin-nav-label">ADMINISTRATION</p>
        <nav className="sidebar-nav" aria-label="Administration navigation">
          <button
            className={activeView === "admin" || activeView === "admitted" ? "side-link selected" : "side-link"}
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
                          <button
                            type="button"
                            className="apply-button"
                            disabled={admissionClass.availableSeats <= 0}
                            onClick={(event) => {
                              event.stopPropagation();
                              applyReturnScrollY.current = window.scrollY;
                              setSelectedClassId(admissionClass.id);
                              setActiveView("apply");
                              window.scrollTo({ top: 0 });
                            }}
                          >
                            Apply for this class <span aria-hidden="true">→</span>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}

              </section>

            </>
          ) : activeView === "apply" && selectedClass ? (
            <section className="apply-page">
              <div className="apply-page-header">
                <div>
                  <p className="eyebrow">ADMISSION 2026-2027</p>
                  <h2>Apply for {displayClassName(selectedClass.name)}</h2>
                </div>
                <button className="back-button" onClick={() => {
                  setActiveView("admissions");
                  window.scrollTo({ top: applyReturnScrollY.current });
                }}>← Back to classes</button>
              </div>
              <ol className="apply-steps" aria-label="Application steps">
                <li className="done"><span>✓</span>Choose class</li>
                <li className={selectedHold?.status === "HELD" || selectedHold?.status === "CONFIRMED" ? "done" : "active"}><span>2</span>Student details</li>
                <li className={selectedHold?.status === "CONFIRMED" ? "done" : selectedHold?.status === "HELD" ? "active" : ""}><span>3</span>Reserve seat</li>
              </ol>
              <div className="apply-layout">
                <section className="apply-card apply-main" aria-label="Student details">
                  {selectedHold?.status === "HELD" ? (
                    <div className="reserve-panel">
                      <div className="hold-card">
                        <div>
                          <span className="hold-label">Seat reserved for</span>
                          <strong>{studentName.trim() || studentId.trim()}</strong>
                        </div>
                        <div className="hold-timer-pill">
                          <span>Time left</span>
                          <strong className="hold-timer">{formatRemaining(selectedHold.expiresAt, now)}</strong>
                        </div>
                      </div>
                      <div className="hold-actions">
                        <button className="apply-button pay-button" disabled={busyHoldId === selectedHold.holdId} onClick={() => void payDemo(selectedHold)}>
                          {busyHoldId === selectedHold.holdId
                            ? "Processing…"
                            : selectedClass.admissionFee > 0
                              ? `Pay ${formatCurrency(selectedClass.admissionFee)} & complete`
                              : "Complete admission"} <span>→</span>
                        </button>
                        <button className="cancel-button" disabled={busyHoldId === selectedHold.holdId} onClick={() => void cancelHold(selectedHold)}>Cancel reservation</button>
                      </div>
                      <p className="demo-disclaimer">Demo payment only. No real money is charged.</p>
                    </div>
                  ) : selectedHold?.status === "CONFIRMED" ? (
                    <div className="confirmed-panel"><span>✓</span><span><strong>Admission complete</strong><small>Payment received · {displayClassName(selectedClass.name)}</small></span></div>
                  ) : (
                    <form className="reserve-form" onSubmit={(event) => { event.preventDefault(); void holdSeat(selectedClass); }}>
                      <div className="apply-card-heading">
                        <h3>Student details</h3>
                        <p>Enter the details exactly as shown on the birth certificate.</p>
                      </div>
                      <label>Student's full name
                        <input value={studentName} onChange={(event) => setStudentName(event.target.value)} placeholder="As written on the birth certificate" maxLength={100} autoComplete="name" required />
                      </label>
                      <label>Birth registration number
                        <input value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="17-digit number from the birth certificate" maxLength={80} inputMode="numeric" autoComplete="off" required />
                        <small className="field-hint">Use the number printed on the birth certificate.</small>
                      </label>
                      <div className="apply-notice">
                        <strong>Your seat is reserved for 10 minutes</strong>
                        <span>The reservation starts after you submit your application.</span>
                      </div>
                      <div className="apply-form-footer">
                        <span>{selectedClass.admissionFee > 0 ? `Payment of ${formatCurrency(selectedClass.admissionFee)} follows (demo)` : "No payment required at this step"}</span>
                        <button className="apply-button" type="submit" disabled={selectedClass.availableSeats <= 0 || busyHoldId === selectedClass.id}>
                          {busyHoldId === selectedClass.id ? "Submitting…" : "Submit & apply"} <span>→</span>
                        </button>
                      </div>
                    </form>
                  )}
                </section>
                <aside className="apply-side">
                  <section className="apply-card" aria-label="Selected class">
                    <p className="eyebrow">Your selected class</p>
                    <h3 className="apply-class-name">{displayClassName(selectedClass.name)}</h3>
                    <span className="shift-tag">{shiftFor(selectedClass.name)}</span>
                    <div className="apply-seats">
                      <strong className={selectedClass.availableSeats > 0 ? "green-text" : "amber-text"}>{selectedClass.availableSeats}</strong>
                      <span>of {selectedClass.totalSeats} seats available</span>
                    </div>
                    <div className="apply-meter" aria-hidden="true">
                      <span style={{ width: `${selectedClass.totalSeats > 0 ? (selectedClass.availableSeats / selectedClass.totalSeats) * 100 : 0}%` }} />
                    </div>
                    <div className="apply-fee">
                      <span>Admission fee</span>
                      <strong>{selectedClass.admissionFee > 0 ? formatCurrency(selectedClass.admissionFee) : "No fee"}</strong>
                    </div>
                    <span className={selectedClass.availableSeats > 0 ? "availability-tag" : "availability-tag full"}>
                      {selectedClass.availableSeats > 0 ? "Applications open" : "Class full"}
                    </span>
                  </section>
                  <section className="apply-card" aria-label="What happens next">
                    <h3>What happens next?</h3>
                    <ol className="apply-next">
                      <li><span>1</span>Your seat is placed on hold</li>
                      <li><span>2</span>Check your status under My Applications</li>
                    </ol>
                  </section>
                </aside>
              </div>
            </section>
          ) : activeView === "applications" ? (
            <section className="status-page" id="my-applications">
              <h2>My applications</h2>
              <div className="status-card">
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
              </div>
            </section>
          ) : activeView === "admitted" ? (
            <section className="admin-section">
              <div className="admin-heading admitted-heading">
                <div>
                  <p className="eyebrow">ADMITTED STUDENTS</p>
                  <h2>{admittedClass ? displayClassName(admittedClass.name) : "Class"} <span className="shift-tag">{admittedClass ? shiftFor(admittedClass.name) : ""}</span></h2>
                  <p>{loadingAdmitted ? "Loading…" : `${admittedStudents.length} admitted ${admittedStudents.length === 1 ? "student" : "students"}`}</p>
                </div>
                <button className="back-pill" onClick={() => setActiveView("admin")}>← Back to classes</button>
              </div>
              {loadingAdmitted ? <p className="applications-empty">Loading admitted students…</p> : admittedStudents.length === 0 ? <p className="applications-empty">No student has been admitted to this class yet.</p> : (
                <div className="admin-admitted-page">
                  <table className="admin-admitted-table">
                    <thead><tr><th>#</th><th>Student name</th><th>Birth registration number</th><th>Action</th></tr></thead>
                    <tbody>
                      {admittedStudents.map((student, index) => (
                        <tr key={student.holdId}>
                          <td>{index + 1}</td>
                          <td>{student.studentName || "Not provided"}</td>
                          <td>{student.studentId}</td>
                          <td><button className="delete-pill" aria-label={`Remove ${student.studentName || student.studentId}`} disabled={removingHoldId === student.holdId} onClick={() => void removeAdmittedStudent(student)}>{removingHoldId === student.holdId ? "Removing…" : "Delete"}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : (
            <section className="admin-section">
              <div className="admin-heading">
                <div><p className="eyebrow">ADMISSIONS SETUP</p><h2>Class management</h2></div>
                <button className="apply-button admin-add-button" onClick={() => setShowClassForm(!showClassForm)}>{showClassForm ? "Close form" : "+ Create class"}</button>
              </div>
              {showClassForm && (
                <form className="admin-form" onSubmit={(event) => void submitClass(event)}>
                  <label>Class name<input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="e.g. Class 6" maxLength={100} required /></label>
                  <label>Shift<select value={classShift} onChange={(event) => setClassShift(event.target.value)} required>
                    <option>Morning</option>
                    <option>Day</option>
                    <option>Evening</option>
                  </select></label>
                  <label>Total seats<input type="number" min="1" max="10000" value={totalSeats} onChange={(event) => setTotalSeats(event.target.value)} required /></label>
                  <label>Admission fee (BDT)<input type="number" min="0" max="9999999999" step="1" value={admissionFee} onChange={(event) => setAdmissionFee(event.target.value)} required /></label>
                  <button className="apply-button" type="submit" disabled={savingClass}>{savingClass ? "Creating…" : "Save class"} →</button>
                </form>
              )}
              <div className="admin-class-list">
                <div className="admin-list-heading"><span>Class</span><span>Shift</span><span>Seats</span><span>Confirmed</span><span>On hold</span><span>Admission fee</span><span>Students</span><span>Delete</span></div>
                {loading ? <p className="applications-empty">Loading classes…</p> : classes.length === 0 ? <p className="applications-empty">No classes have been created yet.</p> : classes.map((admissionClass) => (
                  <div className="admin-list-row" key={admissionClass.id}>
                    <div className="admin-class-cell">
                      <strong>{displayClassName(admissionClass.name)}</strong>
                    </div>
                    <span className="shift-tag">{shiftFor(admissionClass.name)}</span>
                    <span>{admissionClass.totalSeats}</span>
                    <span>{admissionClass.confirmedSeats}</span>
                    <span>{admissionClass.heldSeats}</span>
                    <span>{admissionClass.admissionFee > 0 ? formatCurrency(admissionClass.admissionFee) : "No fee"}</span>
                    <button className="view-pill" aria-label={`View admitted students in ${admissionClass.name}`} onClick={() => void openAdmitted(admissionClass)}>View <span aria-hidden="true">→</span></button>
                    <button className="delete-pill" aria-label={`Delete ${admissionClass.name}`} disabled={deletingClassId === admissionClass.id} onClick={() => void deleteClass(admissionClass)}>{deletingClassId === admissionClass.id ? "Deleting…" : "Delete"}</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <footer className="page-footer"><img src="/school-crest.svg" alt="" /> Banani Bidyaniketan School &amp; College <span>Admission 2026-2027</span></footer>
        </div>
      </main>
    </div>
  );
}

export default App;
