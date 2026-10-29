import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers.js';

let app;
before(async () => { app = await startTestApp(); });
after(() => app.close());

const WALLET = 'DqAf4YDudpzNHLZ5YXQXP5xRrwX4uX2KC4Y1AR9V5ikb';
const SOL = 'So11111111111111111111111111111111111111112';
const MEME = 'RZjZXpA84nxb3VFtUd2hGigGRqKsuQvLt1HNK9eVqNX';

// Ganti fetch ke layanan luar (RPC Solana, Jupiter, kurs) dengan jawaban palsu; permintaan ke app tetap asli.
function fakeNetwork({ fail = false } = {}) {
  const realFetch = globalThis.fetch;
  const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, options) => {
    const { host, pathname } = new URL(url);
    if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) return realFetch(url, options);
    if (fail) throw new Error('offline');
    if (host === 'api.mainnet-beta.solana.com') {
      const { method, params, id } = JSON.parse(options.body);
      const rpc = (result) => json({ jsonrpc: '2.0', id, result });
      // Tanpa posisi LP Meteora.
      if (method === 'getProgramAccounts') return rpc([]);
      if (method === 'getBalance') return json({ result: { value: 2_000_000_000 } }); // 2 SOL
      const legacy = params[1].programId.startsWith('Tokenkeg');
      return json({ result: { value: legacy ? [{ account: { data: { parsed: { info: { mint: MEME, tokenAmount: { uiAmount: 5000 } } } } } }] : [] } });
    }
    if (pathname === '/price/v3') return json({ [SOL]: { usdPrice: 100 }, [MEME]: { decimals: 6 } });
    if (pathname === '/tokens/v2/search') return json([{ id: SOL, symbol: 'SOL', icon: 'sol.png' }, { id: MEME, symbol: 'ALLINU' }]);
    if (host === 'open.er-api.com') return json({ rates: { IDR: 16000 } });
    throw new Error(`tak terduga: ${url}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

test('wallet Solana: nilai aset dihitung dari saldo token × harga Jupiter × kurs', async () => {
  const restore = fakeNetwork();
  try {
    const created = await app.api.post('/assets', { name: 'Jupiter', type: 'crypto', wallet_address: WALLET });
    const { assets } = await app.api.get('/assets');
    const wallet = assets.find((a) => a.id === created.id);
    assert.equal(wallet.sync_error, null);
    assert.equal(wallet.current_value, 3_200_000); // 2 SOL × $100 × 16.000
    assert.deepEqual(wallet.wallet_tokens.tokens.map((t) => [t.symbol, t.value]), [['SOL', 3_200_000], ['ALLINU', 0]]);
    assert.equal(wallet.sync_error, null);
  } finally { restore(); }
});

test('wallet gagal diperbarui: nilai terakhir tetap dipakai dan pesan gagalnya disimpan', async () => {
  const [wallet] = (await app.api.get('/assets')).assets.filter((a) => a.wallet_address);
  const restore = fakeNetwork({ fail: true });
  try {
    const { query } = await import('../server/db.js');
    await query("UPDATE assets SET sync_tried_at = now() - interval '1 hour' WHERE id = $1", [wallet.id]);
    const { syncStaleWallets } = await import('../server/routes/assets.js');
    await syncStaleWallets();
    const after = (await app.api.get('/assets')).assets.find((a) => a.id === wallet.id);
    assert.equal(after.current_value, 3_200_000);
    assert.match(after.sync_error, /offline/);
  } finally { restore(); }
});

test('posisi LP Meteora ikut dihitung: isi posisi + fee', async () => {
  const restore = fakeNetwork();
  try {
    const { solanaWalletValue } = await import('../server/solana-wallet.js');
    const wallet = await solanaWalletValue(WALLET, {
      loadPositions: async () => [{ pair: 'P', position: 'L', x: { mint: MEME, amount: 100, fee: 0 }, y: { mint: SOL, amount: 0.5, fee: 0.25 } }],
    });
    assert.equal(wallet.positions[0].label, 'ALLINU-SOL');
    assert.equal(wallet.positions[0].value, 1_200_000); // 0,75 SOL × $100 × 16.000
    assert.equal(wallet.positions[0].fee_value, 400_000);
    assert.equal(wallet.value, 3_200_000 + 1_200_000);
  } finally { restore(); }
});

test('alamat wallet tidak valid ditolak', async () => {
  await assert.rejects(app.api.post('/assets', { name: 'X', type: 'crypto', wallet_address: 'bukan-alamat' }), /tidak valid/);
});
