// app/api/lookup/route.ts
import { NextResponse } from 'next/server';
import { getGenLayerClient, GENLAYER_CONTRACT_ADDRESS } from '@/lib/genlayer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Direct read access to get_verdict / get_escrow / list_submissions by
// submission_id (or offset+limit for the submissions list), so any contract
// record can be inspected without already having it in local state.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'verdict' | 'escrow' | 'submissions'

  if (type === 'submissions') {
    const offset = Number(searchParams.get('offset') ?? '0');
    const limit = Number(searchParams.get('limit') ?? '20');
    try {
      const client = getGenLayerClient();
      if (!client) return NextResponse.json({ error: 'GenLayer client not configured.' }, { status: 500 });

      const ids = await client.readContract({
        address: GENLAYER_CONTRACT_ADDRESS,
        functionName: 'list_submissions',
        args: [offset, limit]
      }) as string[];

      return NextResponse.json({ found: true, data: ids });
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
    }
  }

  const submissionId = searchParams.get('submissionId');
  if (!submissionId || (type !== 'verdict' && type !== 'escrow')) {
    return NextResponse.json({ error: 'Provide submissionId and type=verdict|escrow, or type=submissions.' }, { status: 400 });
  }

  try {
    const client = getGenLayerClient();
    if (!client) return NextResponse.json({ error: 'GenLayer client not configured.' }, { status: 500 });

    const raw = await client.readContract({
      address: GENLAYER_CONTRACT_ADDRESS,
      functionName: type === 'verdict' ? 'get_verdict' : 'get_escrow',
      args: [submissionId]
    }) as string;

    if (!raw) return NextResponse.json({ found: false });

    return NextResponse.json({ found: true, data: JSON.parse(raw) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}