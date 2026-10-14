import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { download } from 'geckodriver';
import { createServer } from 'node:https';
import { mkdtemp, readFile, rm, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readPdfText } from './pdf-text.mjs';
const temporary = await mkdtemp(path.join(tmpdir(), 'ai-notebook-firefox-'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    `${temporary}/key.pem`,
    '-out',
    `${temporary}/cert.pem`,
    '-days',
    '1',
    '-subj',
    '/CN=chatgpt.com',
  ],
  { stdio: 'ignore' },
);
const fixture = await readFile('tests/fixtures/chatgpt-semantic.html', 'utf8');
const server = createServer(
  { key: await readFile(`${temporary}/key.pem`), cert: await readFile(`${temporary}/cert.pem`) },
  (_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fixture);
  },
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const binary = process.env.FIREFOX_BINARY ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const options = new firefox.Options()
  .setBinary(binary)
  .addArguments('-headless', '-no-remote')
  .setAcceptInsecureCerts(true)
  .setPreference('network.dns.localDomains', 'chatgpt.com')
  .setPreference('browser.download.folderList', 2)
  .setPreference('browser.download.dir', temporary)
  .setPreference('browser.helperApps.neverAsk.saveToDisk', 'application/pdf')
  .setPreference('pdfjs.disabled', true);
const driverPath = await download('0.37.1');
const driver = await new Builder()
  .forBrowser('firefox')
  .setFirefoxOptions(options)
  .setFirefoxService(
    new firefox.ServiceBuilder(driverPath)
      .addArguments('--allow-system-access')
      .setStdio(process.env.FIREFOX_DEBUG ? 'inherit' : 'ignore'),
  )
  .build();
try {
  const addonId = await driver.installAddon(path.resolve('build/firefox'), true);
  await driver.setContext(firefox.Context.CHROME);
  const viewUrl = await driver.executeScript(
    'return WebExtensionPolicy.getByID(arguments[0]).getURL("sidepanel.html");',
    addonId,
  );
  await driver.setContext(firefox.Context.CONTENT);
  await driver.get(`https://chatgpt.com:${port}/c/firefox-old`);
  // Verify declarative injection and main-page color saving in actual Firefox.
  await driver.wait(
    () => driver.executeScript('return !!document.querySelector("#ai-marker-toolbar")'),
    10000,
  );
  await driver.executeScript(
    `const node=document.querySelector('[data-message-id="a1"] p').firstChild;const range=document.createRange();range.setStart(node,0);range.setEnd(node,16);getSelection().removeAllRanges();getSelection().addRange(range);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));`,
  );
  const button = await driver.executeScript(
    'return document.querySelector("#ai-marker-toolbar").shadowRoot.querySelectorAll("button")[1]',
  );
  await button.click();
  await driver.wait(
    () =>
      driver.executeScript(
        'return [...CSS.highlights.get("ai-notebook-green")].some(r=>r.toString()==="Machine learning")',
      ),
    10000,
  );
  await driver.navigate().refresh();
  await driver.wait(
    () =>
      driver.executeScript(
        'return CSS.highlights.has("ai-notebook-green") && [...CSS.highlights.get("ai-notebook-green")].length===1',
      ),
    10000,
  );
  const chatHandle = await driver.getWindowHandle();
  await driver.switchTo().newWindow('window');
  await driver.get(viewUrl);
  const sourceWindow = await driver.executeAsyncScript(
    'const done=arguments[arguments.length-1];browser.tabs.query({}).then(tabs=>done(tabs.find(t=>t.url?.includes("/c/firefox-old")).windowId));',
  );
  await driver.get(`${viewUrl}?sourceWindow=${sourceWindow}`);
  await driver.wait(
    async () => (await driver.findElements(By.css('[data-notebook-message-id]'))).length === 4,
    10000,
  );
  const archive = await driver.executeAsyncScript(
    'const done=arguments[arguments.length-1];browser.runtime.sendMessage({type:"list"}).then(done);',
  );
  assert.equal(archive.ok, true);
  assert.equal(archive.data.notebooks[0].highlights[0].text, 'Machine learning');
  const annotated = await driver.executeAsyncScript(`
    const done=arguments[arguments.length-1];
    browser.runtime.sendMessage({type:'list'}).then(async result=>{
      const notebook=result.data.notebooks[0];const h=notebook.highlights[0];
      done(await browser.runtime.sendMessage({type:'updateAnnotation',id:notebook.id,highlightId:h.id,note:'A Firefox research note',tags:['research'],bookmarked:true}));
    });`);
  assert.equal(annotated.ok, true);
  assert.equal(annotated.data.notebooks[0].highlights[0].bookmarked, true);
  const exportButton = await driver.findElement(
    By.xpath('//button[normalize-space()="Save study PDF"]'),
  );
  await exportButton.click();
  const file = await driver.wait(async () => {
    const files = await readdir(temporary);
    const pdf = files.find((file) => file.endsWith('.pdf'));
    return pdf &&
      !files.some((file) => file.endsWith('.part')) &&
      (await stat(path.join(temporary, pdf))).size > 1024
      ? pdf
      : undefined;
  }, 15000);
  const pdf = await readPdfText(path.join(temporary, file));
  assert.match(pdf.text, /Machine learning/);
  assert.match(pdf.text, /Supervised learning/);
  assert.match(pdf.text, /A Firefox research note/);
  assert.match(pdf.text, /#research/);
  await driver.switchTo().window(chatHandle);
  console.log(
    'PASS Firefox: real add-on installation, MV3 background, main-page highlight, reload persistence, notebook messages, native APIs, full PDF download',
  );
} finally {
  await driver.quit();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
