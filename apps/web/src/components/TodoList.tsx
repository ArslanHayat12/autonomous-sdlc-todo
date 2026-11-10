import type { Todo } from '../types';

type TodoListProps = {
  todos: Todo[];
  totalCount: number;
  onToggle: (todo: Todo) => void;
  onDelete: (id: string) => void;
};

export function TodoList({ todos, totalCount, onToggle, onDelete }: TodoListProps) {
  if (todos.length === 0) {
    const message = totalCount > 0 ? 'Nothing in this view.' : 'Your list is clear. Add your first task above.';
    return <div className="empty">{message}</div>;
  }

  return (
    <ul>
      {todos.map(todo => (
        <li key={todo.id} className={todo.completed ? 'completed' : ''}>
          <button
            type="button"
            className="check"
            aria-label={todo.completed ? 'Mark incomplete' : 'Mark complete'}
            onClick={() => onToggle(todo)}
          >
            {todo.completed ? '✓' : ''}
          </button>
          <span>{todo.title}</span>
          <button
            type="button"
            className="delete"
            aria-label={`Delete ${todo.title}`}
            onClick={() => onDelete(todo.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
