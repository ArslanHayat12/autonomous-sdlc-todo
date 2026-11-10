import { API_BASE_URL } from '../config';
import type { Todo } from '../types';

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function listTodos(): Promise<Todo[]> {
  const response = await fetch(`${API_BASE_URL}/api/todos`);
  if (!response.ok) {
    throw new Error('Could not load tasks');
  }
  return (await response.json()) as Todo[];
}

export async function createTodo(
  title: string,
): Promise<{ ok: true; todo: Todo } | { ok: false; error: string }> {
  const response = await fetch(`${API_BASE_URL}/api/todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    return { ok: false, error: await errorMessage(response, 'Could not add task') };
  }
  return { ok: true, todo: (await response.json()) as Todo };
}

export async function updateTodoCompleted(todo: Todo, completed: boolean): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/todos/${todo.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed }),
  });
  if (!response.ok) {
    throw new Error('Could not update task');
  }
}

export async function removeTodo(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/todos/${id}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 204) {
    throw new Error('Could not delete task');
  }
}
