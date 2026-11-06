import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

 type Todo = { id: string; title: string; completed: boolean; createdAt: string };
const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function App() {
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [title, setTitle] = React.useState('');
  const [filter, setFilter] = React.useState<'all' | 'active' | 'done'>('all');
  const [error, setError] = React.useState('');
  const load = React.useCallback(async () => {
    try { const response = await fetch(`${API}/api/todos`); if (!response.ok) throw new Error('Could not load tasks'); setTodos(await response.json()); }
    catch { setError('API unavailable. Start the app with Docker or npm run dev.'); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);
  async function addTodo(event: React.FormEvent) {
    event.preventDefault(); setError('');
    const response = await fetch(`${API}/api/todos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    if (!response.ok) { setError((await response.json()).error ?? 'Could not add task'); return; }
    setTitle(''); await load();
  }
  async function toggle(todo: Todo) { await fetch(`${API}/api/todos/${todo.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: !todo.completed }) }); await load(); }
  async function remove(id: string) { await fetch(`${API}/api/todos/${id}`, { method: 'DELETE' }); await load(); }
  const visible = todos.filter(todo => filter === 'all' || (filter === 'active' ? !todo.completed : todo.completed));
  const completed = todos.filter(todo => todo.completed).length;
  return <main className="shell"><header><div className="eyebrow">YOUR PERSONAL WORKSPACE</div><h1>Make room for <span>focus.</span></h1><p className="sub">A simple list. A clearer mind. One task at a time.</p></header>
    <section className="panel"><form onSubmit={addTodo}><input aria-label="New task" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to get done?" maxLength={160}/><button disabled={!title.trim()}>Add task <b>＋</b></button></form>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="toolbar"><div><strong>{todos.length - completed}</strong> left <span className="muted">· {completed} completed</span></div><nav aria-label="Filter tasks">{(['all','active','done'] as const).map(item => <button key={item} className={filter === item ? 'selected' : 'filter'} onClick={() => setFilter(item)}>{item === 'done' ? 'Done' : item[0].toUpperCase() + item.slice(1)}</button>)}</nav></div>
    <ul>{visible.map(todo => <li key={todo.id} className={todo.completed ? 'completed' : ''}><button className="check" aria-label={todo.completed ? 'Mark incomplete' : 'Mark complete'} onClick={() => void toggle(todo)}>{todo.completed ? '✓' : ''}</button><span>{todo.title}</span><button className="delete" aria-label={`Delete ${todo.title}`} onClick={() => void remove(todo.id)}>×</button></li>)}</ul>
    {visible.length === 0 && <div className="empty">{todos.length ? 'Nothing in this view.' : 'Your list is clear. Add your first task above.'}</div>}
    </section><footer><span>FOCUS TODO</span><span>Small steps add up.</span></footer></main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
