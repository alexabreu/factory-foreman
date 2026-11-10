import { expect, test } from '@playwright/test'

test('adds a book, marks it read and filters to unread', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-title').fill('Dune')
  await page.getByTestId('add').click()
  await page.getByTestId('new-title').fill('Emma')
  await page.getByTestId('add').click()
  await expect(page.getByTestId('summary')).toHaveText('2 of 2 unread')

  await page.getByTestId('item-toggle').first().check()
  await page.getByTestId('filter').selectOption('unread')
  await expect(page.getByTestId('item-title')).toHaveText([ 'Emma' ])
  await expect(page.getByTestId('summary')).toHaveText('1 of 2 unread')
})

test('keeps keyboard focus on a book after toggling it', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('new-title').fill('Dune')
  await page.getByTestId('add').click()

  const toggle = page.getByTestId('item-toggle')
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toBeChecked()
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Space')
  await expect(toggle).not.toBeChecked()

  await page.getByTestId('filter').selectOption('unread')
  await toggle.focus()
  await page.keyboard.press('Space')
  await expect(toggle).toHaveCount(0)
  await expect(page.getByTestId('filter')).toBeFocused()
})
