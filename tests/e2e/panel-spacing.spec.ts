import { expect, test } from '@playwright/test'
import { mockWorkspace, org } from './fixtures/workspace'

test('panel headings, actions, and counts stay inset across workspace pages', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await mockWorkspace(page)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const paths = ['neighborhoods/community-1', 'sync', 'work/work-1', 'reports', 'account', 'admin']
  for (const width of testInfo.project.name.startsWith('mobile') ? [390] : [1440, 768]) {
    await page.setViewportSize({ width, height: 960 })
    for (const path of paths) {
      await page.goto(`/org/${org}/${path}`)
      await expect(page.locator('.loading-state')).toHaveCount(0)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      if (path === 'admin' && await page.getByRole('button', { name: 'Activity & policies', exact: true }).count()) {
        await page.getByRole('button', { name: 'Activity & policies', exact: true }).click()
      }
      const headings = page.locator('.panel > .section-heading')
      expect(await headings.count(), `${path} must include a panel heading`).toBeGreaterThan(0)
      const cramped = await headings.evaluateAll((elements) => elements.flatMap((element) => {
        const panel = element.parentElement!.getBoundingClientRect()
        return Array.from(element.children).flatMap((child) => {
          const rect = child.getBoundingClientRect()
          if (!rect.width || !rect.height) return []
          return rect.left - panel.left < 12 || panel.right - rect.right < 12 || rect.top - panel.top < 10
            ? [child.textContent?.trim()]
            : []
        })
      }))
      expect(cramped, `Cramped headings on ${path} at ${width}px`).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (path.startsWith('neighborhoods/')) {
        const count = page.locator('.home-row > span:nth-child(4)').first()
        if (await count.isVisible()) {
          const gap = await count.evaluate((element) => {
            const number = element.querySelector('strong')!.getBoundingClientRect()
            const label = element.querySelector('small')!.getBoundingClientRect()
            return label.left - number.right
          })
          expect(gap).toBeGreaterThanOrEqual(4)
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`${width}-${path.replaceAll('/', '-')}.png`), fullPage: true })
    }
  }
  expect(errors).toEqual([])
})
