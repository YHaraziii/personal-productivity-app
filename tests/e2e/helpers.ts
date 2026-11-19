import { expect, type Page } from '@playwright/test'

export const EMAIL = 'e2e-user@example.test'

export async function signIn(page: Page): Promise<void> {
  await page.goto('./')
  await page.getByLabel('E-mail').fill(EMAIL)
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('save-status')).toBeVisible()
}

export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-kind', 'saved', { timeout: 15_000 })
}

export async function createGroup(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: /New group|Create your first group/ }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New group' })
  await dialog.getByLabel(/^Name/).fill(name)
  await dialog.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('region', { name })).toBeVisible()
}

export interface TaskInput {
  title: string
  description?: string
  dueDate?: string
  dueTime?: string
  priority?: 'Low' | 'Medium' | 'High' | 'Urgent'
  repeat?: 'Daily' | 'Weekly' | 'Monthly'
  checklist?: string[]
  labels?: string[]
}

export async function createTask(page: Page, group: string, task: TaskInput): Promise<void> {
  await page.getByRole('button', { name: `Add task to ${group}` }).click()
  const dialog = page.getByRole('dialog', { name: `New task in ${group}` })
  await dialog.getByLabel(/^Title/).fill(task.title)
  if (task.description) {
    await dialog.getByRole('textbox', { name: 'Description' }).click()
    await page.keyboard.type(task.description)
  }
  if (task.dueDate) await dialog.getByLabel('Due date').fill(task.dueDate)
  if (task.dueTime) await dialog.getByLabel(/^Due time/).fill(task.dueTime)
  if (task.priority) await dialog.getByLabel('Priority').selectOption({ label: task.priority })
  for (const label of task.labels ?? []) await dialog.getByRole('checkbox', { name: label }).check()
  for (const [i, item] of (task.checklist ?? []).entries()) {
    await dialog.getByRole('button', { name: 'Add checklist item' }).click()
    await dialog.getByLabel(`Checklist item ${i + 1}`, { exact: true }).fill(item)
  }
  if (task.repeat) await dialog.getByLabel('Repeats').selectOption({ label: task.repeat })
  await dialog.getByRole('button', { name: 'Create task' }).click()
  await expect(dialog).toBeHidden()
}

/** YYYY-MM-DD for today + n days in the browser's time zone (America/New_York). */
export function localDate(offsetDays = 0): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
  now.setDate(now.getDate() + offsetDays)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function taskItem(page: Page, title: string) {
  return page.getByTestId('task').filter({ has: page.getByRole('button', { name: title, exact: true }) })
}

export function taskById(page: Page, id: string) {
  return page.locator(`[data-task-id="${id}"]`)
}
