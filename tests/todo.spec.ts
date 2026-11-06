import { test, expect } from '@playwright/test';
test('user can add, complete, filter, and delete a task', async ({ page }) => {
  await page.goto('/');
  const task = `Write tests ${Date.now()}`;
  await page.getByRole('textbox', { name: 'New task' }).fill(task);
  await page.getByRole('button', { name: /Add task/ }).click();
  await expect(page.getByText(task)).toBeVisible();
  await page.getByRole('button', { name: 'Mark complete' }).last().click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(task)).toBeVisible();
  await page.getByRole('button', { name: `Delete ${task}` }).click();
  await expect(page.getByText(task)).toHaveCount(0);
});
