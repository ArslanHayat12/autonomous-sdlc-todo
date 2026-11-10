import type { Todo, TodoFilter } from '../types';

export function filterTodos(todos: Todo[], filter: TodoFilter): Todo[] {
  if (filter === 'all') {
    return todos;
  }
  if (filter === 'active') {
    return todos.filter((todo) => !todo.completed);
  }
  return todos.filter((todo) => todo.completed);
}
