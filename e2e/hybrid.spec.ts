import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

const nodes = [
  { name: 'kvm2', octet: 2, server: true },
  { name: 'kvm4', octet: 4, server: true },
  { name: 'kvm8', octet: 8, server: true },
  { name: 'm132', octet: 108, server: false },
  { name: 'm4128', octet: 109, server: false },
  { name: 'fedoraair', octet: 114, server: false },
  { name: 'iphone', octet: 137, server: false },
];

async function setupHybrid(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#topology').selectOption('hybrid');
  for (const [index, node] of nodes.entries()) {
    await page.locator('#add-peer-btn').click();
    const card = page.locator('.peer-card').nth(index);
    await expect(card).toBeVisible();
    await card.locator('[data-field="name"]').fill(node.name);
    await card.locator('[data-field="label"]').fill(node.name);
    await card.locator('[data-field="wgOctet"]').fill(String(node.octet));
    if (node.server) {
      if (index > 0) await card.locator('.peer-card__role').click();
      await card.locator('[data-field="publicEndpointIp"]').fill(`203.0.113.${node.octet}`);
    } else {
      await card.locator('[data-field="fullTunnel"]').check();
    }
  }
  await page.locator('#network-gateway').selectOption('3');
  await page.locator('[data-peer-id="3"] [data-field="natGateway"]').check();
  await expect(page.locator('#routing-errors')).toBeHidden();
}

async function preview(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: `${name}.conf`, exact: true }).click();
  return (await page.locator('#preview-code').textContent())!;
}

function allowedIPs(config: string): string[] {
  return [...config.matchAll(/^AllowedIPs = (.+)$/gm)].map((match) => match[1]);
}

test('hybrid builds reciprocal server peers, exports a ZIP, and keeps clients off each other', async ({ page }) => {
  await setupHybrid(page);
  for (const node of nodes.filter((node) => !node.server)) {
    const config = await preview(page, node.name);
    expect(allowedIPs(config)).toEqual([
      '10.100.0.2/32, fd10:100::2/128',
      '10.100.0.4/32, fd10:100::4/128',
      '0.0.0.0/0, ::/0',
    ]);
  }
  for (const node of nodes.filter((node) => node.server)) {
    const config = await preview(page, node.name);
    expect(allowedIPs(config)).toHaveLength(6);
    expect(allowedIPs(config).every((route) => route.includes('/32') && route.includes('/128'))).toBe(true);
  }

  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download-all-btn').click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('wireguard-configs.zip');
  const files = unzipSync(await readFile((await download.path())!));
  expect(Object.keys(files).sort()).toEqual([...nodes.map((node) => `${node.name}.conf`), 'keys.txt'].sort());
  expect(allowedIPs(strFromU8(files['m132.conf']))).toEqual([
    '10.100.0.2/32, fd10:100::2/128',
    '10.100.0.4/32, fd10:100::4/128',
    '0.0.0.0/0, ::/0',
  ]);
  expect(strFromU8(files['kvm8.conf'])).toContain('PostUp = iptables -t nat');
});

test('removing an override blocks every export and clears stale preview until repaired', async ({ page }) => {
  await setupHybrid(page);
  await page.locator('#peer-gateway-4').selectOption('2');
  expect(allowedIPs(await preview(page, 'm132'))).toEqual([
    '10.100.0.2/32, fd10:100::2/128',
    '0.0.0.0/0, ::/0',
    '10.100.0.8/32, fd10:100::8/128',
  ]);
  await page.getByRole('button', { name: 'Remover kvm4', exact: true }).click();
  await expect(page.locator('#routing-errors')).toBeVisible();
  await expect(page.locator('#preview-code')).toBeEmpty();
  await expect(page.locator('#preview-tabs')).toBeEmpty();
  for (const id of ['copy-current-btn', 'download-current-btn', 'copy-all-btn', 'download-all-btn']) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator('#peer-gateway-4')).toHaveValue('2');
  await expect(page.locator('#peer-gateway-4 option:checked')).toContainText('Nó removido');
  await expect(page.locator('#regen-keys-btn')).toBeEnabled();
  await page.locator('#regen-keys-btn').click();
  await expect(page.locator('#regen-keys-btn')).toBeEnabled();
  await expect(page.locator('#routing-errors')).toBeVisible();
  await page.locator('#peer-gateway-4').selectOption('');
  await expect(page.locator('#routing-errors')).toBeHidden();
  expect(allowedIPs(await preview(page, 'm132'))).toEqual([
    '10.100.0.2/32, fd10:100::2/128', '0.0.0.0/0, ::/0',
  ]);
});

test('role changes invalidate gateway choices, while mesh restores direct reachability', async ({ page }) => {
  await setupHybrid(page);
  await page.locator('[data-peer-id="3"] .peer-card__role').click();
  await expect(page.locator('#routing-errors')).toBeVisible();
  await expect(page.locator('#download-all-btn')).toBeDisabled();
  await page.locator('#topology').selectOption('mesh');
  await expect(page.locator('#routing-errors')).toBeHidden();
  expect(allowedIPs(await preview(page, 'm132'))).toHaveLength(6);
});

test('split hybrid keeps host routes; split hub-spoke assigns only one subnet route', async ({ page }) => {
  await setupHybrid(page);
  for (const id of ['4', '5', '6', '7']) {
    await page.locator(`[data-peer-id="${id}"] [data-field="fullTunnel"]`).uncheck();
  }
  expect(allowedIPs(await preview(page, 'm132'))).toEqual([
    '10.100.0.2/32, fd10:100::2/128',
    '10.100.0.4/32, fd10:100::4/128',
    '10.100.0.8/32, fd10:100::8/128',
  ]);
  await page.locator('#topology').selectOption('hub-spoke');
  expect(allowedIPs(await preview(page, 'm132'))).toEqual([
    '10.100.0.2/32, fd10:100::2/128',
    '10.100.0.4/32, fd10:100::4/128',
    '10.100.0.0/24, fd10:100::/64',
  ]);
  await page.locator('#network-gateway').selectOption('');
  await expect(page.locator('#routing-errors')).toBeVisible();
  await page.locator('#topology').selectOption('hybrid');
  await expect(page.locator('#routing-errors')).toBeHidden();
});

test('routing errors use PT-BR without repeating the node name', async ({ page }) => {
  await page.goto('/');
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(1);
  await page.locator('[data-field="fullTunnel"]').check();
  await expect(page.locator('#routing-issues li')).toHaveText('peer1 (#1): Selecione um gateway para Full Tunnel.');
  await expect(page.locator('#download-all-btn')).toBeDisabled();
});

test('gateway labels update without losing focus and mobile controls fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupHybrid(page);
  const name = page.locator('[data-peer-id="3"] [data-field="name"]');
  await name.fill('exit-server');
  await expect(name).toBeFocused();
  await expect(page.locator('#network-gateway option:checked')).toContainText('exit-server');
  await expect(page.locator('#peer-gateway-help-4')).toContainText('exit-server');
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width);
});
