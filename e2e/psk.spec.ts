import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { EXAMPLE_STRUCTURE_JSON } from '../src/lib/example-structure';

// Isolated page-only fault controls. Never persist, log, or send generated secrets.
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const control = {
      failRandom: false, randomCalls: 0, failX: false, delayX: false,
      release: undefined as (() => void) | undefined, writes: [] as string[],
      corrupt: false,
    };
    Object.assign(window, { pskTest: control });
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = ((bytes: Uint8Array) => {
      control.randomCalls++;
      if (control.failRandom) throw new Error('Test entropy unavailable');
      return random(bytes);
    }) as typeof crypto.getRandomValues;
    const generate = crypto.subtle.generateKey.bind(crypto.subtle);
    crypto.subtle.generateKey = (async (...args: Parameters<typeof generate>) => {
      if (control.failX) throw new Error('Test X25519 unavailable');
      if (control.delayX) {
        control.delayX = false;
        await new Promise<void>((resolve) => { control.release = resolve; });
      }
      return generate(...args);
    }) as typeof crypto.subtle.generateKey;
    const get = Map.prototype.get;
    Map.prototype.get = function (key: unknown) {
      const value = get.call(this, key);
      if (control.corrupt && typeof key === 'string' && key.startsWith('["example-') && typeof value === 'string' && value.length === 44) return 'invalid';
      return value;
    };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { control.writes.push(text); } } });
  });
}

type Controls = { failRandom: boolean; failX: boolean; delayX: boolean; randomCalls: number; release?: () => void; writes: string[]; corrupt: boolean };
async function control(page: Page, partial: Partial<Controls>) {
  await page.evaluate((values) => Object.assign((window as unknown as { pskTest: Controls }).pskTest, values), partial);
}
async function release(page: Page) {
  await page.evaluate(() => (window as unknown as { pskTest: Controls }).pskTest.release!());
}
async function load(page: Page) {
  await instrument(page);
  await page.goto('/');
  await expect(page.locator('#network-psk')).not.toBeChecked();
  await page.locator('#load-example-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(6);
}
async function download(page: Page, button: string) {
  const pending = page.waitForEvent('download');
  await page.locator(button).click();
  return readFile((await (await pending).path())!);
}
async function files(page: Page) {
  return Object.fromEntries(Object.entries(unzipSync(await download(page, '#download-all-btn')))
    .map(([name, bytes]) => [name, strFromU8(bytes)]));
}
async function previews(page: Page) {
  const result: Record<string, string> = {};
  for (const name of await page.locator('.preview__tab').allTextContents()) {
    await page.getByRole('button', { name, exact: true }).click();
    result[name] = (await page.locator('#preview-code').textContent())!;
  }
  return result;
}
async function importJson(page: Page, json: string) {
  const choosing = page.waitForEvent('filechooser');
  await page.locator('#import-structure-btn').click();
  await (await choosing).setFiles({ name: 'structure.json', mimeType: 'application/json', buffer: Buffer.from(json) });
}
function pairKeys(configs: Record<string, string>, count: number) {
  const publicToName = new Map<string, string>();
  const entries = Object.entries(configs).filter(([name]) => name !== 'keys.txt');
  const summary = configs['keys.txt'];
  for (const block of summary.trim().split('\n\n')) {
    const lines = block.split('\n');
    publicToName.set(lines.find((line) => line.startsWith('  public : '))!.slice(11), `${lines[0]}.conf`);
  }
  const pairs = new Map<string, string>();
  const occurrences = new Map<string, number>();
  let blocks = 0;
  for (const [self, text] of entries) {
    for (const block of text.split('[Peer]\n').slice(1)) {
      blocks++;
      const other = publicToName.get(block.match(/^PublicKey = (.+)$/m)![1]);
      expect(other).toBeDefined();
      const id = JSON.stringify([self, other!].sort());
      const key = block.match(/^PresharedKey = (.+)$/m)![1];
      expect(Buffer.from(key, 'base64')).toHaveLength(32);
      expect(Buffer.from(key, 'base64').toString('base64')).toBe(key);
      expect(key).not.toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
      if (pairs.has(id)) expect(key).toBe(pairs.get(id));
      pairs.set(id, key);
      occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    }
  }
  expect(blocks).toBe(count * 2);
  expect(pairs.size).toBe(count);
  expect(new Set(pairs.values()).size).toBe(count);
  expect([...occurrences.values()].every((n) => n === 2)).toBe(true);
  return pairs;
}

for (const [topology, count] of [['hybrid', 12], ['hub-spoke', 12], ['mesh', 15]] as const) {
  test(`${topology}: PSK symmetry, uniqueness and all preview/copy/download/ZIP paths agree`, async ({ page }) => {
    await load(page);
    await page.locator('#topology').selectOption(topology);
    const baseline = await files(page);
    expect(await page.evaluate(() => (window as unknown as { pskTest: Controls }).pskTest.randomCalls)).toBe(0);
    await page.locator('#network-psk').check();
    const enabled = await files(page);
    pairKeys(enabled, count);
    for (const [name, text] of Object.entries(enabled)) {
      expect(text.replace(/^PresharedKey = .+\n/gm, '')).toBe(baseline[name]);
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('#preview-code')).toHaveText(text);
      expect((await download(page, '#download-current-btn')).toString()).toBe(text);
      await page.locator('#copy-current-btn').click();
      expect(await page.evaluate(() => (window as unknown as { pskTest: Controls }).pskTest.writes.at(-1))).toBe(text);
    }
    await page.locator('#copy-all-btn').click();
    expect(await page.evaluate(() => (window as unknown as { pskTest: Controls }).pskTest.writes.at(-1)))
      .toBe(Object.entries(enabled).filter(([name]) => name !== 'keys.txt').map(([name, content]) => `# --- ${name} ---\n${content}`).join('\n\n'));
    await page.locator('#network-psk').uncheck();
    expect(await previews(page)).toEqual(baseline);
    await page.locator('#network-psk').check();
    const fresh = pairKeys(await previews(page), count);
    for (const [id, key] of pairKeys(enabled, count)) expect(fresh.get(id)).not.toBe(key);
  });
}

test('graph reconciliation retains existing keys, ordinary metadata and route edits do not rotate', async ({ page }) => {
  await load(page);
  await page.locator('#network-psk').check();
  const initial = pairKeys(await previews(page), 12);
  await page.locator('#topology').selectOption('mesh');
  const mesh = pairKeys(await previews(page), 15);
  for (const [id, key] of initial) expect(mesh.get(id)).toBe(key);
  await page.locator('#topology').selectOption('hybrid');
  expect(pairKeys(await previews(page), 12)).toEqual(initial);
  await page.locator('#network-dns').fill('9.9.9.9');
  await page.locator('#keepalive').fill('10');
  await page.locator('#network-gateway').selectOption('example-alt');
  await page.locator('#peer-mtu-example-laptop').fill('1420');
  await page.locator('[data-peer-id="example-laptop"] [data-field="fullTunnel"]').uncheck();
  await page.locator('#peer-gateway-example-phone').selectOption('example-exit');
  expect(pairKeys(await previews(page), 12)).toEqual(initial);
  await page.locator('[data-peer-id="example-laptop"] .peer-card__role').click();
  pairKeys(await previews(page), 14);
  await page.locator('[data-peer-id="example-laptop"] .peer-card__role').click();
  expect(pairKeys(await previews(page), 12)).toEqual(initial);
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('.peer-card')).toHaveCount(7);
  pairKeys(await previews(page), 15);
  await page.locator('.peer-card').last().locator('.peer-card__remove').click();
  expect(pairKeys(await previews(page), 12)).toEqual(initial);
});

test('entropy failure restores checkbox, topology and roles and preserves all prior configs on add', async ({ page }) => {
  await load(page);
  const baseline = await previews(page);
  await control(page, { failRandom: true });
  // dispatch avoids Playwright check() requiring a successfully checked result.
  await page.locator('#network-psk').click();
  await expect(page.locator('#network-psk')).not.toBeChecked();
  await expect(page.locator('#network-change-error')).toContainText('Nada foi alterado');
  expect(await previews(page)).toEqual(baseline);
  await control(page, { failRandom: false });
  await page.locator('#network-psk').check();
  const before = await previews(page);
  await control(page, { failRandom: true });
  await page.locator('#topology').selectOption('mesh');
  await expect(page.locator('#topology')).toHaveValue('hybrid');
  await expect(page.locator('#network-change-error')).toContainText('PSKs');
  await page.locator('[data-peer-id="example-laptop"] .peer-card__role').click();
  await expect(page.locator('[data-peer-id="example-laptop"] .peer-card__role')).toHaveText('[CLIENTE]');
  await expect(page.locator('#peer-change-error')).toContainText('Nada foi alterado');
  await page.locator('#add-peer-btn').click();
  await expect(page.locator('#add-peer-btn')).toContainText('ERRO');
  await expect(page.locator('.peer-card')).toHaveCount(6);
  expect(await previews(page)).toEqual(before);
  await page.locator('#network-psk').uncheck();
  expect(await previews(page)).toEqual(baseline);
});

test('enabled malformed keys block even forced stale export handlers without copying or downloading', async ({ page }) => {
  await load(page);
  await page.locator('#network-psk').check();
  const before = await previews(page);
  const downloads: string[] = [];
  page.on('download', (item) => downloads.push(item.suggestedFilename()));
  await control(page, { corrupt: true });
  for (const id of ['copy-current-btn', 'download-current-btn', 'copy-all-btn', 'download-all-btn']) {
    await page.locator(`#${id}`).dispatchEvent('click');
    await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  await expect(page.locator('#preview-code')).toBeEmpty();
  await expect(page.locator('#routing-errors')).toContainText('PSK');
  expect(downloads).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { pskTest: Controls }).pskTest.writes)).toEqual([]);
  await control(page, { corrupt: false });
  await page.locator('#keepalive').fill('25');
  expect(await previews(page)).toEqual(before);
});

test('regeneration/import rotate both key types together; entropy and X25519 failures preserve prior state', async ({ page }) => {
  await load(page);
  await page.locator('#network-psk').check();
  const saved = (await download(page, '#export-structure-btn')).toString();
  expect(JSON.parse(saved).version).toBe(4);
  expect(JSON.parse(saved).network.usePsk).toBe(true);
  expect(saved).not.toMatch(/privateKey|publicKey|presharedKey|pairKeys|"keys"/);
  let before = await previews(page);
  for (const key of pairKeys(before, 12).values()) expect(saved).not.toContain(key);
  for (const failure of ['failX', 'failRandom'] as const) {
    await control(page, { [failure]: true });
    await page.locator('#regen-keys-btn').click();
    await expect(page.locator('#regen-keys-btn')).toContainText('ERRO');
    expect(await previews(page)).toEqual(before);
    page.once('dialog', (dialog) => dialog.accept());
    await importJson(page, saved);
    await expect(page.locator('#structure-status')).toContainText('unavailable');
    expect(await previews(page)).toEqual(before);
    await control(page, { [failure]: false });
  }
  for (const operation of ['regen', 'import']) {
    if (operation === 'regen') {
      await page.locator('#regen-keys-btn').click();
      await expect(page.locator('#regen-keys-btn')).toHaveText('[REGERAR CHAVES]');
    } else {
      page.once('dialog', (dialog) => dialog.accept());
      await importJson(page, saved);
      await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
    }
    const after = await previews(page);
    expect(after['keys.txt']).not.toBe(before['keys.txt']);
    const next = pairKeys(after, 12);
    for (const [id, key] of pairKeys(before, 12)) expect(next.get(id)).not.toBe(key);
    expect((await download(page, '#export-structure-btn')).toString()).toBe(saved);
    before = after;
  }
});

test('pending regeneration preserves newer metadata; pending import aborts rather than overwriting it', async ({ page }) => {
  await load(page);
  await page.locator('#network-psk').check();
  const before = await previews(page);
  await control(page, { delayX: true });
  await page.locator('#regen-keys-btn').click();
  await expect(page.locator('#regen-keys-btn')).toHaveText('[GERANDO...]');
  await page.locator('#peer-mtu-example-laptop').fill('1420');
  await page.locator('#topology').selectOption('mesh');
  await release(page);
  await expect(page.locator('#regen-keys-btn')).toHaveText('[REGERAR CHAVES]');
  await expect(page.locator('#peer-mtu-example-laptop')).toHaveValue('1420');
  const after = await previews(page);
  const next = pairKeys(after, 15);
  for (const [id, key] of pairKeys(before, 12)) expect(next.get(id)).not.toBe(key);
  const saved = (await download(page, '#export-structure-btn')).toString();
  await control(page, { delayX: true });
  page.once('dialog', (dialog) => dialog.accept());
  await importJson(page, saved);
  await expect(page.locator('#structure-status')).toContainText('Importando');
  await page.locator('#peer-mtu-example-laptop').fill('1500');
  const edited = await previews(page);
  await release(page);
  await expect(page.locator('#structure-status')).toContainText('editada durante a importação');
  expect(await previews(page)).toEqual(edited);
});

test('strict legacy v3 disables PSK while preserving DNS and MTU; v4 restores enablement with fresh keys', async ({ page }) => {
  await load(page);
  await page.locator('#network-psk').check();
  const saved = (await download(page, '#export-structure-btn')).toString();
  const old = pairKeys(await previews(page), 12);
  const legacy = JSON.parse(EXAMPLE_STRUCTURE_JSON);
  legacy.version = 3;
  delete legacy.network.usePsk;
  legacy.network.dns = '9.9.9.9';
  legacy.peers[3].mtu = 1420;
  page.once('dialog', (dialog) => dialog.accept());
  await importJson(page, JSON.stringify(legacy));
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
  await expect(page.locator('#network-psk')).not.toBeChecked();
  const migrated = await previews(page);
  expect(Object.values(migrated).every((text) => !text.includes('PresharedKey'))).toBe(true);
  expect(migrated['laptop.conf']).toContain('MTU = 1420');
  expect(migrated['laptop.conf']).toContain('DNS = 9.9.9.9');
  page.once('dialog', (dialog) => dialog.accept());
  await importJson(page, saved);
  await expect(page.locator('#structure-status')).toContainText('importada com chaves novas');
  await expect(page.locator('#network-psk')).toBeChecked();
  const fresh = pairKeys(await previews(page), 12);
  for (const [id, key] of old) expect(fresh.get(id)).not.toBe(key);
});

test('PSK controls and failure messages fit mobile without external requests, storage, or secret logging', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const external: string[] = [];
  const messages: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4322') external.push(request.url());
  });
  page.on('console', (message) => messages.push(message.text()));
  await load(page);
  await page.locator('#network-psk').check();
  const keys = pairKeys(await previews(page), 12);
  await control(page, { failRandom: true });
  await page.locator('#topology').selectOption('mesh');
  await expect(page.locator('#network-change-error')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(external).toEqual([]);
  for (const key of keys.values()) expect(messages.join('\n')).not.toContain(key);
  await page.locator('#network-settings').screenshot({ path: testInfo.outputPath('psk-mobile.png') });
});
