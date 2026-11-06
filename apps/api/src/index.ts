import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(cors());
app.use(express.json());

type Todo = { id: string; title: string; completed: boolean; createdAt: string };
let todos: Todo[] = [
  { id: randomUUID(), title: 'Explore the autonomous SDLC starter', completed: false, createdAt: new Date().toISOString() },
  { id: randomUUID(), title: 'Connect GitHub and Figma MCP when ready', completed: false, createdAt: new Date().toISOString() }
];

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/todos', (_req, res) => res.json(todos));
app.post('/api/todos', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title) return res.status(400).json({ error: 'Title is required' });
  if (title.length > 160) return res.status(400).json({ error: 'Title must be 160 characters or fewer' });
  const todo: Todo = { id: randomUUID(), title, completed: false, createdAt: new Date().toISOString() };
  todos = [todo, ...todos];
  return res.status(201).json(todo);
});
app.patch('/api/todos/:id', (req, res) => {
  const todo = todos.find(item => item.id === req.params.id);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  if (typeof req.body?.completed === 'boolean') todo.completed = req.body.completed;
  if (typeof req.body?.title === 'string' && req.body.title.trim()) todo.title = req.body.title.trim().slice(0, 160);
  return res.json(todo);
});
app.delete('/api/todos/:id', (req, res) => {
  const before = todos.length;
  todos = todos.filter(item => item.id !== req.params.id);
  return before === todos.length ? res.status(404).json({ error: 'Todo not found' }) : res.status(204).end();
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`Todo API listening on :${port}`));
