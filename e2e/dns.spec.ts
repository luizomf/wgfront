import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT_DNS } from '../src/lib/dns';
import { EXAMPLE_STRUCTURE_JSON } from '../src/lib/example-structure';

async function load(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#load-example-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(6);
}

async function importJson(page: Page, json: string): Promise<void> {
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#import-structure-btn').click();
  await (await choosing).setFiles({ name: 'structure.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
}

async function exportJson(page: Page): Promise<string> {
  const downloading = page.waitForEvent('download');
  await page.locator('#export-structure-btn').click();
  return readFile((await (await downloading).path())!, 'utf8');
}

async function preview(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `${name}.conf`, exact: true }).click();
}

test('retains original DNS defaults and only updates full-tunnel inheritance without rotating keys', async ({ page }) => {
  await load(page);
  await expect(page.locator('#network-dns')).toHaveValue(DEFAULT_DNS);
  await preview(page, 'laptop');
  const before = (await page.locator('#preview-code').textContent())!;
  expect(before).toContain(`DNS = ${DEFAULT_DNS}`);
  const laptop = page.locator('[data-peer-id="example-laptop"]');
  await expect(laptop.locator('[data-field="inheritDns"]')).toBeChecked();
  await expect(laptop.locator('[data-field="dns"]')).toBeDisabled();
  await page.locator('#network-dns').fill('9.9.9.9 2620:fe::fe');
  await expect(page.locator('#preview-code')).toHaveText(before.replace(`DNS = ${DEFAULT_DNS}`, 'DNS = 9.9.9.9, 2620:fe::fe'));
  await expect(laptop.locator('[data-field="dns"]')).toHaveValue('9.9.9.9 2620:fe::fe');
  await preview(page, 'workstation');
  await expect(page.locator('#preview-code')).not.toContainText('DNS =');
  await preview(page, 'exit-primary');
  await expect(page.locator('#preview-code')).not.toContainText('DNS =');
});

test('supports full/split overrides, omission, inheritance restoration, and matching ZIP contents', async ({ page }) => {
  await load(page);
  const laptop = page.locator('[data-peer-id="example-laptop"]');
  await laptop.locator('[data-field="inheritDns"]').uncheck();
  await laptop.locator('[data-field="dns"]').fill('9.9.9.9, 2620:fe::fe');
  await preview(page, 'laptop');
  await expect(page.locator('#preview-code')).toContainText('DNS = 9.9.9.9, 2620:fe::fe');
  const workstation = page.locator('[data-peer-id="example-workstation"]');
  await workstation.locator('[data-field="inheritDns"]').uncheck();
  await workstation.locator('[data-field="dns"]').fill('10.100.0.3');
  await preview(page, 'workstation');
  await expect(page.locator('#preview-code')).toContainText('DNS = 10.100.0.3');
  await expect(page.locator('#preview-code')).not.toContainText('AllowedIPs = 0.0.0.0/0');
  await laptop.locator('[data-field="dns"]').fill('');
  await preview(page, 'laptop');
  await expect(page.locator('#preview-code')).not.toContainText('DNS =');
  await expect(page.locator('#preview-code')).toContainText('AllowedIPs = 0.0.0.0/0, ::/0');
  await expect(laptop.locator('[data-field="inheritDns"]')).not.toBeChecked();
  await laptop.locator('[data-field="inheritDns"]').check();
  await expect(page.locator('#preview-code')).toContainText(`DNS = ${DEFAULT_DNS}`);
  const downloading = page.waitForEvent('download');
  await page.locator('#download-all-btn').click();
  const files = unzipSync(await readFile((await (await downloading).path())!));
  expect(strFromU8(files['laptop.conf'])).toContain(`DNS = ${DEFAULT_DNS}`);
  expect(strFromU8(files['workstation.conf'])).toContain('DNS = 10.100.0.3');
});

test('blocks stale preview and exports for invalid inherited or explicit DNS, then recovers', async ({ page }) => {
  await load(page);
  await page.locator('#network-dns').fill('256.1.1.1');
  await expect(page.locator('#network-dns')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#routing-errors')).toContainText('DNS inválido');
  for (const id of ['download-all-btn', 'copy-all-btn', 'copy-current-btn', 'download-current-btn']) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator('#preview-code')).toBeEmpty();
  await page.locator('#network-dns').fill(DEFAULT_DNS);
  await expect(page.locator('#download-all-btn')).toBeEnabled();
  const workstation = page.locator('[data-peer-id="example-workstation"]');
  await workstation.locator('[data-field="inheritDns"]').uncheck();
  await workstation.locator('[data-field="dns"]').fill('dns.example.com');
  await expect(workstation.locator('[data-field="dns"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#download-all-btn')).toBeDisabled();
  await workstation.locator('[data-field="dns"]').fill('');
  await expect(page.locator('#routing-errors')).toBeHidden();
  await expect(page.locator('#download-all-btn')).toBeEnabled();
});

test('round-trips DNS choices through existing node IDs and loads old version 1 structures unchanged', async ({ page }) => {
  await load(page);
  await page.locator('#network-dns').fill('9.9.9.9');
  const laptop = page.locator('[data-peer-id="example-laptop"]');
  const phone = page.locator('[data-peer-id="example-phone"]');
  await laptop.locator('[data-field="inheritDns"]').uncheck();
  await laptop.locator('[data-field="dns"]').fill('10.100.0.8');
  await phone.locator('[data-field="inheritDns"]').uncheck();
  await phone.locator('[data-field="dns"]').fill('');
  const json = await exportJson(page);
  expect(JSON.parse(json).version).toBe(3);
  expect(json).not.toMatch(/"keys"|privateKey|publicKey/);
  await page.locator('#network-dns').fill(DEFAULT_DNS);
  await laptop.locator('[data-field="inheritDns"]').check();
  await phone.locator('[data-field="inheritDns"]').check();
  page.once('dialog', (dialog) => dialog.accept());
  await importJson(page, json);
  await expect(page.locator('#network-dns')).toHaveValue('9.9.9.9');
  await expect(laptop.locator('[data-field="inheritDns"]')).not.toBeChecked();
  await expect(laptop.locator('[data-field="dns"]')).toHaveValue('10.100.0.8');
  await expect(phone.locator('[data-field="inheritDns"]')).not.toBeChecked();
  await expect(phone.locator('[data-field="dns"]')).toHaveValue('');
  expect(JSON.parse(await exportJson(page))).toEqual(JSON.parse(json));

  const legacy = JSON.parse(EXAMPLE_STRUCTURE_JSON);
  legacy.version = 1;
  delete legacy.network.dns;
  legacy.peers.forEach((peer: { dns?: string | null; mtu?: number | null }) => { delete peer.dns; delete peer.mtu; });
  page.once('dialog', (dialog) => dialog.accept());
  await importJson(page, JSON.stringify(legacy));
  await expect(page.locator('#network-dns')).toHaveValue(DEFAULT_DNS);
  await expect(laptop.locator('[data-field="inheritDns"]')).toBeChecked();
  await expect(phone.locator('[data-field="inheritDns"]')).toBeChecked();
  await preview(page, 'laptop');
  await expect(page.locator('#preview-code')).toContainText(`DNS = ${DEFAULT_DNS}`);
  await preview(page, 'workstation');
  await expect(page.locator('#preview-code')).not.toContainText('DNS =');
});

test('DNS controls fit mobile and editing resolvers makes no external requests', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const external: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4322') external.push(request.url());
  });
  await load(page);
  await expect(page.locator('#network-dns')).toBeVisible();
  await page.locator('#network-dns').fill('9.9.9.9, 2620:fe::fe');
  await preview(page, 'phone');
  await expect(page.locator('#preview-code')).toContainText('DNS = 9.9.9.9, 2620:fe::fe');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(external).toEqual([]);
});
