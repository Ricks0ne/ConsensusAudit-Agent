// app/api/admin/route.ts
import { NextResponse } from 'next/server';
import { getGenLayerClient, GENLAYER_CONTRACT_ADDRESS, weiToGen } from '@/lib/genlayer';

export const maxDuration = 90;
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = getGenLayerClient();
    if (!client) return NextResponse.json({ error: 'GenLayer client not configured.' }, { status: 500 });

    const [owner, paused, balanceWei, totalSubmissions, version] = await Promise.all([
      client.readContract({ address: GENLAYER_CONTRACT_ADDRESS as `0x${string}`, functionName: 'get_owner', args: [] }) as Promise<string>,
      client.readContract({ address: GENLAYER_CONTRACT_ADDRESS as `0x${string}`, functionName: 'is_paused', args: [] }) as Promise<boolean>,
      client.readContract({ address: GENLAYER_CONTRACT_ADDRESS as `0x${string}`, functionName: 'get_contract_balance', args: [] }) as Promise<string>,
      client.readContract({ address: GENLAYER_CONTRACT_ADDRESS as `0x${string}`, functionName: 'get_total_submissions', args: [] }) as Promise<number>,
      client.readContract({ address: GENLAYER_CONTRACT_ADDRESS as `0x${string}`, functionName: 'get_version', args: [] }) as Promise<string>
    ]);

    return NextResponse.json({
      owner,
      paused,
      balanceWei: String(balanceWei),
      balanceGen: weiToGen(balanceWei ?? '0'),
      totalSubmissions: Number(totalSubmissions ?? 0),
      version
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const client = getGenLayerClient();
    if (!client) return NextResponse.json({ error: 'GenLayer client not configured.' }, { status: 500 });

    const { action, submissionId, newOwner } = await req.json();

    let functionName: string;
    let args: any[];

    switch (action) {
      case 'pause':
        functionName = 'set_paused'; args = [true]; break;
      case 'unpause':
        functionName = 'set_paused'; args = [false]; break;
      case 'transfer_ownership':
        if (!newOwner || !String(newOwner).trim()) {
          return NextResponse.json({ error: 'newOwner is required.' }, { status: 400 });
        }
        functionName = 'transfer_ownership'; args = [newOwner]; break;
      case 'force_refund':
        if (!submissionId || !String(submissionId).trim()) {
          return NextResponse.json({ error: 'submissionId is required.' }, { status: 400 });
        }
        functionName = 'admin_force_refund'; args = [submissionId];
        break;
      default:
        return NextResponse.json({ error: 'Unknown action. Use "pause", "unpause", "transfer_ownership" or "force_refund".' }, { status: 400 });
    }

    const txPayload: any = {
      address: GENLAYER_CONTRACT_ADDRESS as `0x${string}`,
      account: client.account,
      functionName,
      args,
    };

    // 🚀 STRICT REQUIREMENT: Natively request the allocation tree. No manual fallbacks allowed.
    // If this throws an error, it means the Python logic rejected the call (e.g., escrow already refunded).
    const fees = await client.estimateTransactionFeesForWrite(txPayload);

    const txHash = await client.writeContract({
      ...txPayload,
      fees
    } as any);
    
    const receipt: any = await client.waitForTransactionReceipt({ hash: txHash, waitUntil: 'finalized', interval: 3000, retries: 20 });

    // 🚀 NEW: Explicitly check if the Python contract rejected the logic
    if (receipt.status === 'reverted') {
      console.error("TX REVERTED ON-CHAIN. Receipt:", receipt);
      throw new Error(`Transaction reverted on-chain. The Python contract threw an exception.`);
    }

    return NextResponse.json({ txHash, action });
  } catch (error: any) {
    console.error("Admin Execution Error:", error);
    return NextResponse.json({ error: `Admin call rejected: ${error?.message || error}` }, { status: 400 });
  }
}