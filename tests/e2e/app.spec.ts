import { expect, test } from '@playwright/test'
import { EMAIL, createGroup, createTask, expectSaved, localDate, signIn, taskById, taskItem } from './helpers'

test.describe('authentication', () => {
  test('signed-out visitors only see the sign-in form; there is no sign-up or password reset', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: 'Personal Dashboard' })).toBeVisible()
    await expect(page.getByText(/sign up|register|create account|forgot/i)).toHaveCount(0)
    await expect(page.getByTestId('group-card')).toHaveCount(0)
  })

  test('rejects a wrong password with a generic message', async ({ page }) => {
    await page.goto('./')
    await page.getByLabel('E-mail').fill(EMAIL)
    await page.getByLabel('Password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toHaveText('The e-mail or password is incorrect.')
  })

  test('stays signed in across reloads and signs out on request', async ({ page }) => {
    await signIn(page)
    await page.reload()
    await expect(page.getByTestId('save-status')).toBeVisible()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })
})

test('first login shows an empty dashboard with a way to create the first group', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('heading', { name: 'Your dashboard is empty' })).toBeVisible()
  await expect(page.getByTestId('group-card')).toHaveCount(0)
  await expect(page.getByTestId('task')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Create your first group' })).toBeVisible()
  await expectSaved(page)
})

test('creates groups and tasks, completes and reopens, and everything persists', async ({ page }) => {
  await signIn(page)
  await createGroup(page, 'School')
  await createTask(page, 'School', {
    title: 'Write essay',
    description: 'Outline first',
    dueDate: localDate(0),
    dueTime: '23:59',
    priority: 'Urgent',
    labels: ['Important'],
    checklist: ['Research', 'Draft'],
  })
  const task = taskItem(page, 'Write essay')
  await expect(task).toContainText('Urgent')
  await expect(task).toContainText('Important')
  await expect(task).toContainText('0/2')
  await expect(task).toContainText('Due today')
  await expect(page.getByTestId('widget-today')).toContainText('1')
  await expectSaved(page)

  // Checking every checklist item does not complete the task.
  await task.getByRole('button', { name: 'Show details' }).click()
  await task.getByRole('checkbox', { name: 'Research' }).check()
  await task.getByRole('checkbox', { name: 'Draft' }).check()
  await expect(task).toContainText('2/2')
  await expect(task.getByRole('checkbox', { name: 'Complete Write essay' })).not.toBeChecked()

  await task.getByRole('checkbox', { name: 'Complete Write essay' }).check()
  await expect(task).toContainText('Completed')
  await expect(task.getByRole('button', { name: 'Write essay', exact: true })).toHaveCSS('text-decoration-line', 'line-through')
  await expect(page.getByTestId('widget-today')).toContainText('0')
  await expectSaved(page)

  await page.reload()
  await expect(taskItem(page, 'Write essay')).toContainText('Completed')
  await taskItem(page, 'Write essay').getByRole('checkbox', { name: 'Reopen Write essay' }).uncheck()
  await expect(taskItem(page, 'Write essay')).not.toContainText('Completed')
  await expectSaved(page)
})

test('validates the task form and keeps the input', async ({ page }) => {
  await signIn(page)
  await createGroup(page, 'Research')
  await page.getByRole('button', { name: 'Add task to Research' }).click()
  const dialog = page.getByRole('dialog', { name: 'New task in Research' })
  await dialog.getByLabel('Repeats').selectOption({ label: 'Weekly' })
  await dialog.getByRole('button', { name: 'Create task' }).click()
  await expect(dialog.getByText('Enter a title for the task.')).toBeVisible()
  await expect(dialog.getByText('A repeating task needs a due date for its first occurrence.')).toBeVisible()
  await dialog.getByLabel(/^Title/).fill('Lab meeting')
  await dialog.getByLabel('Due date').fill(localDate(1))
  await dialog.getByRole('button', { name: 'Create task' }).click()
  await expect(taskItem(page, 'Lab meeting')).toContainText('Every week on')
})

test('completing a recurring task creates exactly one next occurrence', async ({ page }) => {
  await signIn(page)
  await createGroup(page, 'Podcast')
  await createTask(page, 'Podcast', { title: 'Publish episode', dueDate: localDate(-3), repeat: 'Daily' })
  await expect(taskItem(page, 'Publish episode')).toContainText('Overdue')
  await taskItem(page, 'Publish episode').getByRole('checkbox', { name: 'Complete Publish episode' }).check()
  await expect(taskItem(page, 'Publish episode')).toHaveCount(2)
  // Missed days are skipped: the next one is tomorrow, not an overdue backlog.
  await expect(page.getByTestId('widget-overdue')).toContainText('0')
  await expect(page.getByTestId('widget-upcoming')).toContainText('1')
  // Reopening and completing again does not create another occurrence.
  const doneId = await taskItem(page, 'Publish episode').filter({ hasText: 'Completed' }).getAttribute('data-task-id')
  await taskById(page, doneId!).getByRole('checkbox').uncheck()
  await expect(taskById(page, doneId!)).not.toContainText('Completed')
  await taskById(page, doneId!).getByRole('checkbox').check()
  await expect(taskById(page, doneId!)).toContainText('Completed')
  await expect(taskItem(page, 'Publish episode')).toHaveCount(2)
  await expectSaved(page)
})

test('search, filters and widgets work together and reset on a new visit', async ({ page }) => {
  await signIn(page)
  await createGroup(page, 'School')
  await createGroup(page, 'Home')
  await createTask(page, 'School', { title: 'Overdue essay', dueDate: localDate(-2), priority: 'High' })
  await createTask(page, 'School', { title: 'Read chapter', dueDate: localDate(3), checklist: ['photosynthesis notes'] })
  await createTask(page, 'Home', { title: 'Buy groceries', dueDate: localDate(0), priority: 'Low' })

  await expect(page.getByTestId('widget-overdue')).toContainText('1')
  await page.getByTestId('widget-overdue').locator('.widget-main').click()
  await expect(page.getByTestId('task')).toHaveCount(1)
  await expect(taskItem(page, 'Overdue essay')).toBeVisible()
  await page.getByRole('button', { name: 'Reset filters' }).click()
  await expect(page.getByTestId('task')).toHaveCount(3)

  // Search covers checklist text.
  await page.getByLabel('Search tasks').fill('photosynthesis')
  await expect(page.getByTestId('task')).toHaveCount(1)
  await expect(taskItem(page, 'Read chapter')).toBeVisible()
  await page.getByLabel('Search tasks').fill('')

  // Combined filters: priority Low AND group Home.
  await page.getByRole('button', { name: 'Priority' }).click()
  await page.getByRole('group', { name: 'Priority' }).getByLabel('Low').check()
  await expect(page.getByTestId('task')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.getByLabel('Due date filter').selectOption('overdue')
  await expect(page.getByText('No tasks match')).toBeVisible()

  await page.reload()
  await expect(page.getByTestId('task')).toHaveCount(3)
  await expect(page.getByLabel('Search tasks')).toHaveValue('')
})

test('offline edits are kept locally, survive a reload, and sync when back online', async ({ page, context }) => {
  await signIn(page)
  await createGroup(page, 'Work')
  await expectSaved(page)
  await context.setOffline(true)
  await createTask(page, 'Work', { title: 'Written offline' })
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-kind', 'offline')
  await expect(page.getByTestId('save-status')).toContainText('pending sync')
  await expect(taskItem(page, 'Written offline')).toContainText('Not synced yet')

  await page.reload()
  await expect(taskItem(page, 'Written offline')).toBeVisible()
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-kind', 'offline')

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expectSaved(page)
  await expect(taskItem(page, 'Written offline')).not.toContainText('Not synced yet')
})

test('a failed sync is reported and nothing is lost', async ({ page }) => {
  await signIn(page)
  await createGroup(page, 'Work')
  await expectSaved(page)
  await page.evaluate(() => ((window as unknown as { __e2eFailRequests: boolean }).__e2eFailRequests = true))
  await createTask(page, 'Work', { title: 'Survives outage' })
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-kind', 'failed')
  await expect(page.getByTestId('save-status')).not.toContainText('Saved')
  await page.evaluate(() => ((window as unknown as { __e2eFailRequests: boolean }).__e2eFailRequests = false))
  await page.getByTestId('save-status').getByRole('button', { name: 'Retry' }).click()
  await expectSaved(page)
  await page.reload()
  await expect(taskItem(page, 'Survives outage')).toBeVisible()
})

test('deleting a group requires explicit confirmation', async ({ page }) => {
  await signIn(page)
  await createGroup(page, 'Temporary')
  await createTask(page, 'Temporary', { title: 'Doomed task' })
  await page.getByRole('button', { name: 'Temporary options' }).click()
  await page.getByRole('menuitem', { name: 'Delete group…' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('This also deletes all 1 task in this group')
  const confirm = dialog.getByRole('button', { name: 'Delete group and its tasks' })
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('region', { name: 'Temporary' })).toBeVisible()

  await page.getByRole('button', { name: 'Temporary options' }).click()
  await page.getByRole('menuitem', { name: 'Delete group…' }).click()
  await page.getByRole('alertdialog').getByRole('checkbox').check()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete group and its tasks' }).click()
  await expect(page.getByRole('heading', { name: 'Your dashboard is empty' })).toBeVisible()
  await expectSaved(page)
})

test('group order, collapse state, sort preference and theme persist across reloads', async ({ page }) => {
  await signIn(page)
  await createGroup(page, 'Alpha')
  await createGroup(page, 'Beta')
  await createTask(page, 'Alpha', { title: 'Zebra' })
  await createTask(page, 'Alpha', { title: 'Apple' })

  await page.getByRole('button', { name: 'Beta options' }).click()
  await page.getByRole('menuitem', { name: 'Move up' }).click()
  await expect(page.getByTestId('group-card').first()).toHaveAttribute('aria-label', 'Beta')

  await page.getByLabel('Sort tasks in Alpha').selectOption({ label: 'Title' })
  await expect(page.getByRole('region', { name: 'Alpha' }).getByTestId('task').first()).toContainText('Apple')
  await page.getByRole('region', { name: 'Beta' }).locator('.group-toggle').click()
  await expect(page.getByRole('region', { name: 'Beta' }).locator('.group-toggle')).toHaveAttribute('aria-expanded', 'false')

  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('dialog', { name: 'Settings' }).getByText('Dark', { exact: true }).click()
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close dialog' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expectSaved(page)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByTestId('group-card').first()).toHaveAttribute('aria-label', 'Beta')
  await expect(page.getByRole('region', { name: 'Beta' }).locator('.group-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Sort tasks in Alpha')).toHaveValue('title')
  await expect(page.getByRole('region', { name: 'Alpha' }).getByTestId('task').first()).toContainText('Apple')

  // Manual order is restored after switching back from automatic sorting.
  await page.getByLabel('Sort tasks in Alpha').selectOption({ label: 'Manual order' })
  await expect(page.getByRole('region', { name: 'Alpha' }).getByTestId('task').first()).toContainText('Zebra')
})

test('exports JSON and CSV containing all tasks', async ({ page }) => {
  await signIn(page)
  await createGroup(page, 'One')
  await createGroup(page, 'Two')
  await createTask(page, 'One', { title: '=SUM(A1)' })
  await createTask(page, 'Two', { title: 'Second, with "quotes"' })
  await page.getByLabel('Search tasks').fill('nothing matches this')
  await page.getByRole('button', { name: 'Backup & export' }).click()
  const dialog = page.getByRole('dialog', { name: 'Backup, export and import' })

  const [csvDownload] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download CSV' }).click()])
  const csv = await (await csvDownload.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'))
  expect(csv).toContain(`"'=SUM(A1)","One"`)
  expect(csv).toContain(`"Second, with ""quotes""","Two"`)

  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download backup' }).click()])
  const json = JSON.parse(await (await jsonDownload.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')))
  expect(json.format).toBe('ppd-backup')
  expect(json.data.tasks).toHaveLength(2)
  expect(JSON.stringify(json)).not.toContain(EMAIL)
})
