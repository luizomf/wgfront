import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { EXAMPLE_STRUCTURE_JSON } from '../src/lib/example-structure';

test('loads a complete fictitious network from an empty editor and exports its key-free structure', async ({ page }) => {
  await page.goto('/');
  page.on('dialog', () => { throw new Error('An empty editor must not ask to replace nodes.'); });
  await page.getByRole('button', { name: '[CARREGAR EXEMPLO]', exact: true }).click();
  await expect(page.locator('.peer-card')).toHaveCount(6);
  await expect(page.locator('#structure-status')).toContainText('IPs públicos são fictícios');
  await expect(page.locator('#topology')).toHaveValue('hybrid');
  await expect(page.locator('#network-gateway')).toHaveValue('example-exit');
  await expect(page.locator('#peer-gateway-example-phone')).toHaveValue('example-alt');
  await expect(page.locator('#routing-errors')).toBeHidden();
  await expect(page.locator('#download-all-btn')).toBeEnabled();
  await expect(page.locator('[data-peer-id="example-workstation"] [data-field="fullTunnel"]')).not.toBeChecked();
  await page.getByRole('button', { name: 'laptop.conf', exact: true }).click();
  await expect(page.locator('#preview-code')).toContainText('AllowedIPs = 0.0.0.0/0, ::/0');

  const downloading = page.waitForEvent('download');
  await page.locator('#export-structure-btn').click();
  const saved = await readFile((await (await downloading).path())!, 'utf8');
  expect(JSON.parse(saved)).toEqual(JSON.parse(EXAMPLE_STRUCTURE_JSON));
  expect(saved).not.toMatch(/"keys"|"privateKey"|"publicKey"/);
  for (const topology of ['hub-spoke', 'mesh', 'hybrid']) {
    await page.locator('#topology').selectOption(topology);
    await expect(page.locator('#routing-errors')).toBeHidden();
    await expect(page.locator('#download-all-btn')).toBeEnabled();
  }
});

test('preserves the current network on cancellation and creates fresh keys on confirmed reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(1);
  await page.locator('[data-field="name"]').fill('my-existing-node');
  const original = await page.locator('#preview-code').textContent();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#load-example-btn').click();
  await expect(page.locator('#structure-status')).toContainText('Exemplo cancelado');
  await expect(page.locator('.peer-card')).toHaveCount(1);
  await expect(page.locator('#preview-code')).toHaveText(original!);

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#load-example-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(6);
  const firstPrivateKey = (await page.locator('#preview-code').textContent())!.match(/^PrivateKey = (.+)$/m)![1];
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#load-example-btn').click();
  await expect(page.locator('#load-example-btn')).toBeEnabled();
  await expect(page.locator('#preview-code')).not.toContainText(firstPrivateKey);
  await expect(page.locator('.peer-card')).toHaveCount(6);
});

test('failed key generation preserves the editor and makes the example button usable again', async ({ page }) => {
  await page.goto('/');
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(1);
  const original = await page.locator('#preview-code').textContent();
  await page.evaluate(() => {
    Object.defineProperty(crypto.subtle, 'generateKey', {
      configurable: true,
      value: () => Promise.reject(new Error('Falha simulada na geração de chaves.')),
    });
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#load-example-btn').click();
  await expect(page.locator('#structure-status')).toContainText('Falha simulada');
  await expect(page.locator('#preview-code')).toHaveText(original!);
  await expect(page.locator('.peer-card')).toHaveCount(1);
  await expect(page.locator('#load-example-btn')).toBeEnabled();
  await expect(page.locator('#import-structure-btn')).toBeEnabled();
  await expect(page.locator('#export-structure-btn')).toBeEnabled();
});

test('disables structure actions while example key generation is pending', async ({ page }) => {
  await page.goto('/');
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(1);
  await page.evaluate(() => {
    const target = window as unknown as { rejectExampleKeys: () => void };
    const pending = new Promise((_, reject) => {
      target.rejectExampleKeys = () => reject(new Error('Falha simulada após espera.'));
    });
    Object.defineProperty(crypto.subtle, 'generateKey', { configurable: true, value: () => pending });
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#load-example-btn').click();
  for (const id of ['load-example-btn', 'import-structure-btn', 'export-structure-btn']) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await page.evaluate(() => (window as unknown as { rejectExampleKeys: () => void }).rejectExampleKeys());
  await expect(page.locator('#structure-status')).toContainText('Falha simulada após espera');
  for (const id of ['load-example-btn', 'import-structure-btn', 'export-structure-btn']) {
    await expect(page.locator(`#${id}`)).toBeEnabled();
  }
  await expect(page.locator('.peer-card')).toHaveCount(1);
});

test('example controls and guidance fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#load-example-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(6);
  await page.getByText('Como funciona o exemplo fictício?', { exact: true }).click();
  await expect(page.locator('#example-help')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});
