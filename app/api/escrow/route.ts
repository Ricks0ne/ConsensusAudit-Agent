// app/api/escrow/route.ts
import { NextResponse } from 'next/server';
import { getEscrow, setEscrow, type EscrowRecord } from '@/lib/escrow-store';
import {
  getGenLayerClient,
  ensureConsensus,
  GENLAYER_CONTRACT_ADDRESS,
  genToWei,
  weiToGen
} from '@/lib/genlayer';

export const maxDuration = 90;
export const runtime = 'nodejs';

async function verifyAttestation(verdict: any, submittedHash: string): Promise<boolean> {
  const secret = process.env.ATTESTATION_SECRET;
  const { verdictHash, signed, fallbackReason, ...payload } = verdict;
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(JSON.stringify(payload));

  if (!secret) return false;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, dataBuffer);
  const recomputed = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (recomputed.length !== submittedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < recomputed.length; i++) diff |= recomputed.charCodeAt(i) ^ submittedHash.charCodeAt(i);
  return diff === 0;
}

async function handleOnchain(action: string, submissionId: string, amountGen: any, beneficiary: any) {
  const client = getGenLayerClient();
  if (!client) {
    return NextResponse.json(
      { error: 'On-chain escrow is unavailable: GENLAYER_PRIVATE_KEY is not configured on the server.' },
      { status: 503 }
    );
  }

  let functionName = '';
  let args: any[] = [];
  let txValue: bigint | undefined = undefined;

  if (action === 'create') {
    if (!beneficiary || !/^0x[a-fA-F0-9]{40}$/.test(String(beneficiary))) {
      return NextResponse.json({ error: 'A valid 0x... beneficiary address is required to open escrow.' }, { status: 400 });
    }
    txValue = genToWei(amountGen ?? '0.01');
    if (txValue <= 0n) {
      return NextResponse.json({ error: 'Escrow amount must be a positive GEN value, e.g. "0.01".' }, { status: 400 });
    }
    functionName = 'open_escrow';
    args = [submissionId, String(beneficiary)];
  } else {
    functionName =
      action === 'release' ? 'release_escrow' :
      action === 'claim' ? 'claim_escrow' :
      action === 'refund' ? 'refund_escrow' : '';

    if (!functionName) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    args = [submissionId];
  }

  try {
    await ensureConsensus(client);

    const txPayload: any = {
      address: GENLAYER_CONTRACT_ADDRESS as `0x${string}`,
      account: client.account,
      functionName,
      args,
    };
    if (txValue !== undefined && txValue > 0n) {
      txPayload.value = txValue;
    }

    // 🚀 STRICT REQUIREMENT: Natively request the allocation tree. No fallbacks.
    const fees = await client.estimateTransactionFeesForWrite(txPayload);

    const txHash = await client.writeContract({
      ...txPayload,
      fees
    } as any);

    const receipt: any = await client.waitForTransactionReceipt({ hash: txHash, waitUntil: 'finalized', interval: 3000, retries: 20 });
    
    // 🚀 NEW: Explicitly check if the Python contract rejected the logic
    if (receipt.status === 'reverted') {
      console.error("TX REVERTED ON-CHAIN. Receipt:", receipt);
      throw new Error(`Transaction reverted on-chain. The Python contract threw an exception (e.g., TypeError on _pay, or a require() failed).`);
    }

    return NextResponse.json({ escrow: await readEscrow(client, submissionId, txHash) });
  } catch (e: any) {
    console.error("Escrow execution failed:", e);
    return NextResponse.json({ error: `On-chain escrow call rejected: ${e?.message || e}` }, { status: 400 });
  }
}

async function readEscrow(client: any, submissionId: string, txHash: string) {
  const raw = await client.readContract({
    address: GENLAYER_CONTRACT_ADDRESS,
    functionName: 'get_escrow',
    args: [submissionId]
  }) as string;

  const onchain = raw ? JSON.parse(raw) : null;
  if (!onchain) throw new Error('Contract returned no escrow record.');

  return {
    status: onchain.status,
    amount: onchain.amount,
    amountGen: weiToGen(onchain.amount ?? '0'),
    beneficiary: onchain.beneficiary || null,
    depositor: onchain.depositor || null,
    releasedBy: onchain.released_by || null,
    txHash,
    onchain: true
  };
}

export async function POST(req: Request) {
  try {
    const { action, verdict, amountGen, beneficiary } = await req.json();

    if (!verdict) return NextResponse.json({ error: 'Missing verdict.' }, { status: 400 });
    if (!verdict.submissionId) return NextResponse.json({ error: 'Missing submissionId on verdict.' }, { status: 400 });

    if (action === 'claim' && verdict.mode !== 'genlayer-consensus') {
      return NextResponse.json({ error: 'Claim is only available for on-chain (genlayer-consensus) verdicts.' }, { status: 400 });
    }

    if (verdict.mode === 'genlayer-consensus') {
      return handleOnchain(action, verdict.submissionId, amountGen, beneficiary);
    }

    if (verdict.signed !== true || !process.env.ATTESTATION_SECRET) {
      return NextResponse.json(
        { error: 'This verdict is not signed. Set ATTESTATION_SECRET on the server to enable off-chain settlement.' },
        { status: 403 }
      );
    }
    if (!verdict.verdictHash) {
      return NextResponse.json({ error: 'Missing verdictHash on verdict.' }, { status: 400 });
    }

    const isValid = await verifyAttestation(verdict, verdict.verdictHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Attestation check failed: the verdict does not match its signature. Escrow untouched.' },
        { status: 403 }
      );
    }

    const key = String(verdict.submissionId);

    if (action === 'create') {
      const existing = await getEscrow(key);
      if (existing) return NextResponse.json({ escrow: existing });

      const record: EscrowRecord = {
        status: 'HELD',
        amount: amountGen ? Number(amountGen) : 1000,
        createdAt: new Date().toISOString()
      };
      await setEscrow(key, record);
      return NextResponse.json({ escrow: record });
    }

    if (action === 'release' || action === 'refund') {
      const existing = await getEscrow(key);
      if (!existing) {
        return NextResponse.json({ error: 'No escrow exists for this verdict yet.' }, { status: 404 });
      }
      if (existing.status !== 'HELD') {
        return NextResponse.json({ error: `Escrow is already ${existing.status}.`, escrow: existing }, { status: 409 });
      }

      if (action === 'release' && verdict.status !== 'APPROVED') {
        const blocked: EscrowRecord = { ...existing, status: 'BLOCKED' };
        await setEscrow(key, blocked);
        return NextResponse.json(
          { error: 'Release blocked: the verdict is not APPROVED.', escrow: blocked },
          { status: 403 }
        );
      }
      if (action === 'refund' && verdict.status === 'APPROVED') {
        return NextResponse.json(
          { error: 'Refund blocked: the verdict is APPROVED, so release the funds instead.', escrow: existing },
          { status: 403 }
        );
      }

      const settled: EscrowRecord = {
        ...existing,
        status: action === 'release' ? 'RELEASED' : 'REFUNDED',
        releasedAt: new Date().toISOString()
      } as EscrowRecord;
      await setEscrow(key, settled);
      return NextResponse.json({ escrow: settled });
    }

    return NextResponse.json({ error: 'Unknown action. Use "create", "release" or "refund".' }, { status: 400 });

  } catch (error: any) {
    console.error('Escrow API error:', error?.message || error);
    return NextResponse.json({ error: 'Could not process this escrow request.' }, { status: 500 });
  }
}