import { apiBaseUrl } from '../config';
import type { Todo } from '../types';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export class TodoApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TodoApiError';
  }
}

export async function fetchTodos(): Promise<Todo[]> {
  const response = await fetch(`${apiBaseUrl()}/api/todos`);
  if (!response.ok) {
    throw new TodoApiError(await parseError(response));
  }
  return (await response.json()) as Todo[];
}

export async function createTodo(title: string): Promise<Todo> {
  const response = await fetch(`${apiBaseUrl()}/api/todos`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    throw new TodoApiError(await parseError(response));
  }
  return (await response.json()) as Todo;
}

export async function updateTodoCompleted(id: string, completed: boolean): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/todos/${id}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ completed }),
  });
  if (!response.ok) {
    throw new TodoApiError(await parseError(response));
  }
}

export async function deleteTodo(id: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/todos/${id}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 204) {
    throw new TodoApiError(await parseError(response));
  }
}
