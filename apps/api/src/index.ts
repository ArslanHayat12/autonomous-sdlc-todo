import cors from 'cors';
import express from 'express';
import { TodoStore } from './todo-store.js';
import { parseTitle } from './validation.js';

const app = express();
const store = new TodoStore();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({ ok: true });
});

app.get('/api/todos', (_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(store.list());
});

app.post('/api/todos', (req, res) => {
  const parsed = parseTitle(req.body?.title);
  if (!parsed.ok) {
    res.status(400).setHeader('Content-Type', 'application/json');
    res.json({ error: parsed.error });
    return;
  }
  const todo = store.create(parsed.title);
  res.status(201).setHeader('Content-Type', 'application/json');
  res.json(todo);
});

app.patch('/api/todos/:id', (req, res) => {
  const todo = store.update(req.params.id, {
    completed: typeof req.body?.completed === 'boolean' ? req.body.completed : undefined,
    title: typeof req.body?.title === 'string' ? req.body.title : undefined,
  });
  if (!todo) {
    res.status(404).setHeader('Content-Type', 'application/json');
    res.json({ error: 'Todo not found' });
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.json(todo);
});

app.delete('/api/todos/:id', (req, res) => {
  if (!store.delete(req.params.id)) {
    res.status(404).setHeader('Content-Type', 'application/json');
    res.json({ error: 'Todo not found' });
    return;
  }
  res.status(204).end();
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Todo API listening on :${port}`);
});
