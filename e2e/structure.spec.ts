import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function selectFile(page: Page, buffer: Buffer): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#import-structure-btn').click();
  const chooser = await choosing;
  await chooser.setFiles({ name: 'structure.json', mimeType: 'application/json', buffer });
}

async function setup(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(1);
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(2);
  await page.locator('#topology').selectOption('hybrid');
  await page.locator('#subnet').fill('10.77.0');
  await page.locator('#port').fill('51900');
  await page.locator('#keepalive').fill('15');
  await page.locator('#network-gateway').selectOption('1');
  const server = page.locator('[data-peer-id="1"]');
  await server.locator('[data-field="name"]').fill('exit');
  await server.locator('[data-field="publicEndpointIp"]').fill('203.0.113.8');
  await server.locator('[data-field="natGateway"]').check();
  await server.locator('[data-field="natInterface"]').fill('ens3');
  const client = page.locator('[data-peer-id="2"]');
  await client.locator('[data-field="name"]').fill('phone');
  await client.locator('[data-field="fullTunnel"]').check();
  await client.locator('[data-field="gatewayId"]').selectOption('1');
}

async function save(page: Page): Promise<Buffer> {
  const downloading = page.waitForEvent('download');
  await page.locator('#export-structure-btn').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('wireguard-structure.json');
  return readFile((await download.path())!);
}

test('exports settings only and imports them into both populated and fresh editors with new keys', async ({ page }) => {
  await setup(page);
  const before = await page.locator('#preview-code').textContent();
  const saved = await save(page);
  const structure = JSON.parse(saved.toString());
  expect(structure.version).toBe(2);
  expect(structure.peers).toHaveLength(2);
  expect(saved.toString()).not.toMatch(/privateKey|publicKey|"keys"/);
  const oldPrivateKey = before!.match(/^PrivateKey = (.+)$/m)![1];
  expect(saved.toString()).not.toContain(oldPrivateKey);

  await page.locator('[data-peer-id="1"] [data-field="name"]').fill('changed');
  await page.locator('#subnet').fill('10.88.0');
  page.once('dialog', (dialog) => dialog.accept());
  await selectFile(page, saved);
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
  await expect(page.locator('[data-peer-id="1"] [data-field="name"]')).toHaveValue('exit');
  await expect(page.locator('#subnet')).toHaveValue('10.77.0');
  await expect(page.locator('#port')).toHaveValue('51900');
  await expect(page.locator('#keepalive')).toHaveValue('15');
  await expect(page.locator('#preview-code')).not.toContainText(oldPrivateKey);
  expect(JSON.parse((await save(page)).toString())).toEqual(structure);

  await page.reload();
  await expect(page.locator('.peer-card')).toHaveCount(0);
  await expect(page.locator('#import-structure-btn')).toBeEnabled();
  await selectFile(page, saved);
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
  await expect(page.locator('[data-peer-id="1"] [data-field="natInterface"]')).toHaveValue('ens3');
  await expect(page.locator('#peer-gateway-2')).toHaveValue('1');
  await expect(page.locator('#download-all-btn')).toBeEnabled();
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('[data-peer-id="3"]')).toBeVisible();
});

test('invalid files and cancelled replacement preserve the current editor', async ({ page }) => {
  await setup(page);
  const saved = await save(page);
  const before = await page.locator('#preview-code').textContent();
  await selectFile(page, Buffer.from('{invalid'));
  await expect(page.locator('#structure-status')).toContainText('JSON não reconhecido');
  await expect(page.locator('#preview-code')).toHaveText(before!);
  page.once('dialog', (dialog) => dialog.dismiss());
  await selectFile(page, saved);
  await expect(page.locator('#structure-status')).toContainText('cancelada');
  await expect(page.locator('#preview-code')).toHaveText(before!);
});

test('import restores the saved display order even when node IDs already exist', async ({ page }) => {
  await setup(page);
  const data = JSON.parse((await save(page)).toString());
  data.peers.reverse();
  page.once('dialog', (dialog) => dialog.accept());
  await selectFile(page, Buffer.from(JSON.stringify(data)));
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
  expect(await page.locator('.peer-card').evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.peerId))).toEqual(['2', '1']);
  await expect(page.locator('.preview__tab')).toHaveText(['phone.conf', 'exit.conf', 'keys.txt']);
});

test('unfinished gateway selections can be saved without enabling config export', async ({ page }) => {
  await setup(page);
  await page.locator('#network-gateway').selectOption('');
  await page.locator('#peer-gateway-2').selectOption('');
  await expect(page.locator('#download-all-btn')).toBeDisabled();
  const saved = await save(page);
  page.once('dialog', (dialog) => dialog.accept());
  await selectFile(page, saved);
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
  await expect(page.locator('#routing-errors')).toBeVisible();
  await expect(page.locator('#download-all-btn')).toBeDisabled();
  await expect(page.locator('#export-structure-btn')).toBeEnabled();
});
