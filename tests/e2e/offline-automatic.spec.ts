import { expect, test } from '@playwright/test'
import { mockWorkspace, org, userId } from './fixtures/workspace'

test('saves an opened home and sends queued changes on reconnect outside Sync center', async ({ page }) => {
  await mockWorkspace(page, { tables: { inspection_list: [], attachments: [], comments: [], work_events: [] } })
  let sends = 0
  await page.route('**/functions/v1/command', async (route) => {
    sends += 1
    await route.fulfill({ json: { ok: true, data: { id: 'work-1', version: 3 } } })
  })
  await page.goto(`/org/${org}/homes/home-1`)
  await expect(page.getByText('Saved on this device for up to 24 hours.')).toBeVisible({ timeout: 30000 })
  await page.evaluate(async ({ userId, org }) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('buildtrack-offline-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('operations', 'readwrite')
      transaction.objectStore('operations').put({ id: 'automatic-test', user_id: userId, organization_id: org, aggregate_id: 'work-1', command_name: 'add_comment', request_hash: 'test', envelope: { operation_id: 'automatic-test', payload: {} }, state: 'queued', dependencies: [], retries: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  }, { userId, org })
  expect(sends).toBe(0)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect.poll(() => sends, { timeout: 30000 }).toBe(1)
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('buildtrack-offline-v1'); request.onsuccess = () => resolve(request.result) })
    return await new Promise<string>((resolve) => { const request = db.transaction('operations').objectStore('operations').get('automatic-test'); request.onsuccess = () => { resolve(request.result?.state); db.close() } })
  }), { timeout: 30000 }).toBe('synced')
  expect(page.url()).toContain('/homes/home-1')
})

test('a failed queued action blocks its dependent but not unrelated work', async ({ page }) => {
  await mockWorkspace(page, { tables: { inspection_list: [], attachments: [], comments: [], work_events: [] } })
  const sent: string[] = []
  await page.route('**/functions/v1/command', async (route) => {
    const id = String(route.request().postDataJSON().envelope.operation_id)
    sent.push(id)
    await route.fulfill({ json: id === 'failed-parent' ? { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Fixture rejection' } } : { ok: true, data: { version: 3 } } })
  })
  await page.goto(`/org/${org}/homes/home-1`)
  await expect(page.getByText('Saved on this device for up to 24 hours.')).toBeVisible({ timeout: 30000 })
  await page.evaluate(async ({ userId, org }) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('buildtrack-offline-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('operations', 'readwrite')
      for (const [id, dependencies] of [['failed-parent', []], ['dependent', ['failed-parent']], ['independent', []]] as Array<[string, string[]]>) {
        transaction.objectStore('operations').put({ id, user_id: userId, organization_id: org, aggregate_id: id, command_name: 'add_comment', request_hash: id, envelope: { operation_id: id, payload: {} }, state: 'queued', dependencies, retries: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      }
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  }, { userId, org })
  await expect.poll(() => sent, { timeout: 30000 }).toContain('independent')
  expect(sent).toContain('failed-parent')
  expect(sent).not.toContain('dependent')
})
