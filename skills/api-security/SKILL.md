# API security (Hero review)

- Validate and bound all request bodies; reject oversize payloads.
- Do not leak stack traces or internal paths in error responses.
- Use parameterized queries if a database is added; never concatenate SQL.
