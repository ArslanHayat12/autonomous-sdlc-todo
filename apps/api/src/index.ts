import cors from 'cors';
import express from 'express';
import { TodoStore } from './todo-store.js';
import { routeParam } from './route-params.js';
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
  const { title } = parsed;
  const todo = store.create(title);
  res.status(201).json(todo);
});

app.patch('/api/todos/:id', (req, res) => {
  const id = routeParam(req, 'id');
  if (!id) {
    res.status(400).json({ error: 'Invalid todo id' });
    return;
  }

  // Validate and parse title only when provided
  let title: string | undefined;
  if (typeof req.body?.title === 'string') {
    const parsed = parseTitle(req.body.title);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    title = parsed.title;
  }

  const todo = store.update(id, {
    completed: typeof req.body?.completed === 'boolean' ? req.body.completed : undefined,
    title,
  });
  if (!todo) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.json(todo);
});

app.delete('/api/todos/:id', (req, res) => {
  const id = routeParam(req, 'id');
  if (!id) {
    res.status(400).json({ error: 'Invalid todo id' });
    return;
  }
  if (!store.delete(id)) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.status(204).end();
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`Todo API listening on :${port}`);
});
