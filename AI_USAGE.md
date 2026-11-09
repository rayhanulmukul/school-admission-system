# AI usage

AI assistance was used to implement the project from the supplied assignment and user-provided school-portal visual reference: building the ASP.NET Core API and React interface, adding persistence and seat-hold workflows, configuring Docker Compose, writing PostgreSQL-backed API and concurrency tests, and drafting project documentation.

The API tests cover class creation and availability, admission fees, seat hold and confirmation, duplicate/full-seat conflicts, ownership, cancellation, expiration, and concurrent requests. The implementation was locally validated with the test and build commands in the README. Authentication, real payment processing, and production deployment configuration remain outside the assignment API contract.

## Tools used

- GitHub Copilot (AI coding assistant in VS Code and the Copilot CLI) for code generation, refactoring, debugging, and documentation drafts.
- Browser automation in VS Code, used to check the running UI at `http://localhost:8081` after each frontend change.

## Where the AI made mistakes

- **Invalid class input returned HTTP 500.** The first class-creation endpoint did not validate blank names or invalid seat counts. The integration tests exposed it, and the endpoint now returns `400` with a problem response.
- **Broken build from a stray `</div>`.** A JSX edit left an extra closing tag, so `tsc --noEmit` failed. It was caught by the build step and fixed.
- **Broken CSS from a duplicated fragment.** A `.hold-card` edit left a duplicated fragment that produced an invalid selector. The Vite build caught it and it was fixed.
- **Misread business rule in the AI's own spec summary.** The first summary described the registration-number rule as "one active application per class". The owner confirmed the intended rule is one active application per registration number across all classes, which is what the API enforces. The docs now state this explicitly.
- **Stale browser snapshots.** Screenshots and page snapshots sometimes showed old state, and screenshots of off-screen elements were incorrect. These were re-checked in a fresh tab before accepting a UI change.

## How the output was verified

- Backend: `dotnet test` runs 13 PostgreSQL-backed integration and concurrency tests. These include expiry, ownership, duplicate-application, full-seat, and concurrent-hold cases.
- Frontend: `npm run build` runs `tsc --noEmit` and the Vite production build for frontend changes.
- Runtime: the API and UI were rebuilt with `docker compose up -d --build` and both endpoints responded (`/health` and the UI).
- Human review: the owner tested the flows in the browser and reported layout and behaviour issues, which were then fixed in small commits.
