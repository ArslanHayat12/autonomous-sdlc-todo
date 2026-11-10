import type { TodoFilter } from '../types';

const FILTERS: readonly TodoFilter[] = ['all', 'active', 'done'];

function filterLabel(item: TodoFilter): string {
  if (item === 'done') return 'Done';
  return item[0].toUpperCase() + item.slice(1);
}

type TodoToolbarProps = {
  activeCount: number;
  completedCount: number;
  filter: TodoFilter;
  onFilterChange: (filter: TodoFilter) => void;
};

export function TodoToolbar({ activeCount, completedCount, filter, onFilterChange }: TodoToolbarProps) {
  return (
    <div className="toolbar">
      <div>
        <strong>{activeCount}</strong> left{' '}
        <span className="muted">
          · {completedCount} completed
        </span>
      </div>
      <nav aria-label="Filter tasks">
        {FILTERS.map(item => (
          <button
            key={item}
            type="button"
            className={filter === item ? 'selected' : 'filter'}
            onClick={() => onFilterChange(item)}
          >
            {filterLabel(item)}
          </button>
        ))}
      </nav>
    </div>
  );
}
