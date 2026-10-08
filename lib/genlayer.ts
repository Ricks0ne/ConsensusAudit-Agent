// lib/genlayer.ts
import 'server-only';
import { createClient, createAccount } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';

export {
  GENLAYER_CONTRACT_ADDRESS,
  GENLAYER_EXPLORER_TX,
  GENLAYER_EXPLORER_ADDRESS
} from './contract-public';

const CHAIN = studioDevnet;

export const NO_VALUE = 0n;

export function getGenLayerClient() {
  const pk = process.env.GENLAYER_PRIVATE_KEY;
  if (!pk) return null;
  const account = createAccount(pk as `0x${string}`);
  return createClient({ chain: CHAIN, account });
}

export async function ensureConsensus(_client: any) {
  return;
}

export async function withFees(
  client: any,
  overrides?: { 
    leaderTimeunitsAllocation?: bigint; 
    validatorTimeunitsAllocation?: bigint; 
    rotations?: bigint[];
    totalMessageFees?: bigint;
    executionBudgetPerRound?: bigint;
  }
): Promise<{ distribution: any; feeValue: any } | undefined> {
  if (typeof client?.estimateTransactionFees !== 'function') return undefined;

  let attempt = 0;
  const maxAttempts = 7;

  while (attempt < maxAttempts) {
    try {
      const estimate = await client.estimateTransactionFees({
        leaderTimeunitsAllocation: overrides?.leaderTimeunitsAllocation ?? 600n,
        validatorTimeunitsAllocation: overrides?.validatorTimeunitsAllocation ?? 600n,
        // 🚀 FIX: Apply the cross-contract message budget overrides here!
        executionBudgetPerRound: overrides?.executionBudgetPerRound ?? 2_000_000_000n,
        totalMessageFees: overrides?.totalMessageFees ?? 0n,
        appealRounds: 1n,
        rotations: overrides?.rotations ?? [1n, 1n],
      });

      if (estimate && estimate.feeValue) {
        return {
          distribution: estimate.distribution,
          feeValue: estimate.feeValue,
        };
      }
    } catch (err: any) {
      console.warn(`Fee estimator attempt ${attempt + 1}/${maxAttempts} failed:`, err?.message);
    }

    attempt++;
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  return undefined;
}

function pickHigherFees(
  a?: { feeValue?: any; distribution?: any },
  b?: { feeValue?: any; distribution?: any }
) {
  if (!a) return b;
  if (!b) return a;
  const av = BigInt(a.feeValue ?? 0);
  const bv = BigInt(b.feeValue ?? 0);
  return av >= bv ? a : b;
}

export async function resolveFees(
  client: any,
  txPayload: { address: string; functionName: string; args: any[]; value?: bigint },
  manualBudget?: { 
    leaderTimeunitsAllocation: bigint; 
    validatorTimeunitsAllocation: bigint;
    totalMessageFees?: bigint;
    executionBudgetPerRound?: bigint;
  }
): Promise<{ distribution: any; feeValue: any } | undefined> {
  let simulated: any;
  try {
    simulated = await client.estimateTransactionFeesForWrite(txPayload);
  } catch (simErr: any) {
    console.warn(`Fee simulation failed for ${txPayload.functionName}:`, simErr?.message || simErr);
    simulated = undefined;
  }

  if (!manualBudget) return simulated;

  const manual = await withFees(client, manualBudget);
  return pickHigherFees(simulated, manual) as any;
}

export function newSubmissionId(prefix = 'audit') {
  const rand = crypto.randomUUID().split('-')[0];
  return `${prefix}_${Date.now()}_${rand}`;
}

export function genToWei(genAmount: string | number): bigint {
  const str = String(genAmount).trim();
  if (!str || Number.isNaN(Number(str))) return 0n;
  const negative = str.startsWith('-');
  const clean = negative ? str.slice(1) : str;
  const [whole, frac = ''] = clean.split('.');
  const wholeBig = BigInt(whole || '0');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  const fracBig = BigInt(fracPadded || '0');
  const wei = wholeBig * 10n ** 18n + fracBig;
  return negative ? -wei : wei;
}

export function weiToGen(weiAmount: string | number | bigint): string {
  try {
    const wei = BigInt(weiAmount);
    const whole = wei / 10n ** 18n;
    const frac = wei % 10n ** 18n;
    const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch {
    return String(weiAmount);
  }
}