import { type FormEvent, useState } from 'react';
import { TITLE_MAX_LENGTH } from '../config';

type TodoFormProps = {
  onSubmit: (title: string) => Promise<void>;
  disabled?: boolean;
};

export function TodoForm({ onSubmit, disabled = false }: TodoFormProps) {
  const [title, setTitle] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    await onSubmit(trimmed);
    setTitle('');
  }

  return (
    <form onSubmit={e => void handleSubmit(e)}>
      <input
        aria-label="New task"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="What needs to get done?"
        maxLength={TITLE_MAX_LENGTH}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !title.trim()}>
        Add task <b>＋</b>
      </button>
    </form>
  );
}
