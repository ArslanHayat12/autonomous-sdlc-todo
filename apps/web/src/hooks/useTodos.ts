import { useCallback, useEffect, useState } from 'react';
import {
  createTodo,
  deleteTodo,
  fetchTodos,
  TodoApiError,
  updateTodoCompleted,
} from '../api/todos';
import type { Todo } from '../types';

const LOAD_ERROR = 'API unavailable. Start the app with Docker or npm run dev.';

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setTodos(await fetchTodos());
      setError('');
    } catch (e) {
      setError(e instanceof TodoApiError ? e.message : LOAD_ERROR);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addTodo = useCallback(
    async (title: string) => {
      setError('');
      try {
        await createTodo(title);
        await reload();
      } catch (e) {
        setError(e instanceof TodoApiError ? e.message : 'Could not add task');
      }
    },
    [reload],
  );

  const toggleTodo = useCallback(
    async (todo: Todo) => {
      setError('');
      try {
        await updateTodoCompleted(todo.id, !todo.completed);
        await reload();
      } catch (e) {
        setError(e instanceof TodoApiError ? e.message : 'Could not update task');
      }
    },
    [reload],
  );

  const removeTodo = useCallback(
    async (id: string) => {
      setError('');
      try {
        await deleteTodo(id);
        await reload();
      } catch (e) {
        setError(e instanceof TodoApiError ? e.message : 'Could not delete task');
      }
    },
    [reload],
  );

  return { todos, error, loading, addTodo, toggleTodo, removeTodo };
}
