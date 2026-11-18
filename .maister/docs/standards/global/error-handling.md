## Error Handling

### Clear User Messages
Show helpful, actionable messages without exposing internal details or security-sensitive information.

### Fail Fast
Validate inputs and check preconditions early; reject invalid data before it causes deeper issues.

### Typed Exceptions
Use specific exception types instead of generic ones to enable precise error handling.

### Centralized Handling
Catch and process errors at appropriate boundaries (controllers, API layers) rather than scattering try-catch throughout.

### Deadlocks and Serialization Failures Are Retryable Conflicts
In user-facing writes, map PostgreSQL SQLSTATE `40P01` (deadlock) and `40001` (serialization failure) to the shared 409: roll back and raise `StaleDataError`, which the handler in `app/core/errors.py` answers with "Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie". Keep `57014` (statement timeout) as 503 where a write sets a timeout; any other database error propagates.
In scheduled jobs and background loops, treat them like a lost race: roll back, log one WARNING and let the next run repeat the work. Log any other failure once with its traceback (`logger.exception` or `exc_info=`) and do not re-raise (a scheduler would log it again; a loop would stop).
Reference: `src/backend/app/wants/application/writes.py` (`TRANSACTION_CONFLICTS`, `_mapped_database_errors`), `src/matcher/matcher/db.py` (`LOST_RACE_SQLSTATES`, `is_lost_race`, `log_failure`).

### Graceful Degradation
When non-critical services fail, continue operating with reduced functionality rather than crashing entirely.

### Retry with Backoff
Use exponential backoff for transient failures when calling external services.

### Resource Cleanup
Always release resources (file handles, connections) in finally blocks or equivalent cleanup mechanisms.
