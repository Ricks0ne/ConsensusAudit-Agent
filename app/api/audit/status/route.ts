// app/api/audit/status/route.ts
import { NextResponse } from 'next/server';
import { getGenLayerClient, GENLAYER_CONTRACT_ADDRESS } from '@/lib/genlayer';
import { normalizeVerdict } from '@/lib/verdict';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Manual recovery/diagnostic tool: check a transaction that may have gone
// through on-chain but whose original request connection dropped before
// reading the result. Not called by the frontend's normal flow.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const hash = searchParams.get('hash');
  const submissionId = searchParams.get('submissionId');

  if (!hash || !submissionId) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  try {
    const client = getGenLayerClient();
    if (!client) {
      return NextResponse.json({ error: 'GenLayer client not configured.' }, { status: 500 });
    }

    const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });

    // 🚀 FIX: Cast receipt to any to bypass standard EVM status type checking
    if (!receipt || (receipt as any).status !== 'FINALIZED') {
      return NextResponse.json({ status: 'PENDING' });
    }

    const verdictStr = await client.readContract({
      address: GENLAYER_CONTRACT_ADDRESS as `0x${string}`,
      functionName: 'get_verdict',
      args: [submissionId]
    }) as string;

    if (!verdictStr) {
      return NextResponse.json({ error: 'Transaction finalized but verdict not found.' }, { status: 404 });
    }

    const onchain = JSON.parse(verdictStr);

    const finalVerdict = {
      ...normalizeVerdict(onchain),
      mode: 'genlayer-consensus',
      contractAddress: GENLAYER_CONTRACT_ADDRESS,
      submissionId,
      txHash: hash,
      timestamp: new Date().toISOString(),
      isAppeal: Boolean(onchain.is_appeal),
      previousVerdictHash: onchain.previous_id || null,
      appealDepth: Number(onchain.appeal_depth ?? 0)
    };

    return NextResponse.json({ status: 'FINALIZED', verdict: finalVerdict });
  } catch (error: any) {
    console.error('Polling error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}