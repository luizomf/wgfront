import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { EXAMPLE_STRUCTURE_JSON } from '../src/lib/example-structure';
import { DEFAULT_DNS } from '../src/lib/dns';

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

async function configs(page: Page) {
  const zip = unzipSync(await download(page, '#download-all-btn'));
  return Object.fromEntries(Object.entries(zip).map(([name, content]) => [name, strFromU8(content)]));
}

async function importJson(page: Page, data: unknown) {
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#import-structure-btn').click();
  await (await choosing).setFiles({ name: 'structure.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
}

async function preview(page: Page, filename: string) {
  await page.getByRole('button', { name: filename, exact: true }).click();
}

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    const writes: string[] = [];
    Object.assign(window, { clipboardWrites: writes });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { writes.push(text); } } });
  });
}

async function clipboard(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { clipboardWrites: string[] }).clipboardWrites);
}

test('new nodes start automatic with unchanged dual-stack config bytes', async ({ page }) => {
  await page.goto('/');
  await page.locator('#add-peer-btn').click();
  const mtu = page.getByRole('textbox', { name: 'MTU deste nó' });
  await expect(mtu).toHaveValue('');
  await expect(mtu).toHaveAttribute('aria-invalid', 'false');
  const before = (await page.locator('#preview-code').textContent())!;
  expect(before).not.toContain('MTU =');
  expect(before).toContain('Address = 10.100.0.1/24, fd10:100::1/64');
  await mtu.fill('1280');
  await expect(page.locator('#preview-code')).toHaveText(before.replace(/(Address = .+\n)/, '$1MTU = 1280\n'));
  await mtu.fill('');
  await expect(page.locator('#preview-code')).toHaveText(before);
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('[data-peer-id="2"] [data-field="mtu"]')).toHaveValue('');
});

test('per-node bounds affect only Interface MTU; preview, copies, individual downloads and ZIP agree', async ({ page }) => {
  await stubClipboard(page);
  await load(page);
  const before = await configs(page);
  expect(Object.values(before).every((content) => !content.includes('MTU ='))).toBe(true);
  await page.locator('#peer-mtu-example-exit').fill('1280');
  await page.locator('#peer-mtu-example-laptop').fill('65535');
  const after = await configs(page);
  for (const [name, content] of Object.entries(after)) {
    const mtu = name === 'exit-primary.conf' ? 1280 : name === 'laptop.conf' ? 65535 : null;
    if (mtu !== null) {
      expect(content.match(/^MTU = .+$/gm)).toEqual([`MTU = ${mtu}`]);
      expect(content.split('[Peer]')[0]).toContain(`MTU = ${mtu}\n`);
      expect(content.replace(`MTU = ${mtu}\n`, '')).toBe(before[name]);
      await preview(page, name);
      await expect(page.locator('#preview-code')).toHaveText(content);
      expect((await download(page, '#download-current-btn')).toString()).toBe(content);
      await page.locator('#copy-current-btn').click();
      expect((await clipboard(page)).at(-1)).toBe(content);
    } else expect(content).toBe(before[name]);
  }
  await page.locator('#copy-all-btn').click();
  expect((await clipboard(page)).at(-1)).toBe(Object.entries(after)
    .filter(([name]) => name !== 'keys.txt').map(([name, content]) => `# --- ${name} ---\n${content}`).join('\n\n'));
  await page.locator('#peer-mtu-example-exit').fill('');
  await page.locator('#peer-mtu-example-laptop').fill('');
  expect(await configs(page)).toEqual(before);
});

test('malformed live edits retain focus and block all stale previews and exports, including forced handlers', async ({ page }) => {
  await stubClipboard(page);
  await load(page);
  await preview(page, 'keys.txt');
  const before = (await page.locator('#preview-code').textContent())!;
  const mtu = page.locator('#peer-mtu-example-laptop');
  const buttons = ['download-all-btn', 'copy-all-btn', 'copy-current-btn', 'download-current-btn'];
  const downloads: string[] = [];
  page.on('download', (file) => downloads.push(file.suggestedFilename()));
  for (const raw of ['1279', '65536', '1420.5', '1420.0', '1420px', '1e3', '0x580', '-1420', '+1420', 'NaN', 'Infinity', '9'.repeat(400), 'abc']) {
    await mtu.fill(raw);
    await expect(mtu).toBeFocused();
    await expect(mtu).toHaveValue(raw);
    await expect(mtu).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#routing-errors')).toContainText('laptop');
    await expect(page.locator('#routing-errors')).toContainText('MTU inválido');
    await expect(page.locator('#preview-code')).toBeEmpty();
    await expect(page.locator('#preview-tabs')).toBeEmpty();
    for (const id of buttons) {
      await expect(page.locator(`#${id}`)).toBeDisabled();
      await page.locator(`#${id}`).dispatchEvent('click');
    }
    await page.locator('#export-structure-btn').click();
    await expect(page.locator('#structure-status')).toContainText('MTU inválido');
    await expect(mtu).toHaveValue(raw);
  }
  // Rerender after blur must not turn malformed text into blank/automatic.
  await page.locator('#network-dns').fill('9.9.9.9');
  await expect(mtu).toHaveValue('abc');
  await expect(page.locator('#download-all-btn')).toBeDisabled();
  expect(await clipboard(page)).toEqual([]);
  expect(downloads).toEqual([]);
  await mtu.fill('1420');
  await expect(mtu).toBeFocused();
  await expect(mtu).toHaveAttribute('aria-invalid', 'false');
  await expect(page.locator('#routing-errors')).toBeHidden();
  await expect(page.locator('#preview-code')).toHaveText(before);
  for (const id of buttons) await expect(page.locator(`#${id}`)).toBeEnabled();
  await mtu.fill('');
  await expect(page.locator('#preview-code')).toHaveText(before);
});

test('strict v4 round-trip reconciles same IDs, replaces malformed edits, and rotates keys atomically', async ({ page }) => {
  await load(page);
  await page.locator('#peer-mtu-example-exit').fill('1280');
  await page.locator('#peer-mtu-example-laptop').fill('65535');
  const before = await configs(page);
  const saved = JSON.parse((await download(page, '#export-structure-btn')).toString());
  expect(saved.version).toBe(4);
  expect(saved.peers.map((peer: { mtu: number | null }) => peer.mtu)).toEqual([1280, null, null, 65535, null, null]);
  expect(JSON.stringify(saved)).not.toMatch(/privateKey|publicKey|"keys"/);
  for (const mtu of [1279, 65536, 1420.5, '1420', true, 'bad', undefined]) {
    const invalid = structuredClone(saved);
    invalid.peers[0].mtu = mtu;
    await importJson(page, invalid);
    await expect(page.locator('#structure-status')).toContainText('Estrutura inválida');
    // Inspect every file without issuing a burst of redundant Chrome downloads.
    for (const [filename, content] of Object.entries(before)) {
      await preview(page, filename);
      await expect(page.locator('#preview-code')).toHaveText(content);
    }
  }
  await page.locator('#peer-mtu-example-exit').fill('abc');
  await page.locator('#peer-mtu-example-laptop').fill('1420');
  await page.locator('#peer-mtu-example-phone').fill('1500');
  page.once('dialog', (dialog) => dialog.accept());
  await importJson(page, saved);
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
  await expect(page.locator('#peer-mtu-example-exit')).toHaveValue('1280');
  await expect(page.locator('#peer-mtu-example-laptop')).toHaveValue('65535');
  await expect(page.locator('#peer-mtu-example-phone')).toHaveValue('');
  expect(JSON.parse((await download(page, '#export-structure-btn')).toString())).toEqual(saved);
  const after = await configs(page);
  expect(after['keys.txt']).not.toBe(before['keys.txt']);
  const withoutKeys = (text: string) => text.replace(/^(PrivateKey|PublicKey) = .+$/gm, '$1 = REDACTED');
  for (const name of Object.keys(after).filter((name) => name !== 'keys.txt')) {
    expect(withoutKeys(after[name])).toBe(withoutKeys(before[name]));
  }
});

for (const version of [1, 2]) {
  test(`legacy v${version} imports automatic MTU with historical DNS compatibility and reexports v4`, async ({ page }) => {
    await load(page);
    await page.locator('#peer-mtu-example-laptop').fill('1420');
    const legacy = JSON.parse(EXAMPLE_STRUCTURE_JSON);
    legacy.version = version;
    delete legacy.network.usePsk;
    legacy.network.dns = '9.9.9.9';
    legacy.peers[4].dns = '';
    legacy.peers[5].dns = '10.42.0.3';
    if (version === 1) delete legacy.network.dns;
    for (const peer of legacy.peers) {
      delete peer.mtu;
      if (version === 1) delete peer.dns;
    }
    page.once('dialog', (dialog) => dialog.accept());
    await importJson(page, legacy);
    await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
    for (const input of await page.locator('[data-field="mtu"]').all()) await expect(input).toHaveValue('');
    const files = await configs(page);
    expect(Object.values(files).every((text) => !text.includes('MTU ='))).toBe(true);
    expect(files['laptop.conf']).toContain(`DNS = ${version === 1 ? DEFAULT_DNS : '9.9.9.9'}`);
    if (version === 1) {
      expect(files['phone.conf']).toContain(`DNS = ${DEFAULT_DNS}`);
      expect(files['workstation.conf']).not.toContain('DNS =');
    } else {
      expect(files['phone.conf']).not.toContain('DNS =');
      expect(files['workstation.conf']).toContain('DNS = 10.42.0.3');
    }
    const saved = JSON.parse((await download(page, '#export-structure-btn')).toString());
    expect(saved.version).toBe(4);
    expect(saved.peers.every((peer: { mtu: number | null }) => peer.mtu === null)).toBe(true);
    page.once('dialog', (dialog) => dialog.accept());
    await importJson(page, saved);
    await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
    expect(JSON.parse((await download(page, '#export-structure-btn')).toString())).toEqual(saved);
  });
}

test('MTU controls and errors fit mobile, preserve typing focus, and make no external requests', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const external: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4322') external.push(request.url());
  });
  await load(page);
  const mtu = page.locator('#peer-mtu-example-exit');
  await mtu.pressSequentially('1420');
  await expect(mtu).toBeFocused();
  await expect(mtu).toHaveValue('1420');
  await expect(page.locator('#preview-code')).toContainText('MTU = 1420');
  await mtu.fill('invalid');
  await expect(mtu).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-peer-id="example-exit"]')).toContainText('não altera o MTU do Docker');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(external).toEqual([]);
  await page.locator('[data-peer-id="example-exit"]').screenshot({ path: testInfo.outputPath('mtu-mobile.png') });
});
