import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function load(page: Page) {
  await page.goto('/');
  await page.locator('#load-example-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(6);
}

async function download(page: Page, button: string) {
  const downloading = page.waitForEvent('download');
  await page.locator(button).click();
  return readFile((await (await downloading).path())!);
}

async function importJson(page: Page, data: unknown) {
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#import-structure-btn').click();
  await (await choosing).setFiles({ name: 'structure.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
}

async function preview(page: Page, name: string) {
  await page.getByRole('button', { name: `${name}.conf`, exact: true }).click();
  return (await page.locator('#preview-code').textContent())!;
}

test('routes a node\'s extra networks on the servers and round-trips them', async ({ page }) => {
  await load(page);
  const extras = page.locator('#peer-extras-example-laptop');
  await expect(extras).toHaveValue('');
  await expect(extras).toHaveAttribute('aria-invalid', 'false');

  await extras.fill('192.168.0.10/32, 2001:db8:10::/48');
  await expect(extras).toHaveAttribute('aria-invalid', 'false');
  expect(await preview(page, 'exit-primary'))
    .toContain('AllowedIPs = 10.42.0.10/32, 192.168.0.10/32, 2001:db8:10::/48, fd10:100::10/128');
  expect(await preview(page, 'services-vps')).toContain('192.168.0.10/32');
  expect(await preview(page, 'laptop')).not.toContain('192.168.0.10/32');

  const saved = JSON.parse((await download(page, '#export-structure-btn')).toString());
  expect(saved.version).toBe(5);
  expect(saved.peers.find((peer: { id: string }) => peer.id === 'example-laptop').extraAllowedIPs)
    .toEqual(['192.168.0.10/32', '2001:db8:10::/48']);

  await extras.fill('');
  page.once('dialog', (dialog) => dialog.accept());
  await importJson(page, saved);
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
  await expect(extras).toHaveValue('192.168.0.10/32, 2001:db8:10::/48');
});

test('flags invalid or overlapping extras and blocks the downloads', async ({ page }) => {
  await load(page);
  const laptop = page.locator('#peer-extras-example-laptop');
  await laptop.fill('192.168.0.10');
  await expect(laptop).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#peer-extras-help-example-laptop')).toContainText('192.168.0.10');
  await expect(page.locator('#routing-errors')).toBeVisible();
  await expect(page.locator('#download-all-btn')).toBeDisabled();

  await laptop.fill('192.168.0.0/24');
  await page.locator('#peer-extras-example-phone').fill('192.168.0.20/32');
  await expect(page.locator('#routing-errors')).toContainText('sobrepõe');
  await expect(page.locator('#download-all-btn')).toBeDisabled();

  await page.locator('#peer-extras-example-phone').fill('192.168.1.20/32');
  await expect(page.locator('#routing-errors')).toBeHidden();
  await expect(page.locator('#download-all-btn')).toBeEnabled();
});
