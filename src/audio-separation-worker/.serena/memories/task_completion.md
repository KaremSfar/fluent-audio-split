# Task Completion Checklist

After completing a coding task in this project:

1. **Syntax check**: `python -m py_compile <file>` on modified files
2. **Import check**: `python -c "from app.<module> import *"` to verify imports resolve
3. **Type hints**: Ensure all new function signatures have type annotations
4. **Idempotency**: Verify handlers/tasks are safe to retry
5. **Storage paths**: Never use absolute paths from messages — always use `storage.get_absolute_path()`
6. **Logging**: Use `logging` module, never `print()`
7. **Message contracts**: If modifying message structure, ensure MassTransit envelope format is preserved
8. **Docker build**: `docker compose build audio-separation-worker` from repo root to verify image builds
9. **No automated tests**: No test framework configured yet — verify manually or via Docker
