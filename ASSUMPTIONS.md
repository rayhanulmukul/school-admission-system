# Assumptions

- Each school class and shift is represented as one class record; for example, “Class 6 - Morning Shift” and “Class 6 - Day Shift” are separate records.
- `X-Student-Id` is the identity mechanism for this assignment. Authentication accounts and a login flow are outside the API contract.
- A registration number may have at most one active application across all classes. An application is active while it is `HELD` (and not expired) or `CONFIRMED`. Expired and cancelled holds remain in the history and do not block a new application or reserve capacity.
- Admission status is checked by birth registration number on the “Check Admission” page. The API returns the holds for any registration number, so this is a demo-level privacy trade-off.
- A seat is occupied while its hold is active or confirmed. Holds expire after `HOLD_DURATION_SECONDS` (600 seconds by default); expiration is materialized when the hold is read or a relevant student/class is accessed.
- The admin sets an admission fee for each class. The frontend demo checkout uses that fee to show the amount and confirm a seat, but no real payment is collected because no payment provider is configured.
- The frontend separates the student admission portal from the school-admin class-management portal. The assignment API contract does not define authentication or admin roles, so admin authorization is not represented by the UI separation.
- `EnsureCreated` initializes a new PostgreSQL database at startup. Startup also idempotently adds the admission-fee column to databases created by earlier project versions. Schema evolution for a deployed system should use EF Core migrations.
- The local Compose database credentials are for development only and must be replaced with secrets before deployment.
