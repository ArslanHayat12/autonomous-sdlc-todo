import cors from 'cors';
import express from 'express';
import { TodoStore } from './todo-store.js';
import { parseTitle } from './validation.js';

const app = express();
const store = new TodoStore();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/todos', (_req, res) => {
  res.json(store.list());
});

app.post('/api/todos', (req, res) => {
  const parsed = parseTitle(req.body?.title);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const todo = store.create(parsed.title);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', (req, res) => {
  const todo = store.update(req.params.id, {
    completed: typeof req.body?.completed === 'boolean' ? req.body.completed : undefined,
    title: typeof req.body?.title === 'string' ? req.body.title : undefined,
  });
  if (!todo) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.json(todo);
});

app.delete('/api/todos/:id', (req, res) => {
  if (!store.delete(req.params.id)) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.status(204).end();
});

// Respond with 405 Method Not Allowed for unsupported methods on /api/todos
app.all('/api/todos', (req, res) => {
  res.status(405).json({ error: 'Method Not Allowed' });
});

// Respond with 405 Method Not Allowed for unsupported methods on /api/todos/:id
app.all('/api/todos/:id', (req, res) => {
  res.status(405).json({ error: 'Method Not Allowed' });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Todo API listening on :${port}`);
});
