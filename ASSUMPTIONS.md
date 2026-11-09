# Assumptions

- Each school class and shift is represented as one class record; for example, “Class 6 - Morning Shift” and “Class 6 - Day Shift” are separate records.
- `X-Student-Id` is the identity mechanism for this assignment. Authentication accounts and a login flow are outside the API contract.
- A student may have at most one active hold or confirmed seat per class. Expired and cancelled holds remain in the history and do not reserve capacity.
- A seat is occupied while its hold is active or confirmed. Holds expire after `HOLD_DURATION_SECONDS` (600 seconds by default); expiration is materialized when the hold is read or a relevant student/class is accessed.
- Confirmed seats are not released by the hold-cancel endpoint. Payment processing is not implemented because no payment provider or payment contract is specified.
- The school-admin class creation view is available in this assignment demo without an admin login or role system.
- `EnsureCreated` initializes a new PostgreSQL database at startup. Schema evolution for a deployed system should use EF Core migrations.
- The local Compose database credentials are for development only and must be replaced with secrets before deployment.
