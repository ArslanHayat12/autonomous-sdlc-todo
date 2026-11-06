# React accessibility (Hero review)

- Interactive elements must be `<button>`, `<a>`, or have `role` + keyboard handlers.
- Form inputs need `aria-label` or associated `<label>`.
- Error messages must use `role="alert"` or `aria-live` when injected dynamically.
