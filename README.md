# School Admission System

A school admission portal for managing class capacity and reserving seats. The API is built with ASP.NET Core and PostgreSQL; the responsive React UI supports class administration and student seat holds.

## Run with Docker

From the repository root, run:

```sh
docker compose up --build
```

- Admission UI: <http://localhost:8081>
- API: <http://localhost:8080>
- API contract: <http://localhost:8080/openapi/v1.json>

The PostgreSQL data is kept in the `postgres_data` Docker volume. To stop the services, use `docker compose down`. To also clear the local database, explicitly remove the volume with `docker compose down -v`.

## Run locally

Start PostgreSQL with `docker compose up db`, then run the backend from `backend/SchoolAdmission.Api`:

```sh
dotnet run --urls http://localhost:8080
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open <http://localhost:5173>. The API uses the local development connection string in `appsettings.Development.json`; override `ConnectionStrings__DefaultConnection` for another database. Set `HOLD_DURATION_SECONDS` to change the default 600-second seat hold.

## API

All request and response bodies use JSON. Student actions identify the student with the `X-Student-Id` header.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/classes` | Create a class (`name`, `totalSeats`) |
| `GET` | `/classes` | List classes with held, confirmed, and available seat counts |
| `GET` | `/classes/{classId}` | Get a class and its current seat counts |
| `POST` | `/classes/{classId}/holds` | Hold an available seat for the requesting student |
| `GET` | `/holds/{holdId}` | Get a hold and its current status |
| `POST` | `/holds/{holdId}/confirm` | Confirm a hold belonging to the requesting student |
| `DELETE` | `/holds/{holdId}` | Cancel a hold belonging to the requesting student |
| `GET` | `/me/holds` | List the requesting student’s holds |
| `GET` | `/health` | Check API availability |

Seat holds expire after the configured duration. The API returns `409 Conflict` if a class is full, a student already has an active application for that class, or a hold cannot transition to the requested status. Hold states are `HELD`, `CONFIRMED`, `EXPIRED`, and `CANCELLED`.

The UI keeps student admission separate from school administration. Students browse classes, reserve seats, and manage their applications from the student portal. School staff use the admin portal to create classes and review capacity. The assignment does not define an authentication API, so the admin portal is a separate workflow, not an access-control boundary.

## Checks

Start the local PostgreSQL service, then run the backend API integration and concurrency tests:

```sh
docker compose up -d db
dotnet test backend/SchoolAdmission.Api.Tests/SchoolAdmission.Api.Tests.csproj
```

The tests create and remove a temporary PostgreSQL database for each test run, so use a local/test PostgreSQL instance and a user allowed to create databases. To use a different instance, set `ADMISSION_TEST_CONNECTION` before running the tests:

```powershell
$env:ADMISSION_TEST_CONNECTION = "Host=localhost;Port=5432;Database=school_admission;Username=postgres;Password=your-local-password"
dotnet test backend/SchoolAdmission.Api.Tests/SchoolAdmission.Api.Tests.csproj
```

In Git Bash, set the same variable with `export ADMISSION_TEST_CONNECTION="Host=localhost;Port=5432;Database=school_admission;Username=postgres;Password=your-local-password"`.

Build the API and frontend:

```sh
dotnet build backend/SchoolAdmission.Api/SchoolAdmission.Api.csproj
cd frontend
npm ci
npm run build
```

See [ASSUMPTIONS.md](./ASSUMPTIONS.md) for implementation choices and [AI_USAGE.md](./AI_USAGE.md) for AI assistance disclosure.
