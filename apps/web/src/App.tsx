import { useState } from 'react';
import { AppFooter } from './components/AppFooter';
import { AppHeader } from './components/AppHeader';
import { TodoForm } from './components/TodoForm';
import { TodoList } from './components/TodoList';
import { TodoToolbar } from './components/TodoToolbar';
import { useTodos } from './hooks/useTodos';
import { countActive, countCompleted, filterTodos } from './lib/filter-todos';
import type { TodoFilter } from './types';

export function App() {
  const [filter, setFilter] = useState<TodoFilter>('all');
  const { todos, error, loading, addTodo, toggleTodo, removeTodo } = useTodos();

  const visible = filterTodos(todos, filter);
console.log(visible);
  return (
    <main className="shell">
      <AppHeader />
      <section className="panel">
        <TodoForm onSubmit={addTodo} disabled={loading} />
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <TodoToolbar
          activeCount={countActive(todos)}
          completedCount={countCompleted(todos)}
          filter={filter}
          onFilterChange={setFilter}
        />
        <TodoList
          todos={visible}
          totalCount={todos.length}
          onToggle={todo => void toggleTodo(todo)}
          onDelete={id => void removeTodo(id)}
        />
      </section>
      <AppFooter />
    </main>
  );
}
