// Nilai wallet Solana (misal wallet Jupiter): saldo SOL & token dari RPC publik Solana,
// harga USD dari Jupiter, lalu dikonversi ke rupiah dengan kurs USD → IDR harian.
// Posisi likuiditas Meteora DLMM milik wallet ikut dihitung (isi posisi + fee yang belum diklaim).
// Alamat wallet bersifat publik dan hanya dibaca; tidak ada kunci / API key.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const RPC_URL = 'https://api.mainnet-beta.solana.com';
const JUP_API = 'https://lite-api.jup.ag';
const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const DLMM_PROGRAM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];

export const isSolanaAddress = (address) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address ?? '');

async function getJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${new URL(url).host} menjawab ${response.status}`);
  return response.json();
}

async function rpc(method, params) {
  const data = await getJson(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// Jupiter membatasi jumlah mint per permintaan.
async function inChunks(ids, size, load) {
  const result = {};
  for (let i = 0; i < ids.length; i += size) Object.assign(result, await load(ids.slice(i, i + size)));
  return result;
}

// Posisi Meteora DLMM: [{ pair, position, x: { mint, amount }, y: { mint, amount }, feeX, feeY }] (jumlah sudah dibagi desimal).
// SDK-nya dimuat lewat require karena build ESM-nya rusak di Node.
export async function meteoraPositions(address) {
  // Cek murah dulu: akun posisi DLMM dengan pemilik = wallet (offset 40: setelah discriminator & lb_pair).
  const owned = await rpc('getProgramAccounts', [DLMM_PROGRAM, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: 40, bytes: address } }] }]);
  if (!owned.length) return [];

  const sdk = require('@meteora-ag/dlmm');
  const DLMM = sdk.default ?? sdk.DLMM ?? sdk;
  const { Connection, PublicKey } = require('@solana/web3.js');
  const byPair = await DLMM.getAllLbPairPositionsByUser(new Connection(RPC_URL, { fetch: (...args) => globalThis.fetch(...args) }), new PublicKey(address));
  const positions = [];
  for (const [pair, info] of byPair) {
    const mintX = info.tokenX.mint.address.toBase58();
    const mintY = info.tokenY.mint.address.toBase58();
    const unitX = 10 ** info.tokenX.mint.decimals;
    const unitY = 10 ** info.tokenY.mint.decimals;
    // Harga bin (dalam token Y per token X): (1 + binStep/10000)^binId, disesuaikan desimal.
    const binStep = Number(info.lbPair.binStep);
    const priceOf = (binId) => (1 + binStep / 10000) ** binId * 10 ** (info.tokenX.mint.decimals - info.tokenY.mint.decimals);
    const activeId = Number(info.lbPair.activeId);
    for (const { publicKey, positionData: data } of info.lbPairPositionsData) {
      positions.push({
        pair,
        position: publicKey.toBase58(),
        x: { mint: mintX, amount: Number(data.totalXAmount) / unitX, fee: Number(String(data.feeX)) / unitX },
        y: { mint: mintY, amount: Number(data.totalYAmount) / unitY, fee: Number(String(data.feeY)) / unitY },
        range: {
          lower: priceOf(data.lowerBinId),
          upper: priceOf(data.upperBinId),
          current: priceOf(activeId),
          in_range: activeId >= data.lowerBinId && activeId <= data.upperBinId,
        },
      });
    }
  }
  return positions;
}

// → { tokens: [{ mint, symbol, name, icon, amount, usd_price, value }], total_usd, usd_idr, value }
// value dalam rupiah (dibulatkan). Token tanpa harga di Jupiter bernilai 0 (usd_price null).
// positions: posisi LP Meteora, masing-masing dengan rincian token & nilainya.
export async function solanaWalletValue(address, { loadPositions = meteoraPositions } = {}) {
  if (!isSolanaAddress(address)) throw new Error('Alamat wallet Solana tidak valid');

  const [positions, lamports, ...tokenLists] = await Promise.all([
    loadPositions(address),
    rpc('getBalance', [address]).then((r) => r.value),
    ...TOKEN_PROGRAMS.map((programId) => rpc('getTokenAccountsByOwner', [address, { programId }, { encoding: 'jsonParsed' }]).then((r) => r.value)),
  ]);

  const amounts = new Map([[SOL_MINT, lamports / 1e9]]);
  for (const account of tokenLists.flat()) {
    const { mint, tokenAmount } = account.account.data.parsed.info;
    if (tokenAmount.uiAmount > 0) amounts.set(mint, (amounts.get(mint) ?? 0) + tokenAmount.uiAmount);
  }
  if (!(amounts.get(SOL_MINT) > 0)) amounts.delete(SOL_MINT);
  const lpMints = positions.flatMap((p) => [p.x.mint, p.y.mint]);
  const mints = [...new Set([...amounts.keys(), ...lpMints])];

  const [prices, infos, rates] = await Promise.all([
    inChunks(mints, 50, (ids) => getJson(`${JUP_API}/price/v3?ids=${ids.join(',')}`)),
    inChunks(mints, 100, async (ids) => Object.fromEntries((await getJson(`${JUP_API}/tokens/v2/search?query=${ids.join(',')}`)).map((t) => [t.id, t]))),
    getJson(RATE_URL),
  ]);
  const usdIdr = rates.rates?.IDR;
  if (!usdIdr) throw new Error('Kurs USD → IDR tidak tersedia');

  const describe = (mint, amount) => {
    const info = infos[mint] ?? {};
    const usdPrice = prices[mint]?.usdPrice ?? null;
    return {
      mint,
      symbol: info.symbol ?? `${mint.slice(0, 4)}…`,
      name: info.name ?? null,
      icon: info.icon ?? null,
      amount,
      usd_price: usdPrice,
      change_24h: prices[mint]?.priceChange24h ?? null,
      usd: usdPrice ? amount * usdPrice : 0,
      value: usdPrice ? Math.round(amount * usdPrice * usdIdr) : 0,
    };
  };

  const tokens = [...amounts].map(([mint, amount]) => describe(mint, amount)).sort((a, b) => b.value - a.value);
  const lp = positions.map((p) => {
    const parts = [describe(p.x.mint, p.x.amount + p.x.fee), describe(p.y.mint, p.y.amount + p.y.fee)];
    const fee = describe(p.x.mint, p.x.fee).value + describe(p.y.mint, p.y.fee).value;
    const feeTokens = [[p.x.mint, p.x.fee], [p.y.mint, p.y.fee]].filter(([, amount]) => amount > 0)
      .map(([mint, amount]) => ({ symbol: describe(mint, amount).symbol, amount }));
    return {
      protocol: 'Meteora DLMM',
      pair: p.pair,
      position: p.position,
      label: parts.map((t) => t.symbol).join('-'),
      tokens: parts,
      fee_value: fee,
      fee_tokens: feeTokens,
      range: p.range ?? null, // harga dalam token kedua per token pertama
      usd: parts.reduce((sum, t) => sum + t.usd, 0),
      value: parts.reduce((sum, t) => sum + t.value, 0),
    };
  });

  const totalUsd = [...tokens, ...lp].reduce((sum, item) => sum + item.usd, 0);
  // Perubahan 24 jam seluruh wallet: tiap token ditimbang nilainya (token di dalam LP ikut dihitung).
  const pieces = [...tokens, ...lp.flatMap((item) => item.tokens)].filter((t) => t.usd && t.change_24h != null);
  const usdYesterday = pieces.reduce((sum, t) => sum + t.usd / (1 + t.change_24h / 100), 0);
  const pricedUsd = pieces.reduce((sum, t) => sum + t.usd, 0);
  const change24h = usdYesterday ? ((pricedUsd - usdYesterday) / usdYesterday) * 100 : null;
  return { tokens, positions: lp, total_usd: totalUsd, change_24h: change24h, usd_idr: usdIdr, value: Math.round(totalUsd * usdIdr) };
}
