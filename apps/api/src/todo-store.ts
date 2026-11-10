import { randomUUID } from 'node:crypto';
import type { Todo } from './types.js';

function seedTodos(): Todo[] {
  return [
    {
      id: randomUUID(),
      title: 'Explore the autonomous SDLC starter',
      completed: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: randomUUID(),
      title: 'Connect GitHub and Figma MCP when ready',
      completed: false,
      createdAt: new Date().toISOString(),
    },
  ];
}

export class TodoStore {
  private items: Todo[];

  constructor(initial: Todo[] = seedTodos()) {
    this.items = [...initial];
  }

  list(): Todo[] {
    return [...this.items];
  }

  create(title: string): Todo {
    const todo: Todo = {
      id: randomUUID(),
      title,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    this.items = [todo, ...this.items];
    return todo;
  }

  update(
    id: string,
    patch: { completed?: boolean; title?: string },
  ): Todo | undefined {
    const todo = this.items.find(item => item.id === id);
    if (!todo) return undefined;
    if (typeof patch.completed === 'boolean') {
      todo.completed = patch.completed;
    }
    if (typeof patch.title === 'string' && patch.title.trim()) {
      todo.title = patch.title.trim().slice(0, 160);
    }
    return todo;
  }

  delete(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter(item => item.id !== id);
    return this.items.length < before;
  }
}
