import React from 'react';
import { createTodo, listTodos, removeTodo, updateTodoCompleted } from './api/todos';
import { filterTodos } from './lib/filter-todos';
import type { Todo, TodoFilter } from './types';

const FILTERS: readonly TodoFilter[] = ['all', 'active', 'done'];

function filterLabel(filter: TodoFilter): string {
  if (filter === 'done') {
    return 'Done';
  }
  return filter[0].toUpperCase() + filter.slice(1);
}

export function App() {
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [title, setTitle] = React.useState('');
  const [filter, setFilter] = React.useState<TodoFilter>('all');
  const [error, setError] = React.useState('');

  const loadTodos = React.useCallback(async () => {
    try {
      setTodos(await listTodos());
      setError('');
    } catch {
      setError('API unavailable. Start the app with Docker or npm run dev.');
    }
  }, []);

  React.useEffect(() => {
    void loadTodos();
  }, [loadTodos]);

  async function handleAddTodo(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const result = await createTodo(title);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle('');
    await loadTodos();
  }

  async function handleToggle(todo: Todo) {
    await updateTodoCompleted(todo, !todo.completed);
    await loadTodos();
  }

  async function handleRemove(id: string) {
    await removeTodo(id);
    await loadTodos();
  }

  const visible = filterTodos(todos, filter);
  const completedCount = todos.filter((todo) => todo.completed).length;
  const activeCount = todos.length - completedCount;

  return (
    <main className="shell">
      <header>
        <div className="eyebrow">YOUR PERSONAL WORKSPACE</div>
        <h1>
          Make room for <span>focus.</span>
        </h1>
        <p className="sub">A simple list. A clearer mind. One task at a time.</p>
      </header>

      <section className="panel">
        <form onSubmit={handleAddTodo}>
          <input
            aria-label="New task"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs to get done?"
            maxLength={160}
          />
          <button type="submit" disabled={!title.trim()}>
            Add task <b>＋</b>
          </button>
        </form>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="toolbar">
          <div>
            <strong>{activeCount}</strong> left{' '}
            <span className="muted">
              · {completedCount} completed
            </span>
          </div>
          <nav aria-label="Filter tasks">
            {FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? 'selected' : 'filter'}
                onClick={() => setFilter(item)}
              >
                {filterLabel(item)}
              </button>
            ))}
          </nav>
        </div>

        <ul>
          {visible.map((todo) => (
            <li key={todo.id} className={todo.completed ? 'completed' : ''}>
              <button
                type="button"
                className="check"
                aria-label={todo.completed ? 'Mark incomplete' : 'Mark complete'}
                onClick={() => void handleToggle(todo)}
              >
                {todo.completed ? '✓' : ''}
              </button>
              <span>{todo.title}</span>
              <button
                type="button"
                className="delete"
                aria-label={`Delete ${todo.title}`}
                onClick={() => void handleRemove(todo.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        {visible.length === 0 ? (
          <div className="empty">
            {todos.length
              ? 'Nothing in this view.'
              : 'Your list is clear. Add your first task above.'}
          </div>
        ) : null}
      </section>

      <footer>
        <span>FOCUS TODO</span>
        <span>Small steps add up.</span>
      </footer>
    </main>
  );
}
