export type AdmissionClass = {
  id: string;
  name: string;
  totalSeats: number;
  admissionFee: number;
  heldSeats: number;
  confirmedSeats: number;
  availableSeats: number;
};

export type StudentHold = {
  holdId: string;
  classId: string;
  className: string;
  admissionFee: number;
  status: "HELD" | "CONFIRMED" | "EXPIRED" | "CANCELLED";
  expiresAt: string;
};

export type SeatHold = {
  holdId: string;
  classId: string;
  studentId: string;
  status: StudentHold["status"];
  expiresAt: string;
};

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:8080")
  .replace(/\/$/, "");

async function request<T>(
  path: string,
  options: RequestInit = {},
  studentId?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (studentId) {
    headers.set("X-Student-Id", studentId);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers });
  if (!response.ok) {
    const problem = await response.json().catch(() => null) as
      | { detail?: string; title?: string }
      | null;
    throw new Error(problem?.detail ?? problem?.title ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  getClasses: () => request<AdmissionClass[]>("/classes"),
  createClass: (name: string, totalSeats: number, admissionFee: number) =>
    request<AdmissionClass>("/classes", {
      method: "POST",
      body: JSON.stringify({ name, totalSeats, admissionFee }),
    }),
  getHolds: (studentId: string) =>
    request<StudentHold[]>("/me/holds", {}, studentId),
  holdSeat: (classId: string, studentId: string) =>
    request<SeatHold>("/classes/" + encodeURIComponent(classId) + "/holds", {
      method: "POST",
    }, studentId),
  confirmHold: (holdId: string, studentId: string) =>
    request("/holds/" + encodeURIComponent(holdId) + "/confirm", {
      method: "POST",
    }, studentId),
  cancelHold: (holdId: string, studentId: string) =>
    request<void>("/holds/" + encodeURIComponent(holdId), {
      method: "DELETE",
    }, studentId),
};
